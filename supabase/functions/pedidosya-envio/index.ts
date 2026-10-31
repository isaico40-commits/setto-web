// Edge Function · pedidosya-envio (la llama el panel, con el usuario del equipo logueado)
// { accion: "cotizar" | "confirmar" | "estado" | "cancelar", order_id, offer_id? }
// Guarda todo en orders.pya (migración 056) y devuelve el envío actualizado.
// Secretos: PEDIDOSYA_TOKEN (sin él, o con "Modo simulado" prendido en Ajustes, simula las respuestas sin llamar a PedidosYa)
//           PEDIDOSYA_BASE_URL (opcional, por si el sandbox usa otra dirección; por defecto https://courier-api.pedidosya.com)
import { CORS, env, esEquipo, json, sb } from "../_shared/supa.ts";
import { aplicar, type Config, cuerpoCotizacion, type Envio, FINALES, leerCotizacion, leerEnvio, llamar, type Pedido,
  simularConfirmacion, simularCotizacion, simularEstado } from "../_shared/pedidosya.ts";

const BASE = () => env("PEDIDOSYA_BASE_URL") || "https://courier-api.pedidosya.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" || !(await esEquipo(req))) return json({ error: "Solo el equipo puede pedir envíos" }, 401);
  const { accion, order_id, offer_id } = await req.json().catch(() => ({}));
  if (!order_id) return json({ error: "Falta el pedido" }, 400);

  const [{ data: cfg }, { data: o }] = await Promise.all([
    sb.from("pedidosya_config").select("*").eq("id", 1).maybeSingle<Config & { simulado: boolean }>(),
    sb.from("orders").select("id,code,nombre,phone,direccion,nota,items,modo,status,pya").eq("id", order_id).maybeSingle<Pedido & { modo: string; status: string }>(),
  ]);
  if (!o) return json({ error: "No encontramos el pedido" }, 404);
  if (!cfg?.activo) return json({ error: "PedidosYa Envíos está apagado. Prendelo en Ajustes → PedidosYa Envíos" }, 400);
  const token = env("PEDIDOSYA_TOKEN"), sim = !token || !!cfg.simulado;
  const prev: Envio = (o.pya as Envio) || { estado: "error", simulado: sim };
  if (!o.pya && accion !== "cotizar") return json({ error: "Primero cotizá el envío" }, 400);
  const guardar = async (e: Envio) => { const { error } = await sb.from("orders").update({ pya: e }).eq("id", o.id); if (error) throw new Error(error.message); return json({ pya: e }); };

  try {
    if (accion === "cotizar") {
      if (o.modo !== "envio") throw new Error("Este pedido es para retirar");
      if (o.status !== "pendiente") throw new Error("El pedido ya no está pendiente");
      if (prev.estado === "confirmado" && prev.status !== "CANCELLED") throw new Error("Este pedido ya tiene un envío pedido");
      const body = cuerpoCotizacion(o, cfg);
      const r = sim ? simularCotizacion(o) : await llamar(BASE(), token, "POST", "/v3/shippings/estimates", body);
      const { estimate_id, ofertas } = leerCotizacion(r);
      return await guardar({ estado: "cotizado", simulado: sim, prueba: !!cfg.prueba, estimate_id, ofertas, cotizado_at: new Date().toISOString() });
    }

    if (accion === "confirmar") {
      if (prev.estado !== "cotizado" || !prev.estimate_id) throw new Error("Primero cotizá el envío");
      if (prev.simulado !== sim) throw new Error("Cambió el modo (simulado/real): cotizá de nuevo");
      const of = (prev.ofertas || []).find((x) => x.id === offer_id) || (prev.ofertas || [])[0];
      if (!of) throw new Error("La cotización no tiene opciones: cotizá de nuevo");
      if (of.limite && Date.parse(of.limite) < Date.now()) throw new Error("La cotización venció: cotizá de nuevo");
      const r = sim ? simularConfirmacion(o, of)
        : await llamar(BASE(), token, "POST", `/v3/shippings/estimates/${encodeURIComponent(prev.estimate_id)}/confirm`, { deliveryOfferId: of.id });
      const ahora = new Date().toISOString();
      const e = aplicar({ ...prev, estado: "confirmado", offer_id: of.id, precio: of.total, moneda: of.moneda, desde: of.desde, hasta: of.hasta, confirmado_at: ahora }, leerEnvio(r), ahora);
      if (!e.shipping_id) throw new Error("PedidosYa no devolvió el número de envío. Revisá en su panel antes de volver a pedirlo.");
      return await guardar(e);
    }

    if (accion === "estado") {
      if (!prev.shipping_id) throw new Error("Este pedido no tiene envío");
      if (prev.status && FINALES.includes(prev.status)) return json({ pya: prev });
      const r = prev.simulado ? simularEstado(prev) : await llamar(BASE(), token, "GET", `/v3/shippings/${encodeURIComponent(prev.shipping_id)}`);
      return await guardar(aplicar(prev, leerEnvio(r)));
    }

    if (accion === "cancelar") {
      if (prev.estado === "cotizado") return await guardar({ ...prev, estado: "cancelado", actualizado: new Date().toISOString() }); // solo cotizado: no hay nada en PedidosYa
      if (!prev.shipping_id) throw new Error("Este pedido no tiene envío");
      if (prev.status && FINALES.includes(prev.status)) throw new Error("El envío ya terminó");
      if (["IN_PROGRESS", "NEAR_PICKUP", "PICKED_UP", "NEAR_DROPOFF"].includes(prev.status || "")) throw new Error("El repartidor ya está en camino: para cancelar hay que hablar con soporte de PedidosYa");
      const r = prev.simulado ? { shippingId: prev.shipping_id, status: "CANCELLED" }
        : await llamar(BASE(), token, "POST", `/v3/shippings/${encodeURIComponent(prev.shipping_id)}/cancel`, { reasonText: "Cancelado por el comercio" });
      return await guardar(aplicar(prev, { status: "CANCELLED", ...leerEnvio(r) }));
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    const msg = (err as Error).message;
    // si falla la cotización no pisamos un envío ya confirmado; solo anotamos el error
    await sb.from("orders").update({ pya: { ...prev, error: msg, actualizado: new Date().toISOString() } }).eq("id", o.id);
    return json({ error: msg }, 400);
  }
});
