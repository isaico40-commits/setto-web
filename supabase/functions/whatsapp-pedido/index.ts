// Edge Function · whatsapp-pedido (la llama el trigger orders_wa de la migración 036, con la clave de Vault)
// Cuando el pedido cambia de etapa, se entrega, se cancela o falta algo, le avisa al cliente por WhatsApp.
// También la llama el trigger giftcards_wa (migración 039) con { giftcard_id }: le manda al comprador el link de la gift card.
// Secretos: META_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, SITE_URL.
import { hookValido, json } from "../_shared/supa.ts";
import { avisarPedido, avisarGift } from "../_shared/avisos.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" || !(await hookValido(req))) return json({ error: "no autorizado" }, 401);
  const { order_id, tipo, giftcard_id } = await req.json().catch(() => ({}));
  if (giftcard_id) return json(await avisarGift(giftcard_id));
  if (!order_id || !tipo) return json({ error: "falta order_id o tipo" }, 400);
  return json(await avisarPedido(order_id, tipo));
});
