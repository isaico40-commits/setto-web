/* Pixel de Meta: solo carga si hay metaPixelId en js/config.js. Sin ID, track() no hace nada.
   Nunca mandamos datos personales (nombre, celular, dirección): solo IDs de producto, cantidades y montos. */
(function () {
  const id = String((window.SETTO_CONFIG || {}).metaPixelId || "").trim();
  const off = { on: false, track() {}, custom() {}, once() {}, purchase() {} };
  if (!/^\d{6,20}$/.test(id)) { window.SettoPixel = off; return; }

  /* código base oficial de Meta */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", id);
  fbq("track", "PageView");

  const track = (name, data, eventID) => { try { const d = { currency: "ARS", ...data }; if (eventID) fbq("track", name, d, { eventID }); else fbq("track", name, d); } catch (_) {} };
  const custom = (name, data, eventID) => { try { const d = { currency: "ARS", ...data }; if (eventID) fbq("trackCustom", name, d, { eventID }); else fbq("trackCustom", name, d); } catch (_) {} };
  const KEY = "setto-px-enviados";
  const yaEnviados = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { return []; } };
  // una sola vez por clave (ej. "Purchase:STT-1234"), aunque se recargue la página
  const once = (clave, fn) => { const l = yaEnviados(); if (l.includes(clave)) return; fn(); try { localStorage.setItem(KEY, JSON.stringify([clave, ...l].slice(0, 60))); } catch (_) {} };
  window.SettoPixel = {
    on: true,
    track,
    custom,
    once,
    /* Purchase = venta concretada: el pedido figura como entregado (cobrado). No se manda al crear el pedido.
       eventID "pedido-<código>": el mismo que usará la Conversions API desde el servidor, para que Meta no la cuente dos veces. */
    purchase(code, data) { if (code) once("Purchase:" + code, () => track("Purchase", data, "pedido-" + code)); },
  };
})();
