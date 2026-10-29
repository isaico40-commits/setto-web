// Edge Function · whatsapp-automaticas
//   La llama pg_cron todos los días (automaticas_tick, migración 051, con x-setto-hook): manda cada automática prendida
//   a quienes les toca hoy según automatica_destinatarios() (permiso, días desde la última compra, una vez por compra, 7 días entre mensajes).
//   Desde el panel (sesión del equipo): { automation_id, prueba: "223…" } manda solo a ese número, si también aceptó.
// Secretos: META_ACCESS_TOKEN, WA_PHONE_NUMBER_ID.
import { env, sb, esEquipo, hookValido, json, CORS, VERSION } from "../_shared/supa.ts";
import { mensajePlantilla, soloDigitos } from "../_shared/crm.ts";

const TOPE = 300; // por automática y por día: lo que entra cómodo en una ejecución

async function mandar(to: string, nombre: string | null, a: any) {
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
    body: JSON.stringify(mensajePlantilla(to, a.plantilla, a.idioma, a.variables, nombre)) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) return { error: `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim() };
  return { wamid: d.messages?.[0]?.id as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cron = await hookValido(req);
  if (!cron && !(await esEquipo(req))) return json({ error: "Solo el equipo puede hacer esto" }, 401);
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return json({ error: "Faltan las credenciales de WhatsApp en los secretos de Supabase" }, 400);
  const { automation_id, prueba } = await req.json().catch(() => ({}));

  if (!cron) { // el panel solo manda pruebas; el envío real es el del cron
    const { data: a } = await sb.from("marketing_automations").select("*").eq("id", automation_id).maybeSingle();
    if (!a) return json({ error: "No encontramos la automática" }, 404);
    const ph = soloDigitos(prueba || "");
    if (!ph) return json({ error: "Poné el número para la prueba" }, 400);
    const { data: ok } = await sb.rpc("puede_contactar", { p_phone: ph, p_canal: "whatsapp" });
    if (!ok) return json({ error: "Ese número no aceptó novedades por WhatsApp. Marcá la casilla en un pedido o escribí ALTA al WhatsApp de Setto." }, 400);
    const { data: cli } = await sb.from("customers").select("nombre").eq("phone", ph).maybeSingle();
    const r = await mandar(ph, cli?.nombre ?? null, a);
    await sb.from("message_logs").insert({ automation_id: a.id, phone: ph, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null, texto: "[prueba]" });
    return r.error ? json({ error: r.error }, 502) : json({ ok: true, prueba: true });
  }

  const { data: autos } = await sb.from("marketing_automations").select("*").eq("activa", true);
  const res: Record<string, unknown> = {};
  for (const a of autos ?? []) {
    const { data: lista, error } = await sb.rpc("automatica_destinatarios", { p_id: a.id });
    if (error) { res[a.nombre] = { error: error.message }; continue; }
    let enviados = 0, fallidos = 0;
    for (const d of ((lista ?? []) as { phone: string; nombre: string | null }[]).slice(0, TOPE)) {
      const r = await mandar(d.phone, d.nombre, a);
      if (r.wamid) enviados++; else fallidos++;
      await sb.from("message_logs").insert({ automation_id: a.id, phone: d.phone, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null });
      await new Promise((ok) => setTimeout(ok, 120)); // de a uno, sin apurar a la API
    }
    res[a.nombre] = { enviados, fallidos };
  }
  return json({ ok: true, automaticas: res });
});
