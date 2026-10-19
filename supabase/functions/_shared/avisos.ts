// Avisos del pedido por WhatsApp (texto libre, sin plantilla). Solo dentro de las 24 h desde el último mensaje del cliente:
// el cliente nos escribe al mandar el pedido desde la web, así que la ventana queda abierta mientras se prepara.
// Fuera de esa ventana WhatsApp no deja mandar texto libre: no se manda y el panel sigue mostrando el botón para hacerlo a mano.
// Lo usan whatsapp-pedido (cambios de estado desde el panel) y whatsapp-webhook (el "Recibido" al llegar el pedido).
import { env, sb, VERSION } from "./supa.ts";
import { textoAviso, textoGift } from "./crm.ts";

// qué clave de orders.avisos marca cada aviso (el panel la lee para saber si ya se avisó)
const MARCA: Record<string, string> = { recibido: "recibido", preparando: "preparando", listo: "listo", entregado: "resena", cambio: "cambio", cancelado: "cancelado" };

export async function avisarPedido(order_id: string, tipo: string) {
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return { omitido: "faltan credenciales" };
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["mensajes", "wa_avisos"]);
  const cfg = Object.fromEntries((st ?? []).map((r: any) => [r.key, r.value]));
  if (cfg.wa_avisos?.activo === false) return { omitido: "avisos apagados" };
  const { data: o } = await sb.from("orders").select("id,code,nombre,phone,wa_phone,track,modo,sellos,cambio,avisos").eq("id", order_id).maybeSingle();
  if (!o) return { omitido: "no existe" };
  const marca = MARCA[tipo];
  if (!marca) return { omitido: "sin aviso" };
  // el mismo aviso no se manda dos veces (salvo un cambio nuevo, que trae otra fecha)
  const ya = o.avisos?.[marca];
  if (ya && (tipo !== "cambio" || ya === o.cambio?.at)) return { omitido: "ya avisado" };
  const tel = o.wa_phone || o.phone; // si tipeó mal su número, el que nos escribió (lo guarda el webhook)
  const desde = new Date(Date.now() - 23.5 * 3600e3).toISOString();
  const { count } = await sb.from("message_logs").select("id", { count: "exact", head: true }).eq("phone", tel).eq("direccion", "entrante").gte("created_at", desde);
  if (!count) return { omitido: "fuera de las 24 h" };
  const texto = textoAviso(tipo, o, cfg.mensajes ?? null, env("SITE_URL"));
  if (!texto) return { omitido: "sin texto" };
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: tel, type: "text", text: { body: texto, preview_url: false } }) });
  const d = await r.json().catch(() => ({}));
  const wamid = d.messages?.[0]?.id ?? null;
  const error = wamid ? null : `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim();
  await sb.from("message_logs").insert({ phone: tel, wamid, estado: wamid ? "enviado" : "fallo", error, texto: `[aviso ${tipo}] ${o.code}` });
  if (!wamid) return { error };
  await sb.from("orders").update({ avisos: { ...(o.avisos || {}), [marca]: tipo === "cambio" && o.cambio?.at ? o.cambio.at : new Date().toISOString() } }).eq("id", o.id);
  return { ok: true, wamid };
}

// Gift card activada (lo dispara el trigger giftcards_wa de la migración 039): le manda al comprador el link para regalarla.
// Misma regla de las 24 h: el comprador nos escribe al reservarla desde la web. Si no se puede, el panel muestra el botón manual.
export async function avisarGift(giftcard_id: string) {
  if (!env("META_ACCESS_TOKEN") || !env("WA_PHONE_NUMBER_ID")) return { omitido: "faltan credenciales" };
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["mensajes", "wa_avisos"]);
  const cfg = Object.fromEntries((st ?? []).map((r: any) => [r.key, r.value]));
  if (cfg.wa_avisos?.activo === false) return { omitido: "avisos apagados" };
  const { data: g } = await sb.from("giftcards").select("id,code,para,monto,token,phone,estado,link_wa_at").eq("id", giftcard_id).maybeSingle();
  if (!g) return { omitido: "no existe" };
  if (g.estado !== "activa") return { omitido: "no está activa" };
  if (g.link_wa_at) return { omitido: "ya avisado" };
  const desde = new Date(Date.now() - 23.5 * 3600e3).toISOString();
  const { count } = await sb.from("message_logs").select("id", { count: "exact", head: true }).eq("phone", g.phone).eq("direccion", "entrante").gte("created_at", desde);
  if (!count) return { omitido: "fuera de las 24 h" };
  const texto = textoGift(g, cfg.mensajes ?? null, env("SITE_URL"));
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: g.phone, type: "text", text: { body: texto, preview_url: true } }) });
  const d = await r.json().catch(() => ({}));
  const wamid = d.messages?.[0]?.id ?? null;
  const error = wamid ? null : `${d.error?.code ?? r.status} ${d.error?.error_data?.details || d.error?.message || ""}`.trim();
  await sb.from("message_logs").insert({ phone: g.phone, wamid, estado: wamid ? "enviado" : "fallo", error, texto: `[aviso gift] ${g.code}` });
  if (!wamid) return { error };
  await sb.from("giftcards").update({ link_wa_at: new Date().toISOString() }).eq("id", g.id);
  return { ok: true, wamid };
}
