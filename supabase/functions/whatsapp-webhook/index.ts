// Edge Function · whatsapp-webhook (se publica sin verificar JWT: Meta no manda uno; se valida con la firma)
// GET: verificación del webhook en la app de Meta (hub.verify_token = WA_VERIFY_TOKEN).
// POST: mensajes entrantes y estados de los enviados. Firma X-Hub-Signature-256 con WA_APP_SECRET.
//   - Guarda respuestas y estados en message_logs.
//   - "BAJA" (o "stop", "no quiero recibir…") revoca el permiso de WhatsApp; "ALTA" lo vuelve a dar. Responde confirmando.
import { env, sb, VERSION } from "../_shared/supa.ts";
import { firmaValida, leerWebhook, intencion } from "../_shared/crm.ts";

async function responder(to: string, texto: string) { // dentro de las 24 h desde que nos escribió: texto libre, sin plantilla
  const id = env("WA_PHONE_NUMBER_ID"), token = env("META_ACCESS_TOKEN"); if (!id || !token) return;
  await fetch(`https://graph.facebook.com/${VERSION}/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } }) }).catch(() => {});
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method === "GET") {
    const ok = u.searchParams.get("hub.mode") === "subscribe" && !!env("WA_VERIFY_TOKEN") && u.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN");
    return ok ? new Response(u.searchParams.get("hub.challenge") ?? "") : new Response("no", { status: 403 });
  }
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const crudo = await req.text();
  if (!(await firmaValida(crudo, req.headers.get("x-hub-signature-256"), env("WA_APP_SECRET")))) return new Response("firma inválida", { status: 401 });
  const { entrantes, estados } = leerWebhook(JSON.parse(crudo || "{}"));

  for (const s of estados) {
    await sb.from("message_logs").update({ estado: s.estado, error: s.error ?? null, updated_at: new Date().toISOString() }).eq("wamid", s.wamid).eq("direccion", "saliente");
  }
  for (const m of entrantes) {
    const i = intencion(m.texto);
    const { data: norm } = await sb.rpc("norm_phone", { p: m.phone }); // mismo formato que pedidos y permisos
    m.phone = norm || m.phone;
    await sb.from("message_logs").insert({ phone: m.phone, direccion: "entrante", wamid: m.wamid, estado: i === "baja" ? "baja" : i === "alta" ? "alta" : "recibido", texto: m.texto });
    if (!i) continue;
    const { data: tiene } = await sb.rpc("puede_contactar", { p_phone: m.phone, p_canal: "whatsapp" });
    if (i === "baja" && tiene) await sb.from("customer_consents").insert({ phone: m.phone, canal: "whatsapp", finalidad: "novedades", estado: "revocado", origen: "whatsapp" });
    if (i === "alta" && !tiene) await sb.from("customer_consents").insert({ phone: m.phone, canal: "whatsapp", finalidad: "novedades", estado: "otorgado", origen: "whatsapp", aviso_version: "whatsapp-alta" });
    await responder(m.wa, i === "baja" ? "Listo, no te vamos a mandar más novedades de Setto. Si algún día querés volver, escribí ALTA." : "¡Listo! Te vamos a avisar las novedades de Setto por acá. Para dejar de recibirlas, escribí BAJA.");
  }
  return new Response("ok");
});
