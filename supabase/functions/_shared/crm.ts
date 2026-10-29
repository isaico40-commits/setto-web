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

// anuncio: si el chat empezó desde un anuncio de Meta que abre WhatsApp, de cuál vino (lo manda Meta en "referral")
export type Anuncio = { anuncio_id: string | null; anuncio_tipo: string | null; anuncio_titulo: string | null; anuncio_url: string | null; ctwa_clid: string | null };
export type Entrante = { phone: string; wa: string; wamid: string; texto: string; anuncio: Anuncio | null }; // wa: el ID de WhatsApp tal cual, para responder
export type Estado = { wamid: string; estado: string; error?: string };
const ESTADOS: Record<string, string> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallo" };
export function leerWebhook(body: any) {
  const entrantes: Entrante[] = [], estados: Estado[] = [];
  for (const e of body?.entry ?? []) for (const ch of e?.changes ?? []) {
    const v = ch?.value ?? {};
    for (const m of v.messages ?? []) {
      const texto = m.text?.body ?? m.button?.text ?? m.button?.payload ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type}]`;
      const r = m.referral, corto = (x: unknown, n: number) => (x ? String(x).slice(0, n) : null);
      const anuncio = r ? { anuncio_id: corto(r.source_id, 40), anuncio_tipo: corto(r.source_type, 20), anuncio_titulo: corto(r.headline, 200), anuncio_url: corto(r.source_url, 300), ctwa_clid: corto(r.ctwa_clid, 300) } : null;
      entrantes.push({ phone: soloDigitos(m.from), wa: soloDigitos(m.from), wamid: m.id, texto: String(texto).slice(0, 1000), anuncio });
    }
    for (const s of v.statuses ?? []) {
      estados.push({ wamid: s.id, estado: ESTADOS[s.status] ?? s.status, error: s.errors?.[0] ? `${s.errors[0].code} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : undefined });
    }
  }
  return { entrantes, estados };
}
const quitarTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// "BAJA", "stop", "no quiero recibir más", el botón "No quiero más novedades" de las plantillas… / "ALTA" para volver
export function intencion(texto: string): "baja" | "alta" | null {
  const t = quitarTildes(String(texto || "")).toLowerCase().trim();
  const cola = "[\\s!.,]*(por favor|porfa|gracias)?[\\s!.]*$"; // el mensaje es solo eso, no "bajá el precio?"
  if (new RegExp("^(baja|stop|parar|unsubscribe|desuscrib\\w*|quiero darme de baja|darme de baja)" + cola).test(t) || /no (quiero|me) (recibir|manden|mandes|escriban)/.test(t) || /^no quiero (mas )?(novedades|mensajes|promos|avisos)[\s!.]*$/.test(t)) return "baja";
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

// nombre del drop para el WhatsApp: el que se cargó en el panel o "la edición <título>" sin signos sueltos
export function nombreDrop(E: { wa_nombre?: string; titulo?: string }) {
  const propio = String(E?.wa_nombre || "").trim();
  if (propio) return propio.slice(0, 60);
  const t = String(E?.titulo || "").replace(/[¡!]+/g, "").trim();
  if (!t) return "la edición especial";
  return (/^(la |el |los |las )/i.test(t) ? t : /^edici[oó]n /i.test(t) ? t.replace(/^edici[oó]n /i, "la edición ") : "la edición " + t).slice(0, 60);
}

/* ---------------- Avisos del pedido por WhatsApp ---------------- */
// aviso del sello de regalo por la reseña de la primera compra (lo mismo en js/mensajes.js)
export const SELLO_RESENA = "Como es tu primera compra en la web, si nos dejás tu reseña con un comentario o una foto, te regalamos 1 sello extra del Setto Club 🎁";
// Mismos textos por defecto que js/mensajes.js (se editan en Panel → Ajustes → Mensajes y llegan en settings.mensajes).
export const AVISOS: Record<string, string> = {
  aviso_recibido: "¡Hola {nombre}! Recibimos tu pedido {codigo} de Setto. Te avisamos cuando esté listo.\n\nSeguí tu pedido acá: {link}",
  aviso_preparando: "¡Hola {nombre}! Ya estamos preparando tu pedido {codigo} de Setto.\n\nSeguí tu pedido acá: {link}",
  aviso_listo: "¡Hola {nombre}! Tu pedido {codigo} de Setto está listo. Ya podés pasar a buscarlo 🙌\n\nSeguí tu pedido acá: {link}",
  aviso_camino: "¡Hola {nombre}! Tu pedido {codigo} de Setto ya salió y va en camino 🛵\n\nSeguí tu pedido acá: {link}",
  pedir_resena: "¡Gracias por tu pedido, {nombre}! 🙌 {sellos}\n\n{sello_resena}\n\nAcá ves cómo armar tu bebida, tus sellos y, si te gustó, podés dejar tu reseña (con foto si querés):\n{link}",
  pedir_cambio: "¡Hola {nombre}! Perdón, nos quedamos sin {faltan} para tu pedido {codigo} 😕\n\nElegí acá con qué lo reemplazamos o si preferís sacarlo (el total se ajusta solo):\n{link}",
  aviso_cancelado: "Hola {nombre}, cancelamos tu pedido {codigo} de Setto. Si tenés alguna duda, respondé este mensaje.",
  gift_activa: "¡Listo! 🎁 Tu gift card de Setto para {para} ya está activa ({monto}).\n\nMandale este link para que la vea y la use:\n{link}",
};
// gift card activada → texto para el comprador con el link de regalo (mismo link que arma el panel)
export function textoGift(g: { para: string | null; monto: number; token: string }, mensajes: Record<string, string> | null, sitio: string) {
  const propio = String(mensajes?.gift_activa ?? "").trim();
  return rellenar(propio || AVISOS.gift_activa, {
    para: String(g.para || "").trim(), monto: "$" + Number(g.monto || 0).toLocaleString("es-AR"),
    link: `${String(sitio || "").replace(/\/$/, "")}/gift-cards?regalo=${g.token}`,
  });
}
export type PedidoAviso = { code: string; nombre: string | null; track: string | null; modo: string | null; sellos?: number | null; sello_resena?: boolean; cambio?: { faltan?: { qty: number; nombre: string; size?: string }[] } | null };
// igual que render() de js/mensajes.js: rellena {variables}, borra líneas "Etiqueta: {var}" vacías y espacios de más
export function rellenar(t: string, vars: Record<string, unknown>) {
  t = t.split("\n").filter((ln) => { const m = ln.match(/^[^{}]*:\s*\{(\w+)\}\s*$/); return !(m && !String(vars[m[1]] ?? "").trim()); }).join("\n");
  t = t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
  return t.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
// tipo: recibido | preparando | listo | entregado | cambio | cancelado → texto listo para mandar (o null si no hay aviso)
export function textoAviso(tipo: string, o: PedidoAviso, mensajes: Record<string, string> | null, sitio: string) {
  const key = ({ recibido: "aviso_recibido", preparando: "aviso_preparando", listo: o.modo === "envio" ? "aviso_camino" : "aviso_listo",
    entregado: "pedir_resena", cambio: "pedir_cambio", cancelado: "aviso_cancelado" } as Record<string, string>)[tipo];
  if (!key) return null;
  const base = String(sitio || "").replace(/\/$/, ""), q = o.track ? `?seguir=${o.track}` : "";
  const s = Number(o.sellos) || 0;
  const faltan = (o.cambio?.faltan || []).map((f) => `${f.qty} ${String(f.nombre).replace(/^Mochi /, "mochi ")}${f.size ? ` (${f.size})` : ""}`).join(" y ");
  const propio = String(mensajes?.[key] ?? "").trim();
  return rellenar(propio || AVISOS[key], {
    nombre: String(o.nombre || "").trim().split(/\s+/)[0] || "", codigo: o.code, faltan,
    link: tipo === "entregado" ? `${base}/listo${q}` : `${base}/${q}`,
    sellos: s > 0 ? `Sumaste ${s === 1 ? "1 sello" : s + " sellos"} al Setto Club.` : "",
    sello_resena: tipo === "entregado" && o.sello_resena ? SELLO_RESENA : "",
  });
}
// el mensaje con el pedido que manda el cliente desde la web trae el código: "Te paso mi pedido STT-1234 …"
export const codigoPedido = (texto: string) => (String(texto || "").toUpperCase().match(/\bSTT-\d{3,6}\b/) || [""])[0] || null;
// …y el link de seguimiento (?seguir=<track>): es secreto, así que encuentra el pedido aunque haya tipeado mal su número
export const trackPedido = (texto: string) => (String(texto || "").match(/[?&]seguir=([a-f0-9]{16,64})(?![a-z0-9])/i) || [])[1]?.toLowerCase() || null;

/* ---------------- Audiencias ---------------- */
export function diferencia(deseados: string[], actuales: string[]) {
  const d = new Set(deseados), a = new Set(actuales);
  return { sumar: [...d].filter((x) => !a.has(x)), sacar: [...a].filter((x) => !d.has(x)) };
}
export const tandas = <T>(l: T[], n: number) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
