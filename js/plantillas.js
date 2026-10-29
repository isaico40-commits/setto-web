/* Plantillas de WhatsApp: validación mientras se escribe y vista previa "como se ve en WhatsApp".
   Las mismas reglas están en supabase/functions/_shared/crm.ts (validarPlantilla), que es la que manda. */
(function () {
  const BAJA = "No quiero más novedades";
  const VAR = /\{\{\s*(\d+)\s*\}\}/g;
  const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const variables = (t) => [...String(t || "").matchAll(VAR)].map((m) => Number(m[1]));
  const cantidad = (t) => new Set(variables(t)).size;
  // "Lanzamiento Lemon pie" → "lanzamiento_lemon_pie"
  const slug = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

  function validar(p) {
    const e = [];
    const nombre = String(p.nombre || ""), cuerpo = String(p.cuerpo || "").trim(), ej = p.ejemplos || [];
    if (!/^[a-z0-9_]{3,60}$/.test(nombre)) e.push("El nombre va en minúsculas, sin espacios ni tildes (podés usar _), de 3 a 60 letras");
    if (!cuerpo) e.push("Falta el texto del mensaje");
    if (cuerpo.length > 1024) e.push("El texto pasa los 1024 caracteres");
    const unicas = [...new Set(variables(cuerpo))].sort((a, b) => a - b);
    if (unicas.some((n, i) => n !== i + 1)) e.push("Las variables tienen que ir en orden: {{1}}, {{2}}, {{3}}…");
    if (/^\{\{\s*\d+\s*\}\}/.test(cuerpo) || /\{\{\s*\d+\s*\}\}[\s.!?¡¿,]*$/.test(cuerpo)) e.push("Meta no deja una variable al principio ni al final del texto");
    if (/\}\}\s*\{\{/.test(cuerpo)) e.push("Dos variables pegadas: poné texto entre medio");
    if (unicas.length && cuerpo.replace(VAR, "").split(/\s+/).filter(Boolean).length < unicas.length * 3 + 2) e.push("Hay muchas variables para lo corto del texto: Meta la rechaza. Sumá texto fijo");
    unicas.forEach((n) => { if (!String(ej[n - 1] || "").trim()) e.push(`Falta el ejemplo de {{${n}}} (Meta lo pide para revisarla)`); });
    const enc = String(p.encabezado || "");
    if (enc.length > 60) e.push("El título pasa los 60 caracteres");
    if (/[\n*_~]|\{\{/.test(enc)) e.push("El título va en una línea, sin variables ni formato");
    const pie = String(p.pie || "");
    if (pie.length > 60) e.push("El pie pasa los 60 caracteres");
    if (/\{\{/.test(pie)) e.push("El pie no puede tener variables");
    const r = String(p.respuesta || "").trim();
    if (r.length > 25) e.push("El botón de respuesta pasa los 25 caracteres");
    if (r && sinTildes(r).toLowerCase() === sinTildes(BAJA).toLowerCase()) e.push("Ese botón ya va siempre");
    if (p.link) {
      if (!String(p.link.texto || "").trim() || p.link.texto.length > 25) e.push("El texto del botón a la web va de 1 a 25 caracteres");
      if (!["inicio", "especial"].includes(p.link.destino)) e.push("Elegí a qué parte de la web lleva el botón");
    }
    return e;
  }

  // plantilla del editor → mismo formato que devuelve la Edge Function (plantillaParaPanel)
  const desdeEditor = (p) => ({ encabezado: p.encabezado || "", cuerpo: p.cuerpo || "", ejemplos: p.ejemplos || [], pie: p.pie || "",
    botones: [{ tipo: "QUICK_REPLY", texto: BAJA }].concat(String(p.respuesta || "").trim() ? [{ tipo: "QUICK_REPLY", texto: p.respuesta.trim() }] : [],
      p.link && String(p.link.texto || "").trim() ? [{ tipo: "URL", texto: p.link.texto.trim() }] : []) });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // formato de WhatsApp: *negrita* _cursiva_ ~tachado~ ```mono```
  const formato = (h) => h.replace(/```([^`]+)```/g, "<code>$1</code>").replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>").replace(/~([^~\n]+)~/g, "<s>$1</s>");
  // {vence} de ejemplo: dentro de una semana (los códigos personales duran 7 días si no se cambia)
  const venceEj = () => new Date(Date.now() + 7 * 864e5).toLocaleDateString("es-AR", { day: "numeric", month: "numeric" });
  // valores: lo que va en cada {{n}} (en una campaña, {nombre} se muestra como el ejemplo "Isa"; {codigo} y {vence}, con uno de ejemplo)
  function burbuja(t, valores) {
    const val = (n) => { const v = String((valores && valores[n - 1]) ?? (t.ejemplos || [])[n - 1] ?? "").trim(); return v.replace(/\{nombre\}/g, "Isa").replace(/\{codigo\}/g, "SETTO-7KQ2").replace(/\{vence\}/g, venceEj()); };
    const cuerpo = formato(esc(t.cuerpo || "")).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => { const v = val(Number(n)); return v ? `<span class="wav">${esc(v)}</span>` : `<span class="wav vacia">{{${n}}}</span>`; }).replace(/\n/g, "<br>");
    const bot = (t.botones || []).map((b) => `<div class="wabtn">${b.tipo === "URL" ? "↗" : "↩"} ${esc(b.texto)}</div>`).join("");
    return `<div class="wapre" aria-label="Vista previa del mensaje de WhatsApp"><div class="wamsg">
      ${t.encabezado ? `<b class="wahead">${esc(t.encabezado)}</b>` : ""}
      <div class="wabody">${cuerpo || '<span class="muted">Escribí el mensaje…</span>'}</div>
      ${t.pie ? `<div class="wafoot">${esc(t.pie)}</div>` : ""}<span class="wahora">11:42</span></div>${bot ? `<div class="wabtns">${bot}</div>` : ""}</div>`;
  }

  const ESTADO = { APPROVED: ["Aprobada", "entregado"], PENDING: ["En revisión", "pendiente"], IN_APPEAL: ["En apelación", "pendiente"],
    REJECTED: ["Rechazada", "cancelado"], PAUSED: ["Pausada", "cancelado"], DISABLED: ["Desactivada", "cancelado"], PENDING_DELETION: ["Borrándose", "cancelado"] };
  const estado = (s) => ESTADO[s] || [String(s || "—").toLowerCase(), "pendiente"];

  window.SettoPlantillas = { BAJA, variables, cantidad, slug, validar, desdeEditor, burbuja, estado };
})();
