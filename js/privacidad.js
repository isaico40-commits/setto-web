/* Aviso de privacidad: pregunta una vez si se puede usar el Pixel de Meta (medición y anuncios).
   Hasta que la persona acepta, el pixel no carga (js/pixel.js). La elección se puede cambiar en /privacidad.
   Es independiente del permiso de WhatsApp, que se pide al hacer el pedido. */
(function () {
  const KEY = "setto-privacidad", VERSION = "2026-10";
  const leer = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } };
  function elegir(si) {
    try { localStorage.setItem(KEY, JSON.stringify({ anuncios: !!si, v: VERSION, at: new Date().toISOString() })); } catch (_) {}
    if (window.SettoPixel) window.SettoPixel.permiso(!!si);
    const b = document.getElementById("privAviso"); if (b) b.remove();
  }
  window.SettoPrivacidad = { VERSION, leer, elegir };

  if (!window.SettoPixel || !window.SettoPixel.disponible) return; // sin pixel configurado no hay nada que preguntar
  if (document.documentElement.dataset.privacidad === "pagina") return; // en /privacidad la elección está en la página
  const p = leer(); if (p && p.v === VERSION) return;
  const div = document.createElement("div");
  div.id = "privAviso"; div.className = "priv-aviso"; div.setAttribute("role", "region"); div.setAttribute("aria-label", "Privacidad");
  div.innerHTML = `<p>Usamos el Pixel de Meta para saber qué funciona de la web y mostrar anuncios de Setto en Instagram y Facebook. Solo lo activamos si nos decís que sí. <a href="/privacidad">Más info</a></p>
    <div class="priv-acts"><button class="btn" data-priv="0">No, gracias</button><button class="btn solid" data-priv="1">Dale</button></div>`;
  div.addEventListener("click", (e) => { const b = e.target.closest("[data-priv]"); if (b) elegir(b.dataset.priv === "1"); });
  const poner = () => document.body.appendChild(div);
  if (document.body) poner(); else document.addEventListener("DOMContentLoaded", poner);
})();
