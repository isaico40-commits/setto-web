// Edge Function · pedidosya-webhook (se publica sin verificar JWT: PedidosYa no manda uno)
// URL para darle a PedidosYa: https://<proyecto>.supabase.co/functions/v1/pedidosya-webhook?clave=<PEDIDOSYA_WEBHOOK_SECRET>
// No confiamos en lo que trae el aviso: sacamos el número de envío y le preguntamos el estado a PedidosYa.
// El formato exacto del aviso está a confirmar con el sandbox, así que buscamos el id en los lugares más probables.
import { env, json, sb } from "../_shared/supa.ts";
import { aplicar, type Envio, FINALES, leerEnvio, llamar } from "../_shared/pedidosya.ts";

Deno.serve(async (req) => {
  const clave = env("PEDIDOSYA_WEBHOOK_SECRET"), u = new URL(req.url);
  if (req.method !== "POST" || !clave || u.searchParams.get("clave") !== clave) return new Response("no", { status: 401 });
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}));
  const id = b?.shippingId ?? b?.data?.shippingId ?? b?.id ?? b?.data?.id ?? b?.resourceId;
  const ref = b?.referenceId ?? b?.data?.referenceId;
  if (!id && !ref) return json({ ok: true, ignorado: "sin id" });

  let q = sb.from("orders").select("id,pya").not("pya", "is", null).limit(1);
  q = id ? q.eq("pya->>shipping_id", String(id)) : q.eq("code", String(ref));
  const { data: o } = await q.maybeSingle<{ id: string; pya: Envio }>();
  if (!o?.pya?.shipping_id) return json({ ok: true, ignorado: "envío desconocido" });
  if (o.pya.simulado || (o.pya.status && FINALES.includes(o.pya.status))) return json({ ok: true });

  const token = env("PEDIDOSYA_TOKEN");
  if (!token) return json({ ok: true, ignorado: "sin token" });
  try {
    const base = env("PEDIDOSYA_BASE_URL") || "https://courier-api.pedidosya.com";
    const r = await llamar(base, token, "GET", `/v3/shippings/${encodeURIComponent(o.pya.shipping_id)}`);
    await sb.from("orders").update({ pya: aplicar(o.pya, leerEnvio(r)) }).eq("id", o.id);
    return json({ ok: true });
  } catch (err) {
    console.error("pedidosya-webhook", (err as Error).message);
    return json({ ok: false }, 500); // que PedidosYa reintente
  }
});
