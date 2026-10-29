// Edge Function · push-pedido
// La llama el trigger orders_push (migración 025) cuando un pedido cambia: busca las suscripciones del pedido y manda la notificación.
// Con tipo "drop" (migración 026) avisa el lanzamiento de la edición especial a todos los anotados en drop_subs.
// Con tipo "equipo" (migraciones 027, 028 y 050) avisa al equipo: pedido nuevo, gift card, cambio resuelto, reseña o tarea nueva en la caja
// (la tarea no le llega al dispositivo de quien la cargó). Sin JWT: se valida con x-setto-hook.
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

type Sub = { endpoint: string; p256dh: string; auth: string };
// manda a todos y devuelve los endpoints que el navegador ya no acepta
async function enviar(subs: Sub[], payload: string, ttl: number) {
  const muertas: string[] = [];
  let ok = 0;
  for (let i = 0; i < subs.length; i += 200) { // de a tandas para no saturar
    await Promise.all(subs.slice(i, i + 200).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: ttl, urgency: "high" });
        ok++;
      } catch (e) {
        const st = (e as { statusCode?: number }).statusCode;
        if (st === 404 || st === 410) muertas.push(s.endpoint);
        else console.error("push", st, (e as Error).message);
      }
    }));
  }
  return { ok, muertas };
}

async function avisarDrop() {
  const { data: st } = await sb.from("settings").select("value").eq("key", "especial").maybeSingle<{ value: Record<string, string> }>();
  const E = st?.value ?? {};
  const titulo = (E.push_titulo || "").trim() || `¡Salió ${(E.titulo || "la edición especial").trim()}!`;
  const texto = (E.push_texto || "").trim() || "Ya se puede pedir. Entrá antes de que se agote.";
  const { data: subs } = await sb.from("drop_subs").select("endpoint,p256dh,auth");
  const payload = JSON.stringify({ title: titulo, body: texto, url: "/#especial", tag: "setto-drop" });
  const { ok, muertas } = await enviar(subs ?? [], payload, 12 * 3600);
  if (muertas.length) await sb.from("drop_subs").delete().in("endpoint", muertas);
  return Response.json({ enviadas: ok, de: subs?.length ?? 0 });
}

const plata = (n: number) => "$" + Number(n || 0).toLocaleString("es-AR");

// aviso para el panel: arma el texto según el evento y lo manda a todos los navegadores del equipo
async function avisarEquipo(evento: string, id: string) {
  let n: { title: string; body: string; url: string; tag: string } | null = null;
  let menos = ""; // dispositivo que no recibe el aviso (quien cargó la tarea)
  if (evento === "pedido" || evento === "cambio") {
    const { data: o } = await sb.from("orders").select("code,nombre,total,modo,retiro,cambio").eq("id", id).maybeSingle();
    if (o && evento === "pedido") n = { title: `🛎️ Pedido nuevo · ${o.code}`, body: `${o.nombre} · ${plata(o.total)} · ${o.modo === "envio" ? "envío" : "retira"}${o.retiro ? " " + o.retiro : ""}`, url: "/panel", tag: `pedido-${o.code}` };
    if (o && evento === "cambio") n = { title: `🔁 ${o.code}: el cliente respondió`, body: o.cambio?.resolucion === "cancelado" ? `${o.nombre} canceló el pedido.` : `${o.nombre} eligió el reemplazo. Revisá el pedido.`, url: "/panel", tag: `cambio-${o.code}` };
  } else if (evento === "gift") {
    const { data: g } = await sb.from("giftcards").select("code,monto,de,para").eq("id", id).maybeSingle();
    if (g) n = { title: `🎁 Gift card nueva · ${plata(g.monto)}`, body: `${g.de || "Alguien"} para ${g.para || "alguien"}. Falta confirmar el pago y activarla.`, url: "/panel#gift", tag: `gift-${g.code}` };
  } else if (evento === "resena") {
    const { data: r } = await sb.from("reviews").select("nombre,rating").eq("id", id).maybeSingle();
    if (r) n = { title: `⭐ Reseña nueva publicada`, body: `${r.nombre} dejó ${r.rating} ${r.rating === 1 ? "estrella" : "estrellas"}.`, url: "/panel#resenas", tag: `resena-${id}` };
  } else if (evento === "tarea") {
    const { data: t } = await sb.from("caja_tareas").select("titulo,asignada,prioridad,creada_por").eq("id", id).maybeSingle();
    if (t) n = { title: `${t.prioridad === "alta" ? "🔴" : "📝"} Tarea nueva de ${t.creada_por}`, body: `${t.titulo}${t.asignada && t.asignada !== "Cualquiera" ? ` · para ${t.asignada}` : ""}`, url: "/caja#tareas", tag: `tarea-${id}` };
    if (t) menos = t.creada_por || "";
  }
  if (!n) return new Response("sin aviso", { status: 200 });
  const { data: todas } = await sb.from("staff_push_subs").select("endpoint,p256dh,auth,quien");
  const subs = (todas ?? []).filter((s) => !menos || s.quien !== menos);
  const { ok, muertas } = await enviar(subs, JSON.stringify(n), 24 * 3600);
  if (muertas.length) await sb.from("staff_push_subs").delete().in("endpoint", muertas);
  return Response.json({ enviadas: ok, de: subs.length });
}

Deno.serve(async (req) => {
  const c = await config();
  if (req.method !== "POST" || req.headers.get("x-setto-hook") !== c.push_hook_secret) {
    return new Response("no", { status: 401 });
  }
  const { order_id, tipo, evento, id } = await req.json().catch(() => ({}));
  if (tipo === "drop") return avisarDrop();
  if (tipo === "equipo") return avisarEquipo(evento, id);
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
