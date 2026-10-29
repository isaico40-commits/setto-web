/* Caja · lista de compras por voz: pasa lo dictado ("crema por dos y azúcar en Makro, urgente") a ítems.
   parse(texto, lugares) → [{ item, cantidad, donde, urgente }]. Sin dependencias: se prueba con node. */
(function (root) {
  const NUM = { un: "1", una: "1", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", doce: "12", quince: "15", veinte: "20", medio: "1/2", media: "1/2" };
  const UNID = "kilos?|kg|kilogramos?|gramos?|gr|g|litros?|lts?|l|paquetes?|cajas?|bolsas?|latas?|botellas?|docenas?|unidades?|potes?|frascos?|bidones?|rollos?|packs?";
  const key = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const num = (w) => NUM[key(w)] || w;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* lugar conocido al final ("… en Makro") o al principio ("en Makro: …"). Solo los que ya existen: "leche en polvo" no es un lugar */
  function sacarLugar(t, lugares, alInicio) {
    const ls = (lugares || []).slice().sort((a, b) => b.length - a.length);
    for (const l of ls) {
      const k = key(l).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = alInicio ? new RegExp(`^(?:en|del?|para)\\s+(?:el\\s+|la\\s+)?${k}\\b[\\s:,]*`, "i") : new RegExp(`\\s+(?:en|del?|para)\\s+(?:el\\s+|la\\s+)?${k}$`, "i");
      const m = key(t).match(re);
      if (m) return { donde: l, resto: alInicio ? t.slice(m[0].length) : t.slice(0, m.index) };
    }
    return { donde: "", resto: t };
  }

  function uno(t, lugares) {
    let urgente = false;
    t = t.replace(/[,;:\s]*\b(?:es\s+)?urgentes?\b[,;:\s]*/gi, () => { urgente = true; return " "; }).replace(/\s+/g, " ").trim();
    t = t.replace(/^(?:y|tambi[eé]n|despu[eé]s|ah)\s+/i, "");
    const L = sacarLugar(t, lugares, false); t = L.resto.trim();
    let cantidad = null, m;
    // al final: "crema por dos", "crema x 2", "harina por dos kilos"
    if ((m = t.match(new RegExp(`^(.+?)\\s+(?:x|por)\\s+(\\d+(?:[.,]\\d+)?|${Object.keys(NUM).join("|")})(?:\\s+(${UNID}))?$`, "i")))) { t = m[1]; cantidad = num(m[2]) + (m[3] ? " " + m[3] : ""); }
    // al principio: "dos kilos de harina", "3 cremas", "un paquete de servilletas"
    else if ((m = t.match(new RegExp(`^(\\d+(?:[.,]\\d+)?|${Object.keys(NUM).join("|")})\\s+(?:(${UNID})\\s+)?(?:de\\s+)?(.+)$`, "i")))) { cantidad = num(m[1]) + (m[2] ? " " + m[2] : ""); t = m[3]; }
    t = t.replace(/[.\s]+$/, "").trim();
    return t ? { item: cap(t), cantidad, donde: L.donde, urgente } : null;
  }

  function parse(texto, lugares) {
    let t = String(texto || "").replace(/\s+/g, " ").trim();
    t = t.replace(/^(?:ok\s+)?(?:agreg[aá]|anot[aá]|sum[aá]|pon[eé]|hay\s+que\s+comprar|falta(?:n)?|comprar|necesito|necesitamos)\s+(?:a\s+la\s+lista\s+)?/i, "");
    const G = sacarLugar(t, lugares, true); t = G.resto;
    // separadores: coma, " y ", "también", "después"
    const partes = t.split(/\s*[,;]\s*|\s+y\s+(?:tambi[eé]n\s+)?|\s+tambi[eé]n\s+|\s+despu[eé]s\s+/i);
    const out = [];
    partes.forEach((p) => {
      const it = uno(p, lugares);
      if (it) out.push(it);
      else if (/^\s*(?:es\s+)?urgentes?\s*$/i.test(p) && out.length) out[out.length - 1].urgente = true; // ", urgente" suelto: el anterior
    });
    if (G.donde) out.forEach((x) => { if (!x.donde) x.donde = G.donde; });
    return out;
  }

  const api = { parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SettoVoz = api;
})(typeof window !== "undefined" ? window : this);
