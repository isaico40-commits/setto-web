// Edge Function · whatsapp-campana (la llama el panel con la sesión del equipo)
// Manda una campaña en borrador con su plantilla aprobada a los clientes del segmento que aceptaron WhatsApp.
// Con "prueba": manda solo a ese número, y solo si ese número también aceptó (nadie se saltea el permiso).
// Secretos: META_ACCESS_TOKEN, WA_PHONE_NUMBER_ID.
import { env, sb, esEquipo, json, CORS, VERSION } from "../_shared/supa.ts";
import { mensajePlantilla, soloDigitos } from "../_shared/crm.ts";
import { usaCodigo, variablesConCodigo } from "../_shared/codigos.ts";
import { variablesCliente } from "../_shared/cliente.ts";

async function mandar(to: string, nombre: string | null, c: any, prueba = false) {
  // {favorito} y {ultimo}: según lo que pidió cada uno. {codigo} y {vence}: el código personal de la promo elegida, uno por destinatario (el de la prueba no suma a la campaña)
  const v = await variablesConCodigo(await variablesCliente(c.variables, to), c.promo_id, to, prueba ? {} : { campaign_id: c.id });
  if (v.error) return { error: v.error };
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
    body: JSON.stringify(mensajePlantilla(to, c.plantilla, c.idioma, v.variables!, nombre)) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) return { error: `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim() };
  return { wamid: d.messages?.[0]?.id as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await esEquipo(req))) return json({ error: "Solo el equipo puede mandar campañas" }, 401);
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return json({ error: "Faltan las credenciales de WhatsApp en los secretos de Supabase" }, 400);
  const { campaign_id, prueba } = await req.json().catch(() => ({}));
  const { data: c } = await sb.from("marketing_campaigns").select("*").eq("id", campaign_id).maybeSingle();
  if (!c) return json({ error: "No encontramos la campaña" }, 404);

  if (prueba) {
    const ph = soloDigitos(prueba);
    const { data: ok } = await sb.rpc("puede_contactar", { p_phone: ph, p_canal: "whatsapp" });
    if (!ok) return json({ error: "Ese número no aceptó novedades por WhatsApp. Marcá la casilla en un pedido o escribí ALTA al WhatsApp de Setto." }, 400);
    const { data: cli } = await sb.from("customers").select("nombre").eq("phone", ph).maybeSingle();
    const r = await mandar(ph, cli?.nombre ?? null, c, true);
    await sb.from("message_logs").insert({ campaign_id: c.id, phone: ph, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null, texto: "[prueba]" });
    return r.error ? json({ error: r.error }, 502) : json({ ok: true, prueba: true });
  }

  if (c.estado !== "borrador") return json({ error: "Esta campaña ya se mandó" }, 409);
  if (usaCodigo(c.variables) && !c.promo_id) return json({ error: "La plantilla usa {codigo} pero la campaña no tiene un código de descuento elegido" }, 400);
  const { data: lista, error } = await sb.rpc("segmento_clientes", { p_segmento: c.segmento, p_canal: "whatsapp" });
  if (error) return json({ error: error.message }, 500);
  const dest = (lista ?? []) as { phone: string; nombre: string | null }[];
  await sb.from("marketing_campaigns").update({ estado: "enviando", total: dest.length }).eq("id", c.id);
  let enviados = 0, fallidos = 0;
  for (const d of dest) {
    const r = await mandar(d.phone, d.nombre, c);
    if (r.wamid) enviados++; else fallidos++;
    await sb.from("message_logs").insert({ campaign_id: c.id, phone: d.phone, wamid: r.wamid ?? null, estado: r.wamid ? "enviado" : "fallo", error: r.error ?? null });
    await new Promise((ok) => setTimeout(ok, 120)); // de a uno, sin apurar a la API
  }
  await sb.from("marketing_campaigns").update({ estado: fallidos && !enviados ? "error" : "enviada", enviados, fallidos, enviada_at: new Date().toISOString() }).eq("id", c.id);
  return json({ ok: true, total: dest.length, enviados, fallidos });
});
