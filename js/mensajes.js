/* Mensajes de WhatsApp: textos por defecto y relleno de variables.
   Se editan en Panel → Ajustes → Mensajes de WhatsApp (se guardan en settings.mensajes). */
(function () {
  const MSG = {
    pedido_inicio: { grupo: "Lo que manda el cliente", titulo: "Pedido · primera línea", vars: ["codigo", "entrega"],
      texto: "¡Hola Setto! Te paso mi pedido {codigo} {entrega}:" },
    pedido_transferencia: { grupo: "Lo que manda el cliente", titulo: "Pedido · pago por transferencia (va después del pago)", vars: ["total", "alias", "titular"],
      texto: "💸 Transfiero {total} al alias {alias}\nA nombre de: {titular}\nTe mando el comprobante por acá para confirmar el pedido." },
    pedido_cierre: { grupo: "Lo que manda el cliente", titulo: "Pedido · cierre (va al final)", vars: ["link"],
      texto: "📍 Sigo mi pedido acá: {link}" },
    consulta: { grupo: "Lo que manda el cliente", titulo: "Botón WhatsApp del menú", vars: [],
      texto: "¡Hola Setto! Tengo una consulta." },
    gift_compra: { grupo: "Lo que manda el cliente", titulo: "Compra de gift card", vars: ["codigo", "diseno", "monto", "para", "de"],
      texto: "¡Hola Setto! Quiero comprar una gift card 🎁\n\nCódigo: {codigo}\nDiseño: {diseno}\nMonto: {monto}\nPara: {para}\nDe: {de}\n\nLa pago por transferencia." },
    aviso_recibido: { grupo: "Lo que mandan ustedes", titulo: "Aviso · Recibido", vars: ["nombre", "codigo", "link"],
      texto: "¡Hola {nombre}! Recibimos tu pedido {codigo} de Setto. Te avisamos cuando esté listo.\n\nSeguí tu pedido acá: {link}" },
    aviso_preparando: { grupo: "Lo que mandan ustedes", titulo: "Aviso · En preparación", vars: ["nombre", "codigo", "link"],
      texto: "¡Hola {nombre}! Ya estamos preparando tu pedido {codigo} de Setto.\n\nSeguí tu pedido acá: {link}" },
    aviso_listo: { grupo: "Lo que mandan ustedes", titulo: "Aviso · Listo para retirar", vars: ["nombre", "codigo", "link"],
      texto: "¡Hola {nombre}! Tu pedido {codigo} de Setto está listo. Ya podés pasar a buscarlo 🙌\n\nSeguí tu pedido acá: {link}" },
    aviso_camino: { grupo: "Lo que mandan ustedes", titulo: "Aviso · En camino (envío)", vars: ["nombre", "codigo", "link"],
      texto: "¡Hola {nombre}! Tu pedido {codigo} de Setto ya salió y va en camino 🛵\n\nSeguí tu pedido acá: {link}" },
    pedir_resena: { grupo: "Lo que mandan ustedes", titulo: "Pedir reseña (al entregar)", vars: ["nombre", "codigo", "sellos", "sello_resena", "link"],
      texto: "¡Gracias por tu pedido, {nombre}! 🙌 {sellos}\n\n{sello_resena}\n\nAcá ves cómo armar tu bebida, tus sellos y, si te gustó, podés dejar tu reseña (con foto si querés):\n{link}" },
    pedir_cambio: { grupo: "Lo que mandan ustedes", titulo: "Falta algo del pedido (pedir cambio)", vars: ["nombre", "codigo", "faltan", "link"],
      texto: "¡Hola {nombre}! Perdón, nos quedamos sin {faltan} para tu pedido {codigo} 😕\n\nElegí acá con qué lo reemplazamos o si preferís sacarlo (el total se ajusta solo):\n{link}" },
    aviso_cancelado: { grupo: "Lo que mandan ustedes", titulo: "Aviso · Pedido cancelado", vars: ["nombre", "codigo"],
      texto: "Hola {nombre}, cancelamos tu pedido {codigo} de Setto. Si tenés alguna duda, respondé este mensaje." },
    gift_activa: { grupo: "Lo que mandan ustedes", titulo: "Gift card activada (al comprador)", vars: ["para", "monto", "link"],
      texto: "¡Listo! 🎁 Tu gift card de Setto para {para} ya está activa ({monto}).\n\nMandale este link para que la vea y la use:\n{link}" },
  };
  const VARS = {
    nombre: "nombre del cliente", codigo: "código (STT-1234 o GIFT-…)", link: "link de seguimiento o de la gift card",
    entrega: "“para retirar” o “con envío a domicilio”", sellos: "“Sumaste 1 sello al Setto Club.” (vacío si no sumó)", faltan: "lo que falta (ej: 2 Mochi Oreo)", sello_resena: "aviso del sello de regalo por la reseña (solo en la primera compra; si no, vacío)",
    diseno: "diseño de la gift card", total: "total a pagar", alias: "alias de transferencia (Ajustes → Formas de pago)", titular: "a nombre de quién está la cuenta (si no hay, se borra la línea)", monto: "monto", para: "para quién", de: "de quién (si no hay, se borra la línea)",
  };
  function texto(key, settings) { const m = (settings && settings.mensajes) || {}; return (m[key] && String(m[key]).trim()) || (MSG[key] ? MSG[key].texto : ""); }
  function render(key, vars, settings) {
    let t = texto(key, settings);
    // líneas con una variable vacía se borran enteras si la línea es solo "Etiqueta: {var}"
    t = t.split("\n").filter((ln) => { const m = ln.match(/^[^{}]*:\s*\{(\w+)\}\s*$/); return !(m && !String(vars[m[1]] ?? "").trim()); }).join("\n");
    t = t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
    return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  // aviso del sello de regalo por la reseña (lo mismo en supabase/functions/_shared/crm.ts)
  const SELLO_RESENA = "Como es tu primera compra en la web, si nos dejás tu reseña con un comentario o una foto, te regalamos 1 sello extra del Setto Club 🎁";
  // datos de transferencia (Panel → Ajustes → Formas de pago, settings.transferencia).
  // Mientras no se guarden, valen estos; si se guardan vacíos, no se muestra nada.
  const TRANSF_DEF = { alias: "setto.mdp", titular: "Isaias Martin Garcia" };
  function transferencia(settings) {
    const t = settings && settings.transferencia;
    const v = t && typeof t === "object" ? t : TRANSF_DEF;
    return { alias: String(v.alias || "").trim(), titular: String(v.titular || "").trim() };
  }
  window.SettoMSG = { MSG, VARS, texto, render, SELLO_RESENA, transferencia };
})();
