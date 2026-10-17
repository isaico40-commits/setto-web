// Edge Function · push-pedido
// La llama el trigger orders_push (migración 023) cuando un pedido cambia.
// Busca las suscripciones del pedido y manda la notificación. Sin JWT: se valida con x-setto-hook.
// Las claves (hook y VAPID) se leen de Vault con push_config(); SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await sb.rpc("push_config");
  if (error || !data?.push_hook_secret || !data?.vapid_private_key) throw new Error("Falta configurar las claves en Vault");
  webpush.setVapidDetails("https://setto.com.ar", data.vapid_public_key, data.vapid_private_key);
  return (cfg = data);
}

type Order = { id: string; code: string; track: string; modo: string; status: string };

function mensaje(tipo: string, o: Order) {
  const envio = o.modo === "envio";
  switch (tipo) {
    case "preparando": return "Ya estamos preparando tu pedido.";
    case "listo": return envio ? "Tu pedido salió y va en camino." : "¡Está listo! Ya podés pasar a buscarlo.";
    case "entregado": return "¡Entregado! Que lo disfrutes.";
    case "cancelado": return "Cancelamos tu pedido. Si tenés dudas, escribinos por WhatsApp.";
    case "cambio": return "Nos quedamos sin algo de tu pedido. Entrá para elegir un reemplazo.";
    default: return null;
  }
}

Deno.serve(async (req) => {
  const c = await config();
  if (req.method !== "POST" || req.headers.get("x-setto-hook") !== c.push_hook_secret) {
    return new Response("no", { status: 401 });
  }
  const { order_id, tipo } = await req.json().catch(() => ({}));
  const { data: o } = await sb.from("orders").select("id,code,track,modo,status").eq("id", order_id).maybeSingle<Order>();
  const body = o && mensaje(tipo, o);
  if (!o || !body) return new Response("sin aviso", { status: 200 });

  const { data: subs } = await sb.from("push_subs").select("id,endpoint,p256dh,auth").eq("order_id", o.id);
  const payload = JSON.stringify({ title: `Setto · ${o.code}`, body, track: o.track, tag: o.code, tipo });
  const muertas: string[] = [];
  let ok = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "high" });
      ok++;
    } catch (e) {
      const st = (e as { statusCode?: number }).statusCode;
      if (st === 404 || st === 410) muertas.push(s.id); // el navegador ya no la acepta
      else console.error("push", st, (e as Error).message);
    }
  }));
  // pedido cerrado: ya no hace falta guardar las suscripciones
  if (o.status !== "pendiente") await sb.from("push_subs").delete().eq("order_id", o.id);
  else if (muertas.length) await sb.from("push_subs").delete().in("id", muertas);
  return Response.json({ enviadas: ok, de: subs?.length ?? 0 });
});
