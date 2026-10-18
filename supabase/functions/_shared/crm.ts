// Lógica compartida del CRM (Conversions API, WhatsApp y audiencias de Meta). Sin dependencias: se prueba con Node.
// Las Edge Functions meta-capi, whatsapp-webhook, whatsapp-campana y meta-audiencias la usan.

export const GRAPH = "https://graph.facebook.com";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256(s: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }

// celular como lo pide Meta: solo dígitos con código de país (en la base ya está así: 549223…)
export const soloDigitos = (p: string) => String(p || "").replace(/\D/g, "");
export const hashCelular = (p: string) => sha256(soloDigitos(p));

/* ---------------- Conversions API ---------------- */
export type Pedido = {
  code: string; total: number; closed_at: string | null; phone: string;
  items: { id?: string; qty?: number; precio?: number; subtotal?: number }[];
  landing_page?: string | null;
  origen?: { px?: { fbp?: string; fbc?: string; ua?: string; url?: string } } | null;
};
// px = la persona aceptó el pixel en la web (datos del navegador guardados con el pedido); ads = aceptó anuncios con su celular.
// Sin ninguno de los dos permisos no se manda nada.
export async function eventoPurchase(o: Pedido, permiso: { px: boolean; ads: boolean }, sitio: string) {
  if (!permiso.px && !permiso.ads) return null;
  const px = permiso.px ? o.origen?.px ?? {} : {};
  const user_data: Record<string, unknown> = {};
  if (px.fbp) user_data.fbp = px.fbp;
  if (px.fbc) user_data.fbc = px.fbc;
  if (px.ua) user_data.client_user_agent = px.ua;
  if (permiso.ads) { const h = await hashCelular(o.phone); user_data.ph = [h]; user_data.external_id = [h]; }
  if (!Object.keys(user_data).length) return null; // Meta exige al menos un dato para asociar la compra
  const items = (o.items || []).filter((i) => i.id && i.id !== "gift");
  const web = permiso.px && !!px.ua;
  return {
    event_name: "Purchase",
    event_time: Math.floor(new Date(o.closed_at || Date.now()).getTime() / 1000),
    event_id: "pedido-" + o.code, // el mismo que manda el pixel del navegador: Meta la cuenta una vez
    action_source: web ? "website" : "other",
    ...(web ? { event_source_url: px.url || (sitio ? sitio.replace(/\/$/, "") + (o.landing_page || "/") : undefined) } : {}),
    user_data,
    custom_data: {
      currency: "ARS", value: Number(o.total) || 0, content_type: "product",
      content_ids: [...new Set(items.map((i) => i.id))],
      contents: items.map((i) => ({ id: i.id, quantity: i.qty || 1, item_price: i.precio ?? (i.subtotal && i.qty ? i.subtotal / i.qty : undefined) })),
    },
  };
}

/* ---------------- WhatsApp ---------------- */
// firma del webhook: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, cuerpo crudo)
export async function firmaValida(cuerpo: string, firma: string | null, appSecret: string) {
  if (!firma || !appSecret || !firma.startsWith("sha256=")) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(cuerpo)));
  const dada = firma.slice(7).toLowerCase();
  if (dada.length !== esperada.length) return false;
  let d = 0; for (let i = 0; i < dada.length; i++) d |= dada.charCodeAt(i) ^ esperada.charCodeAt(i); // comparación en tiempo constante
  return d === 0;
}

export type Entrante = { phone: string; wa: string; wamid: string; texto: string }; // wa: el ID de WhatsApp tal cual, para responder
export type Estado = { wamid: string; estado: string; error?: string };
const ESTADOS: Record<string, string> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallo" };
export function leerWebhook(body: any) {
  const entrantes: Entrante[] = [], estados: Estado[] = [];
  for (const e of body?.entry ?? []) for (const ch of e?.changes ?? []) {
    const v = ch?.value ?? {};
    for (const m of v.messages ?? []) {
      const texto = m.text?.body ?? m.button?.text ?? m.button?.payload ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type}]`;
      entrantes.push({ phone: soloDigitos(m.from), wa: soloDigitos(m.from), wamid: m.id, texto: String(texto).slice(0, 1000) });
    }
    for (const s of v.statuses ?? []) {
      estados.push({ wamid: s.id, estado: ESTADOS[s.status] ?? s.status, error: s.errors?.[0] ? `${s.errors[0].code} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : undefined });
    }
  }
  return { entrantes, estados };
}
const quitarTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
// "BAJA", "stop", "no quiero recibir más", "desuscribirme"… / "ALTA" para volver
export function intencion(texto: string): "baja" | "alta" | null {
  const t = quitarTildes(String(texto || "")).toLowerCase().trim();
  const cola = "[\\s!.,]*(por favor|porfa|gracias)?[\\s!.]*$"; // el mensaje es solo eso, no "bajá el precio?"
  if (new RegExp("^(baja|stop|parar|unsubscribe|desuscrib\\w*|quiero darme de baja|darme de baja)" + cola).test(t) || /no (quiero|me) (recibir|manden|mandes|escriban)/.test(t)) return "baja";
  if (new RegExp("^alta" + cola).test(t)) return "alta";
  return null;
}

const primerNombre = (n: string | null) => String(n || "").trim().split(/\s+/)[0] || "";
// cuerpo de una plantilla aprobada: variables en orden, "{nombre}" se reemplaza por el nombre del cliente
export function mensajePlantilla(to: string, plantilla: string, idioma: string, variables: string[], nombre: string | null) {
  const params = (variables || []).map((v) => ({ type: "text", text: String(v).replace(/\{nombre\}/g, primerNombre(nombre) || "¡hola!").slice(0, 1000) }));
  return {
    messaging_product: "whatsapp", to: soloDigitos(to), type: "template",
    template: { name: plantilla, language: { code: idioma || "es_AR" }, ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}) },
  };
}

/* ---------------- Audiencias ---------------- */
export function diferencia(deseados: string[], actuales: string[]) {
  const d = new Set(deseados), a = new Set(actuales);
  return { sumar: [...d].filter((x) => !a.has(x)), sacar: [...a].filter((x) => !d.has(x)) };
}
export const tandas = <T>(l: T[], n: number) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
