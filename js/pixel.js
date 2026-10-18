/* Pixel de Meta: solo carga si hay metaPixelId en js/config.js Y la persona aceptó la medición en el aviso de privacidad
   (js/privacidad.js). Sin ID o sin permiso, track() no hace nada y no se pide nada a Meta.
   Nunca mandamos datos personales (nombre, celular, dirección): solo IDs de producto, cantidades y montos. */
(function () {
  const id = String((window.SETTO_CONFIG || {}).metaPixelId || "").trim();
  const PREF = "setto-privacidad"; // { anuncios: true|false, v, at } — lo escribe js/privacidad.js
  const leerPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || "null"); } catch (_) { return null; } };
  const valido = /^\d{6,20}$/.test(id);
  let cargado = false;

  function cargar() { // código base oficial de Meta
    if (cargado) { fbq("consent", "grant"); return; }
    cargado = true;
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", id);
    fbq("track", "PageView");
  }

  const P = window.SettoPixel = {
    on: false, // true solo con ID válido y permiso dado
    disponible: valido, // hay pixel configurado (para mostrar o no el aviso)
    track(name, data, eventID) { if (!P.on) return; try { const d = { currency: "ARS", ...data }; if (eventID) fbq("track", name, d, { eventID }); else fbq("track", name, d); } catch (_) {} },
    custom(name, data, eventID) { if (!P.on) return; try { const d = { currency: "ARS", ...data }; if (eventID) fbq("trackCustom", name, d, { eventID }); else fbq("trackCustom", name, d); } catch (_) {} },
    // una sola vez por clave (ej. "Purchase:STT-1234"), aunque se recargue la página. Sin permiso no gasta la clave.
    once(clave, fn) {
      if (!P.on) return; const KEY = "setto-px-enviados";
      let l = []; try { l = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) {}
      if (l.includes(clave)) return; fn();
      try { localStorage.setItem(KEY, JSON.stringify([clave, ...l].slice(0, 60))); } catch (_) {}
    },
    /* Purchase = venta concretada: el pedido figura como entregado (cobrado). No se manda al crear el pedido.
       eventID "pedido-<código>": el mismo que usará la Conversions API desde el servidor, para que Meta no la cuente dos veces. */
    purchase(code, data) { if (code) P.once("Purchase:" + code, () => P.track("Purchase", data, "pedido-" + code)); },
    // lo llama js/privacidad.js cuando la persona elige en el aviso o en Preferencias
    permiso(si) {
      if (!valido) return;
      if (si) { cargar(); P.on = true; }
      else { P.on = false; if (cargado) try { fbq("consent", "revoke"); } catch (_) {} }
    },
  };
  const pref = leerPref();
  if (valido && pref && pref.anuncios === true) P.permiso(true);
})();
