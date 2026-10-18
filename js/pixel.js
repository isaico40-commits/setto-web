/* Pixel de Meta: solo carga si hay metaPixelId en js/config.js. Sin ID, track() no hace nada.
   Nunca mandamos datos personales (nombre, celular, dirección): solo IDs de producto, cantidades y montos. */
(function () {
  const id = String((window.SETTO_CONFIG || {}).metaPixelId || "").trim();
  const off = { on: false, track() {}, purchase() {} };
  if (!/^\d{6,20}$/.test(id)) { window.SettoPixel = off; return; }

  /* código base oficial de Meta */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", id);
  fbq("track", "PageView");

  const track = (name, data, eventID) => { try { const d = { currency: "ARS", ...data }; if (eventID) fbq("track", name, d, { eventID }); else fbq("track", name, d); } catch (_) {} };
  const KEY = "setto-px-compras";
  const yaEnviadas = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { return []; } };
  window.SettoPixel = {
    on: true,
    track,
    purchase(code, data) { // una sola vez por pedido, aunque se recargue la página
      if (!code) return; const l = yaEnviadas(); if (l.includes(code)) return;
      track("Purchase", data, "pedido-" + code);
      try { localStorage.setItem(KEY, JSON.stringify([code, ...l].slice(0, 30))); } catch (_) {}
    },
  };
})();
