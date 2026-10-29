// Edge Function · whatsapp-automaticas
//   La llama pg_cron (automaticas_tick, migraciones 051 y 052, con x-setto-hook) con { disparador }:
//   · "compra" (todos los días a las 11 h): a quienes les toca según automatica_destinatarios() (días desde la última compra, una vez por compra).
//   · "premio" (cada hora de 10 a 20 h): ganadores de la maquinita con el premio sin usar que vence pronto, según
//     automatica_premio_destinatarios() (un aviso por premio). Variables extra: {premio}, {codigo}, {vence}.
//     Si la persona nos escribió en las últimas 23,5 h va como texto libre (gratis); si no, con la plantilla aprobada (se paga).
//   En los dos: permiso vigente y nadie recibe dos mensajes de campaña o automática en 7 días.
//   En las de compra, {codigo} y {vence} son el código de descuento personal de la promo elegida (migración 053);
//   en las de premio siguen siendo el código MAQ y el vencimiento del premio.
//   Desde el panel (sesión del equipo): { automation_id, prueba: "223…" } manda solo a ese número, si también aceptó.
// Secretos: META_ACCESS_TOKEN, WA_PHONE_NUMBER_ID. WA_WABA_ID es opcional (por defecto la cuenta de Setto).
import { env, sb, esEquipo, hookValido, graph, json, CORS, VERSION } from "../_shared/supa.ts";
import { mensajePlantilla, valoresCampana, soloDigitos, textoLibre, venceTexto } from "../_shared/crm.ts";
import { usaCodigo, variablesConCodigo } from "../_shared/codigos.ts";

const TOPE = 300; // por automática y por día: lo que entra cómodo en una ejecución

const WABA = () => env("WA_WABA_ID").replace(/\D/g, "") || "1427186512680891";

async function enviar(body: unknown) {
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
    body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) return { error: `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim() };
  return { wamid: d.messages?.[0]?.id as string };
}
// ref: a qué automática se cuenta el código de descuento (la prueba no suma)
async function mandar(to: string, nombre: string | null, a: any, extra: Record<string, string> = {}, ref: { automation_id?: string } = {}) {
  let vars = a.variables;
  if (a.disparador !== "premio") {
    const v = await variablesConCodigo(a.variables, a.promo_id, to, ref);
    if (v.error) return { error: v.error };
    vars = v.variables!;
  }
  return enviar(mensajePlantilla(to, a.plantilla, a.idioma, vars, nombre, extra));
}

// texto de la plantilla (encabezado + cuerpo + link) para mandarlo libre dentro de las 24 h; "" si no se pudo leer
async function cuerpoPlantilla(nombre: string, idioma: string) {
  try {
    const d = await graph(`${WABA()}/message_templates?name=${encodeURIComponent(nombre)}&fields=name,language,components&limit=20`, "GET");
    const t = (d.data || []).find((x: any) => x.name === nombre && x.language === idioma) || (d.data || [])[0];
    const c = (k: string) => (t?.components || []).find((x: any) => x.type === k) || {};
    const url = (c("BUTTONS").buttons || []).find((b: any) => b.type === "URL");
    return [c("HEADER").format === "TEXT" ? `*${c("HEADER").text}*` : "", c("BODY").text || "", url ? `${url.text}: ${url.url}` : ""].filter(Boolean).join("\n\n");
  } catch { return ""; }
}
async function escribioHace24(phone: string) {
  const desde = new Date(Date.now() - 23.5 * 3600e3).toISOString();
  const { count } = await sb.from("message_logs").select("id", { count: "exact", head: true }).eq("phone", phone).eq("direccion", "entrante").gte("created_at", desde);
  return !!count;
}
const extraPremio = (p: { titulo: string; code: string; vence_at: string }) => ({ premio: p.titulo, codigo: p.code, vence: venceTexto(p.vence_at) });
// aviso del premio: gratis como texto libre si nos escribió hace poco; si no, plantilla
async function mandarPremio(d: { phone: string; nombre: string | null }, a: any, extra: Record<string, string>, cuerpo: string) {
  if (cuerpo && (await escribioHace24(d.phone))) {
    const t = textoLibre(cuerpo, valoresCampana(a.variables, d.nombre, extra));
    if (t) return { ...(await enviar({ messaging_product: "whatsapp", to: d.phone, type: "text", text: { body: t, preview_url: true } })), libre: true };
  }
  return { ...(await mandar(d.phone, d.nombre, a, extra)), libre: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cron = await hookValido(req);
  if (!cron && !(await esEquipo(req))) return json({ error: "Solo el equipo puede hacer esto" }, 401);
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return json({ error: "Faltan las credenciales de WhatsApp en los secretos de Supabase" }, 400);
  const { automation_id, prueba, disparador } = await req.json().catch(() => ({}));

  if (!cron) { // el panel solo manda pruebas; el envío real es el del cron
    const { data: a } = await sb.from("marketing_automations").select("*").eq("id", automation_id).maybeSingle();
    if (!a) return json({ error: "No encontramos la automática" }, 404);
    const ph = soloDigitos(prueba || "");
    if (!ph) return json({ error: "Poné el número para la prueba" }, 400);
    const { data: ok } = await sb.rpc("puede_contactar", { p_phone: ph, p_canal: "whatsapp" });
    if (!ok) return json({ error: "Ese número no aceptó novedades por WhatsApp. Marcá la casilla en un pedido o escribí ALTA al WhatsApp de Setto." }, 400);
    const { data: cli } = await sb.from("customers").select("nombre").eq("phone", ph).maybeSingle();
    // la prueba de la de premio usa el último premio de ese número, o uno de ejemplo
    const { data: mp } = a.disparador === "premio" ? await sb.from("maq_premios").select("titulo,code,vence_at").eq("phone", ph).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const extra = a.disparador === "premio" ? extraPremio(mp?.vence_at ? mp : { titulo: "10% off", code: "MAQ-PRUE-BA00", vence_at: new Date(Date.now() + 24 * 3600e3).toISOString() }) : {};
    const r = await mandar(ph, cli?.nombre ?? null, a, extra);
    await sb.from("message_logs").insert({ automation_id: a.id, phone: ph, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null, texto: "[prueba]" });
    return r.error ? json({ error: r.error }, 502) : json({ ok: true, prueba: true });
  }

  const tipo = disparador === "premio" ? "premio" : "compra";
  const { data: autos } = await sb.from("marketing_automations").select("*").eq("activa", true).eq("disparador", tipo);
  const res: Record<string, unknown> = {};
  if (tipo === "premio") {
    for (const a of autos ?? []) {
      const { data: lista, error } = await sb.rpc("automatica_premio_destinatarios", { p_id: a.id });
      if (error) { res[a.nombre] = { error: error.message }; continue; }
      const cuerpo = (lista ?? []).length ? await cuerpoPlantilla(a.plantilla, a.idioma) : "";
      let enviados = 0, gratis = 0, fallidos = 0;
      for (const d of ((lista ?? []) as { phone: string; nombre: string | null; premio: string; code: string; titulo: string; vence_at: string }[]).slice(0, TOPE)) {
        const r = await mandarPremio(d, a, extraPremio(d), cuerpo);
        if (r.wamid) { enviados++; if (r.libre) gratis++; } else fallidos++;
        await sb.from("message_logs").insert({ automation_id: a.id, maq_premio_id: d.premio, phone: d.phone, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null, texto: r.libre ? "[libre] aviso de premio" : null });
        await new Promise((ok) => setTimeout(ok, 120));
      }
      res[a.nombre] = { enviados, gratis, fallidos };
    }
    return json({ ok: true, automaticas: res });
  }
  for (const a of autos ?? []) {
    if (usaCodigo(a.variables) && !a.promo_id) { res[a.nombre] = { error: "usa {codigo} sin código de descuento elegido" }; continue; }
    const { data: lista, error } = await sb.rpc("automatica_destinatarios", { p_id: a.id });
    if (error) { res[a.nombre] = { error: error.message }; continue; }
    let enviados = 0, fallidos = 0;
    for (const d of ((lista ?? []) as { phone: string; nombre: string | null }[]).slice(0, TOPE)) {
      const r = await mandar(d.phone, d.nombre, a, {}, { automation_id: a.id });
      if (r.wamid) enviados++; else fallidos++;
      await sb.from("message_logs").insert({ automation_id: a.id, phone: d.phone, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null });
      await new Promise((ok) => setTimeout(ok, 120)); // de a uno, sin apurar a la API
    }
    res[a.nombre] = { enviados, fallidos };
  }
  return json({ ok: true, automaticas: res });
});
