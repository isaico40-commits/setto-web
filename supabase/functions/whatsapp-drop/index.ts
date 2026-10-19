// Edge Function · whatsapp-drop (la llama drop_enviar() de la migración 033, con la clave de Vault)
// Avisa el lanzamiento de la edición especial por WhatsApp a todos los anotados en drop_wa, con la plantilla aprobada
// aviso_drop: {{1}} nombre, {{2}} nombre del drop ("Nombre en el WhatsApp" del panel, o el título de la edición).
// Secretos: META_ACCESS_TOKEN, WA_PHONE_NUMBER_ID.
import { env, sb, hookValido, json, VERSION } from "../_shared/supa.ts";
import { mensajePlantilla, nombreDrop } from "../_shared/crm.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" || !(await hookValido(req))) return json({ error: "no autorizado" }, 401);
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return json({ error: "Faltan las credenciales de WhatsApp" }, 400);
  const { data: st } = await sb.from("settings").select("value").eq("key", "especial").maybeSingle();
  const E = st?.value ?? {};
  const plantilla = String(E.wa_plantilla || "aviso_drop");
  const { data: subs } = await sb.from("drop_wa").select("phone,nombre");
  let enviados = 0, fallidos = 0;
  for (const s of subs ?? []) {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
      body: JSON.stringify(mensajePlantilla(s.phone, plantilla, "es_AR", ["{nombre}", nombreDrop(E)], s.nombre)) });
    const d = await r.json().catch(() => ({}));
    const wamid = d.messages?.[0]?.id ?? null;
    const error = wamid ? null : `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim();
    if (wamid) enviados++; else fallidos++;
    await sb.from("message_logs").insert({ phone: s.phone, wamid, estado: wamid ? "enviado" : "fallo", error, texto: "[aviso drop]" });
    await new Promise((ok) => setTimeout(ok, 120)); // de a uno, sin apurar a la API
  }
  return json({ ok: true, total: subs?.length ?? 0, enviados, fallidos });
});
