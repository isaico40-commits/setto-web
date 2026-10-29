/* Origen de la visita: de dónde llegó la persona (UTM, red social, QR, directo), para guardarlo con el pedido.
   Primer contacto: la primera visita con dato (dura 90 días). Último contacto: la última visita que llegó de afuera.
   Solo datos de campaña y página; nada personal. fbclid (ID de clic de Meta) solo si aceptó el pixel. */
(function () {
  const KEY = "setto-origen", DIAS = 90;
  const leer = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); return o && Date.now() - new Date(o.first.at) < DIAS * 864e5 ? o : null; } catch (_) { return null; } };
  const permisoPixel = () => { try { return (JSON.parse(localStorage.getItem("setto-privacidad") || "null") || {}).anuncios === true; } catch (_) { return false; } };
  const corto = (v, n) => (v ? String(v).trim().slice(0, n) : "");
  const REDES = [[/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)(facebook\.com|fb\.me)$/, "facebook"], [/(^|\.)tiktok\.com$/, "tiktok"],
    [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"], [/(^|\.)google\./, "google"], [/(^|\.)carrd\.co$/, "linktree"], [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"]];

  function contactoDeAhora() {
    const q = new URLSearchParams(location.search);
    if (q.get("seguir") || q.get("p") === "listo") return null; // links que mandamos por WhatsApp después de pedir: no son una visita nueva
    let ref = ""; try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (_) {}
    const sinWww = (h) => h.replace(/^www\./, "");
    if (ref && sinWww(ref) === sinWww(location.hostname)) return null; // navegación dentro de la web (con o sin www)
    const utm = (k) => corto(q.get("utm_" + k), 120);
    const red = (REDES.find(([re]) => re.test(ref)) || [])[1];
    const source = utm("source") || (q.get("fbclid") ? "meta" : "") || red || (ref ? ref.replace(/^www\./, "") : "");
    const fbclid = permisoPixel() ? corto(q.get("fbclid"), 500) : "";
    return { source: source || "directo", medium: utm("medium") || (red || ref ? "referral" : "directo"), campaign: utm("campaign"), content: utm("content"), term: utm("term"),
      fbclid, referrer: corto(ref, 120), landing: corto(location.pathname + location.search.replace(/([?&])(fbclid|seguir)=[^&]*/g, "$1").replace(/[?&]+$/, ""), 300), at: new Date().toISOString(), externo: !!(source || ref) };
  }

  const ahora = contactoDeAhora();
  let o = leer();
  if (ahora) {
    if (!o) o = { first: ahora, last: ahora };
    else if (ahora.externo) o.last = ahora; // una visita directa no pisa una campaña reciente
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {}
  }
  window.SettoOrigen = {
    // lo que viaja con el pedido (sin la marca interna "externo")
    paraPedido() {
      const x = leer(); if (!x) return null; const lim = (t) => { const { externo, ...r } = t; return r; };
      const r = { first: lim(x.first), last: lim(x.last) };
      if (permisoPixel()) { // para que Conversions API asocie la compra al navegador (solo con el pixel aceptado)
        const ck = (n) => (document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")) || [])[1] || "";
        const clic = x.last.fbclid || x.first.fbclid, t = x.last.fbclid ? x.last : x.first;
        r.px = { fbp: ck("_fbp"), fbc: ck("_fbc") || (clic ? `fb.1.${new Date(t.at).getTime()}.${clic}` : ""), ua: corto(navigator.userAgent, 400), url: corto(location.origin + (x.last.landing || "/"), 300) };
      }
      return r;
    },
  };
})();
