// PedidosYa Envíos · Courier API v3. Lógica sin base de datos (la usan pedidosya-envio y pedidosya-webhook, y los tests).
//
// De dónde sale cada cosa (la doc oficial, developers.pedidosya.com/courier-api, solo carga en el navegador):
//   - Base https://courier-api.pedidosya.com, header "Authorization: <token>" sin "Bearer".
//   - POST /v3/shippings/estimates                         → cotiza: estimateId + deliveryOffers[{ deliveryOfferId, deliveryMode, pricing{ total, currency }, ... }]
//   - POST /v3/shippings/estimates/{estimateId}/confirm    → { deliveryOfferId } crea el envío: shippingId, confirmationCode, status, shareLocationUrl
//   - GET  /v3/shippings/{shippingId}                      → estado del envío
//   - POST /v3/shippings/{shippingId}/cancel               → cancela (si ya está IN_PROGRESS hay que pedírselo a PedidosYa)
//   Tomado de una copia pública de la spec OpenAPI "PedidosYa Courier API 3.0.0" y de integraciones de terceros.
//   GET de estado, cancel y el webhook están A CONFIRMAR con el sandbox: por eso la ruta base se puede cambiar
//   con PEDIDOSYA_BASE_URL y el webhook solo dispara una consulta de estado (no confía en lo que trae).

export type Config = {
  activo: boolean; prueba: boolean;
  nombre: string; telefono: string; direccion: string; referencia?: string | null; ciudad: string;
  lat?: number | null; lng?: number | null; instrucciones?: string | null;
  peso_kg: number; volumen_cm3: number;
};
export type Item = { id: string; nombre: string; qty: number; subtotal?: number };
export type Pedido = { id: string; code: string; nombre: string; phone: string; direccion: string | null; nota?: string | null; items: Item[]; pya?: Envio | null };
export type Oferta = { id: string; modo: string; total: number; moneda: string; desde?: string; hasta?: string; retiro?: string; limite?: string };
export type Envio = {
  estado: "cotizado" | "confirmado" | "cancelado" | "error";
  simulado: boolean; prueba?: boolean;
  estimate_id?: string; ofertas?: Oferta[]; cotizado_at?: string;
  offer_id?: string; shipping_id?: string; codigo?: string; status?: string;
  precio?: number; moneda?: string; tracking_url?: string; soporte_url?: string;
  desde?: string; hasta?: string; confirmado_at?: string;
  historial?: { status: string; at: string }[];
  error?: string; actualizado?: string;
};

const NO_PROD = ["envio", "premio", "maquinita", "gift", "codigo"];
// celular argentino en formato internacional: "223 347-1277" → "+5492233471277"
export const tel = (p: string) => { let d = String(p || "").replace(/\D/g, "").replace(/^0/, ""); if (d.length === 10) d = "549" + d; return d ? "+" + d : ""; };

// estados de PedidosYa → texto para el panel (los que no conozcamos se muestran tal cual)
export const ESTADOS: Record<string, string> = {
  PREORDER: "Reservado", CONFIRMED: "Buscando repartidor", IN_PROGRESS: "En camino", NEAR_PICKUP: "Llegando a buscarlo",
  PICKED_UP: "Lo retiró el repartidor", NEAR_DROPOFF: "Llegando al cliente", COMPLETED: "Entregado", DELIVERED: "Entregado", CANCELLED: "Cancelado",
};
export const FINALES = ["COMPLETED", "DELIVERED", "CANCELLED"];

// cuerpo de la cotización: un ítem con el resumen del pedido (para el repartidor) y dos puntos, retiro y entrega
export function cuerpoCotizacion(o: Pedido, c: Config) {
  const prods = (o.items || []).filter((i) => !NO_PROD.includes(i.id));
  const valor = Math.max(1, Math.round(prods.reduce((a, i) => a + (Number(i.subtotal) || 0), 0)));
  const unidades = prods.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  if (!o.direccion || o.direccion.trim().length < 5) throw new Error("El pedido no tiene dirección de entrega");
  if (!c.direccion || !c.telefono) throw new Error("Falta cargar la dirección y el teléfono de retiro en Ajustes → PedidosYa Envíos");
  const punto = (lat?: number | null, lng?: number | null) => (lat != null && lng != null ? { latitude: Number(lat), longitude: Number(lng) } : {});
  return {
    referenceId: o.code,
    isTest: !!c.prueba,
    items: [{ type: "STANDARD", value: valor, description: `Pedido ${o.code} · ${unidades} producto${unidades === 1 ? "" : "s"} de cafetería`.slice(0, 100), sku: o.code, quantity: 1, volume: Number(c.volumen_cm3) || 6000, weight: Number(c.peso_kg) || 1.5 }],
    waypoints: [
      { type: "PICK_UP", addressStreet: c.direccion.trim(), addressAdditional: c.referencia || undefined, city: c.ciudad || "Mar del Plata", ...punto(c.lat, c.lng),
        phone: tel(c.telefono), name: c.nombre || "Setto", instructions: c.instrucciones || undefined },
      { type: "DROP_OFF", addressStreet: o.direccion.trim(), city: c.ciudad || "Mar del Plata",
        phone: tel(o.phone), name: o.nombre || "Cliente", instructions: o.nota ? String(o.nota).slice(0, 200) : undefined },
    ],
  };
}

// lee la respuesta de la cotización (campos opcionales: la tomamos como venga)
// deno-lint-ignore no-explicit-any
export function leerCotizacion(r: any): { estimate_id: string; ofertas: Oferta[] } {
  const estimate_id = String(r?.estimateId ?? r?.id ?? "");
  // deno-lint-ignore no-explicit-any
  const ofertas: Oferta[] = (r?.deliveryOffers || []).map((x: any) => ({
    id: String(x.deliveryOfferId ?? ""), modo: String(x.deliveryMode ?? ""),
    total: Number(x.pricing?.total ?? 0), moneda: String(x.pricing?.currency ?? "ARS"),
    desde: x.deliveryTimeFrom, hasta: x.deliveryTimeTo, retiro: x.estimatedPickUpTime, limite: x.confirmationTimeLimit,
  })).filter((x: Oferta) => x.id);
  if (!estimate_id || !ofertas.length) throw new Error("PedidosYa no devolvió opciones de envío para esa dirección");
  return { estimate_id, ofertas: ofertas.sort((a, b) => a.total - b.total) };
}

// lee un envío (respuesta de confirmar o de consultar estado)
// deno-lint-ignore no-explicit-any
export function leerEnvio(r: any): Partial<Envio> {
  const p = r?.route?.pricing ?? r?.pricing ?? {};
  const out: Partial<Envio> = {
    shipping_id: r?.shippingId != null ? String(r.shippingId) : r?.id != null ? String(r.id) : undefined,
    codigo: r?.confirmationCode != null ? String(r.confirmationCode) : undefined,
    status: r?.status ? String(r.status) : undefined,
    tracking_url: r?.shareLocationUrl || undefined, soporte_url: r?.onlineSupportUrl || undefined,
    precio: p.total != null ? Number(p.total) : undefined, moneda: p.currency || undefined,
    desde: r?.route?.deliveryTimeFrom || undefined, hasta: r?.route?.deliveryTimeTo || undefined,
  };
  for (const k of Object.keys(out) as (keyof Envio)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// junta lo nuevo con lo que ya había y anota el cambio de estado en el historial
export function aplicar(prev: Envio, nuevo: Partial<Envio>, ahora = new Date().toISOString()): Envio {
  const e: Envio = { ...prev, ...nuevo, actualizado: ahora, error: undefined };
  if (nuevo.status && nuevo.status !== prev.status) e.historial = [...(prev.historial || []), { status: nuevo.status, at: ahora }].slice(-20);
  if (nuevo.status === "CANCELLED") e.estado = "cancelado";
  return e;
}

/* ---------- modo simulado: mismas formas de respuesta, sin llamar a PedidosYa ---------- */
const PASOS = ["CONFIRMED", "IN_PROGRESS", "PICKED_UP", "COMPLETED"]; // uno cada 2 minutos
export function simularCotizacion(o: Pedido, ahora = Date.now()) {
  const largo = (o.direccion || "").length, base = 2400 + (largo % 7) * 350; // precio de mentira, estable por dirección
  const iso = (min: number) => new Date(ahora + min * 60000).toISOString();
  return { estimateId: "SIM-" + o.code, deliveryOffers: [
    { deliveryOfferId: "SIM-EXP-" + o.code, deliveryMode: "EXPRESS", pricing: { total: base, currency: "ARS" }, deliveryTimeFrom: iso(30), deliveryTimeTo: iso(50), estimatedPickUpTime: iso(12), confirmationTimeLimit: iso(10) },
  ] };
}
export function simularConfirmacion(o: Pedido, oferta: Oferta | undefined) {
  return { shippingId: "SIM-" + o.code, confirmationCode: String(100000 + (parseInt(o.code.replace(/\D/g, "") || "0", 10) % 900000)), status: "CONFIRMED",
    shareLocationUrl: null, onlineSupportUrl: null, route: { pricing: { total: oferta?.total ?? 0, currency: oferta?.moneda ?? "ARS" }, deliveryTimeFrom: oferta?.desde, deliveryTimeTo: oferta?.hasta } };
}
export function simularEstado(e: Envio, ahora = Date.now()) {
  if (e.status === "CANCELLED") return { shippingId: e.shipping_id, status: "CANCELLED" };
  const min = (ahora - Date.parse(e.confirmado_at || new Date(ahora).toISOString())) / 60000;
  return { shippingId: e.shipping_id, confirmationCode: e.codigo, status: PASOS[Math.min(PASOS.length - 1, Math.max(0, Math.floor(min / 2)))] };
}

/* ---------- llamadas reales ---------- */
export async function llamar(base: string, token: string, metodo: "GET" | "POST", ruta: string, body?: unknown) {
  const r = await fetch(base.replace(/\/$/, "") + ruta, {
    method: metodo, headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  // deno-lint-ignore no-explicit-any
  let data: any = {}; try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { message: txt.slice(0, 200) }; }
  if (!r.ok) {
    const m = data?.messages?.[0] ?? data?.message ?? data?.code ?? `PedidosYa respondió ${r.status}`;
    throw new Error(r.status === 401 || r.status === 403 ? "PedidosYa rechazó el token (revisá PEDIDOSYA_TOKEN)" : `PedidosYa: ${typeof m === "string" ? m : JSON.stringify(m)}`.slice(0, 300));
  }
  return data;
}
