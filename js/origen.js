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
    if (ref === location.hostname) return null; // navegación dentro de la web
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
    paraPedido() { const x = leer(); if (!x) return null; const lim = (t) => { const { externo, ...r } = t; return r; }; return { first: lim(x.first), last: lim(x.last) }; },
  };
})();
