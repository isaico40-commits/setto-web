// Variables de campaña según lo que compra cada cliente: {favorito} = lo que más pidió, {ultimo} = lo último que pidió.
// Solo cuentan productos que hoy están en la carta (un especial que ya cerró no se ofrece).
// Si todavía no pidió nada por la web, va lo más vendido de los últimos pedidos (el mensaje nunca sale con un hueco).
import { sb } from "./supa.ts";

const NO_PRODUCTO = new Set(["envio", "premio", "maquinita", "gift", "codigo"]); // líneas de descuento o envío
const nombreItem = (it: any) => String(it?.nombre || "").trim();
// la carta y lo más vendido se leen una vez y se reusan 10 minutos (la función puede quedar viva entre envíos)
let leido = 0;
const fresco = () => { if (Date.now() - leido > 600e3) { enCarta = masVendido = null; leido = Date.now(); } };
let enCarta: Promise<Set<string>> | null = null;
let masVendido: Promise<string> | null = null;
const carta = () => (fresco(), enCarta ??= sb.from("products").select("id").eq("activo", true).then(({ data }) => new Set((data ?? []).map((p: any) => String(p.id)))));
const productos = (items: unknown, ok: Set<string>) => (Array.isArray(items) ? items : []).filter((it: any) => it && !NO_PRODUCTO.has(String(it.id)) && ok.has(String(it.id)) && nombreItem(it));

export const usaCliente = (vars: unknown[]) => (vars || []).some((v) => /\{(favorito|ultimo)\}/.test(String(v)));

// lo más pedido de una lista de pedidos (por unidades; si empatan, el más reciente)
function masPedido(pedidos: { items: unknown }[], ok: Set<string>) {
  const n = new Map<string, number>();
  for (const o of pedidos) for (const it of productos(o.items, ok)) n.set(nombreItem(it), (n.get(nombreItem(it)) || 0) + (Number((it as any).qty) || 1));
  let top = "", max = 0;
  for (const [k, v] of n) if (v > max) { top = k; max = v; } // Map conserva el orden: el primero visto es el más reciente
  return top;
}

function masVendidoGeneral() {
  fresco();
  masVendido ??= (async () => {
    const { data } = await sb.from("orders").select("items").neq("status", "cancelado").order("created_at", { ascending: false }).limit(300);
    return masPedido(data ?? [], await carta()) || "algo rico";
  })();
  return masVendido;
}

export async function variablesCliente(vars: string[], phone: string) {
  if (!usaCliente(vars)) return vars;
  const { data } = await sb.from("orders").select("items").eq("phone", phone).neq("status", "cancelado").order("created_at", { ascending: false }).limit(50);
  const pedidos = data ?? [], ok = await carta();
  const ultimo = nombreItem(pedidos.map((o) => productos(o.items, ok)[0]).find(Boolean)) || (await masVendidoGeneral());
  const favorito = masPedido(pedidos, ok) || (await masVendidoGeneral());
  return vars.map((v) => String(v).replace(/\{favorito\}/g, favorito).replace(/\{ultimo\}/g, ultimo));
}
