/* Sitio público de Setto: carta, pedido a WhatsApp con código y tarjeta del Club */
(function () {
  const API = window.SettoAPI;
  const $ = (s) => document.querySelector(s);
  const money = (n) => (Number(n) < 0 ? "−$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-AR");
  const lcFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  const PAGE = (() => { const q = new URLSearchParams(location.search).get("p"); const p = (q || location.pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/\.html$/, ""); return ["gift-cards", "armar", "listo"].includes(p) ? p : "home"; })();
  document.body.dataset.page = PAGE;
  if (PAGE === "gift-cards") document.title = "Gift cards · Setto"; if (PAGE === "armar") document.title = "Cómo armar tu bebida · Setto"; if (PAGE === "listo") document.title = "¡Llegó tu Setto! · Setto";
  const irA = (hash) => { if (PAGE === "home") location.hash = hash; else location.href = "/" + hash; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let S = {}; // ajustes
  let SETS = [], DIRTY = [], MOCHIS = [], ESP = [];
  const on = (list) => list.filter((x) => x.activo !== false);

  /* filas de la base → forma que usa la página */
  function adapt(rows) {
    const map = (r) => ({
      ...r,
      desc: r.descripcion || "",
      precios: { "12 oz": r.precio_12, "16 oz": r.precio_16 },
      bebida: r.set_bebida, mochi: r.set_mochi,
      foto: !!r.img && !String(r.img).startsWith("img/"),
    });
    const by = (c) => rows.filter((r) => r.categoria === c).sort((a, b) => (a.orden || 0) - (b.orden || 0)).map(map);
    SETS = by("set"); DIRTY = by("dirty"); MOCHIS = by("mochi"); ESP = by("especial");
  }

  /* ---------- estrellas por producto (reseñas publicadas) ---------- */
  let RATINGS = {};
  // 5 estrellas rellenas según el promedio (4,5 → cuatro y media), como en Crumbl
  const rateTag = (p) => { const r = RATINGS[p.id]; if (!r || !r.cantidad) return ""; const w = Math.max(0, Math.min(100, (r.promedio / 5) * 100)); return `<span class="rate" role="img" aria-label="${r.promedio} de 5, ${r.cantidad} reseña${r.cantidad > 1 ? "s" : ""}"><span class="stars5" aria-hidden="true"><span>★★★★★</span><span style="width:${w}%">★★★★★</span></span><b>${String(r.promedio).replace(".", ",")}</b><small>(${r.cantidad})</small></span>`; };

  /* ---------- stock visible (sale de la caja del equipo) ---------- */
  let STOCK = null;
  const umbral = () => Math.max(1, Number((S.stock_web || {}).umbral) || 3);
  const stockDe = (p) => {
    if (!STOCK || !p) return null;
    const id = p.categoria === "set" ? p.set_mochi : p.id;
    return Object.prototype.hasOwnProperty.call(STOCK, id) ? Number(STOCK[id]) : null;
  };
  // lo que ve el cliente = stock − lo que ya tiene en su carrito (contador en vivo)
  const libreDe = (p) => { const n = stockDe(p); if (n === null) return null; const mid = p.categoria === "set" ? p.set_mochi : p.id; return n - enCarrito(mid); };
  const badgeInner = (p) => { const n = stockDe(p), l = libreDe(p); if (n === null || p.agotado) return ""; return n <= 0 ? '<span class="badge">Sin stock hoy</span>' : l <= 0 ? '<span class="badge low">En tu pedido</span>' : l <= umbral() ? '<span class="badge low">¡Últimos!</span>' : ""; };
  const lineInner = (p) => {
    const n = stockDe(p), l = libreDe(p); if (n === null || p.agotado) return "";
    if (n <= 0) return '<p class="stk out">No hay stock disponible</p>';
    if (l <= 0) return `<p class="stk low">Ya tenés ${n === 1 ? "el último" : `los ${n} que quedan`} en tu pedido</p>`;
    const num = `<b class="num stkn">${l}</b>`;
    if (p.categoria === "set") return `<p class="stk ${l <= umbral() ? "low" : ""}">${l === 1 ? "Queda" : "Quedan"} ${num} para este set</p>`;
    return l <= umbral() ? `<p class="stk low">${l === 1 ? "Queda" : "Quedan"} ${num} · ¡últimos!</p>` : `<p class="stk">${num} disponibles hoy</p>`;
  };
  const stockBadge = (p) => `<span class="stkw" data-stkb="${esc(p.id)}">${badgeInner(p)}</span>`;
  const stockLine = (p) => `<div class="stkw" data-stkl="${esc(p.id)}">${lineInner(p)}</div>`;
  function refreshStockUI() {
    document.querySelectorAll("[data-stkb]").forEach((el) => { const p = find(el.dataset.stkb); if (p) el.innerHTML = badgeInner(p); });
    document.querySelectorAll("[data-stkl]").forEach((el) => { const p = find(el.dataset.stkl); if (!p) return; const prev = el.textContent; el.innerHTML = lineInner(p); if (prev && prev !== el.textContent) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } });
  }

  /* el stock frena: no se puede pedir más de lo que hay (la base también lo controla) */
  const mochiDe = (p) => (!p ? null : fmt(p) === "set" ? p.set_mochi : fmt(p) === "mochi" ? p.id : null);
  const sinStock = (p) => { const n = stockDe(p); return n !== null && n <= 0; };
  const enCarrito = (mid) => cart.reduce((a, c) => a + (mochiDe(find(c.id)) === mid ? c.qty : 0), 0);
  function frenoStock(p, extra) {
    const mid = mochiDe(p), n = stockDe(p); if (!mid || n === null) return null;
    const ya = enCarrito(mid); if (ya + extra <= n) return null;
    const m = find(mid), nom = m ? "mochi " + m.nombre : "ese mochi";
    return n <= 0 ? `No nos quedan ${nom} por hoy` : `De ${nom} nos quedan ${n}${ya ? ` y ya tenés ${ya} en el pedido` : ""}`;
  }

  const find = (id) => [...SETS, ...DIRTY, ...MOCHIS, ...ESP].find((x) => x.id === id);
  const kind = (p) => p.categoria === "especial" ? "premium" : p.categoria;
  const fmt = (p) => (p.categoria === "especial" ? p.formato || "mochi" : p.categoria);   // especial puede ser mochi, dirty o set
  const bebida = (p) => ["set", "dirty"].includes(fmt(p));
  const unit = (p) => !bebida(p);
  const priceOf = (p, sz) => (unit(p) ? p.precio : p.precios[sz]);
  const nameOf = (p) => (unit(p) ? "Mochi " + p.nombre : p.nombre);
  /* ---------- Drop de la edición especial (se abre sola en la fecha programada) ---------- */
  let SKEW = 0; // diferencia con la hora del servidor: la cuenta regresiva no depende del reloj del celular
  const ahora = () => Date.now() + SKEW;
  const ESPC = () => S.especial || {};
  const prog = () => ESPC().modo === "programado";
  const dropFase = () => API.dropEstado(ESPC(), ahora()); // "antes" | "abierto" | "terminado"
  const espOpen = () => dropFase() === "abierto";
  const antesProg = () => prog() && dropFase() === "antes";
  // la foto va esmerilada: en un drop programado, hasta el lanzamiento; en modo manual, según cada producto
  const tapado = (p) => (prog() ? antesProg() && (ESPC().esmerilar !== false || !!p.esmerilado) : !!p.esmerilado);
  const fechaDrop = (iso) => { const d = new Date(iso); if (isNaN(d)) return ""; const o = { timeZone: "America/Argentina/Buenos_Aires" };
    return d.toLocaleDateString("es-AR", { ...o, weekday: "long", day: "numeric", month: "numeric" }) + " a las " + d.toLocaleTimeString("es-AR", { ...o, hour: "2-digit", minute: "2-digit", hour12: false }) + " hs"; };
  const setParts = (s) => ({ b: DIRTY.find((x) => x.id === s.bebida), m: MOCHIS.find((x) => x.id === s.mochi) });
  const suelto = (s, sz) => { const { b, m } = setParts(s); return (b ? Number(b.precios[sz]) : 0) + (m ? Number(m.precio) : 0); };
  const descOf = (p) => { if (p.categoria !== "set") return p.desc; const { b, m } = setParts(p); return (b ? b.nombre : "Bebida") + " + mochi " + (m ? m.nombre.toLowerCase() : ""); };

  /* ---------- Setto Club: helpers ---------- */
  const club = () => S.club || {};
  const clubOn = () => club().activo !== false && (club().sellos_por_pedido ?? 1) > 0;
  const spp = () => club().sellos_por_pedido ?? 1;
  const sellosTxt = (n) => n + (n === 1 ? " sello" : " sellos");
  /* regalo de cada pedido (Panel → Setto Club) y maquinita (Panel → Maquinita) */
  const regaloOn = () => club().regalo !== false && club().regalo !== "";
  const maqOn = () => (S.maquinita || {}).activo !== false;
  const regaloLine = () => regaloOn() ? `<div class="regaloline"><span class="rg-ico" aria-hidden="true">🎁</span><span>Tu pedido trae un regalo.</span></div>` : "";
  let cardCache = null; // {tel, data}
  async function loadCard(force) {
    const tel = API.normPhone(form.tel); if (!tel || !clubOn()) return null;
    if (!force && cardCache && cardCache.tel === tel) return cardCache.data;
    try { const d = await API.getCard(tel); cardCache = { tel, data: d }; return d; } catch (_) { return null; }
  }
  function premioTxt() {
    const c = club(), sets = c.premio_set === false ? [] : on(SETS).map((s) => s.nombre.replace(/ Set$/, ""));
    const d = c.premio_descuento ?? 35, tope = Number(c.premio_tope) || 0, op = [];
    if (sets.length) op.push(`un set de regalo (${sets.length > 1 ? sets.slice(0, -1).join(", ") + " o " + sets.slice(-1) : sets[0]}, en 12 oz)`);
    if (d > 0) op.push(`${d}% off en ese pedido${tope > 0 ? ` (hasta ${money(tope)})` : ""}`);
    if (op.length) return op.join(" o ");
    return c.premio && c.premio !== "Premio a definir" ? lcFirst(c.premio) : "tu premio";
  }
  function completes() {
    if (!clubOn()) return false;
    const c = cardCache && cardCache.tel === API.normPhone(form.tel) ? cardCache.data : null;
    return !!c && c.sellos + spp() >= (club().meta || 8) && total() >= (Number(club().minimo) || 0);
  }
  const premioDesc = () => club().premio_descuento ?? 35;
  function premioOff() {
    if (form.premio !== "descuento") return 0;
    let off = Math.round((total() * premioDesc()) / 100 / 10) * 10; const tope = Number(club().premio_tope) || 0;
    return tope > 0 ? Math.min(off, tope) : off;
  }
  function premioPicker() {
    if (!completes()) return "";
    const sets = club().premio_set === false ? [] : on(SETS).filter((s) => !s.agotado && !sinStock(s));
    const opts = sets.map((s) => `<button data-premio="set:${esc(s.id)}" aria-pressed="${form.premio === "set:" + s.id}">${esc(s.nombre)} de regalo</button>`);
    if (premioDesc() > 0) opts.push(`<button data-premio="descuento" aria-pressed="${form.premio === "descuento"}">${premioDesc()}% off en este pedido${Number(club().premio_tope) > 0 ? ` (hasta ${money(club().premio_tope)})` : ""}</button>`);
    return `<div class="f premio-pick"><span>🎁 ¡Este pedido completa tu tarjeta! Elegí tu premio</span><div class="chips">${opts.join("")}</div>${sets.length ? '<span class="hintf">El set de regalo va en 12 oz.</span>' : ""}</div>`;
  }
  function clubLine() {
    if (!clubOn()) return "";
    const min = Number(club().minimo) || 0;
    if (min > 0 && total() < min) return `<div class="clubline"><img src="img/mochito-run.png" alt=""><div>Sumá <b>${money(min - total())}</b> más y sumás ${sellosTxt(spp())} del Club.</div></div>`;
    const n = spp(), meta = club().meta || 8;
    const c = cardCache && cardCache.tel === API.normPhone(form.tel) ? cardCache.data : null;
    let txt, pct = null;
    if (c && c.existe) {
      const after = c.sellos + n;
      pct = Math.min(100, Math.round((after / meta) * 100));
      txt = after >= meta ? (form.premio ? `<b>¡Completás tu tarjeta!</b> Premio: ${esc(form.premio === "descuento" ? premioDesc() + "% off" : ((SETS.find((x) => "set:" + x.id === form.premio) || {}).nombre || "set") + " de regalo")}.` : `<b>¡Completás tu tarjeta!</b> Elegí tu premio al seguir.`)
        : `Con este pedido llegás a <b>${after} de ${meta}</b> sellos.`;
    } else {
      txt = `Este pedido suma <b>${sellosTxt(n)}</b> del Setto Club.`;
    }
    return `<div class="clubline"><img src="img/mochito-run.png" alt=""><div style="flex:1">${txt}${pct !== null ? `<div class="clubbar"><i style="width:${pct}%"></i></div>` : ""}</div></div>`;
  }

  /* ---------- carrito ---------- */
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem("setto-cart") || "[]"); } catch (e) { cart = []; }
  const save = () => { try { localStorage.setItem("setto-cart", JSON.stringify(cart)); } catch (e) {} };
  const total = () => cart.reduce((s, c) => s + c.precio * c.qty, 0);
  const units = () => cart.reduce((s, c) => s + c.qty, 0);
  const pers = () => S.personalizacion || {};
  const leches = () => (pers().activo === false ? [] : pers().leches || []);
  const sinOpts = () => (pers().activo === false ? [] : pers().sin || []);
  const persOn = (p) => bebida(p) && (leches().length > 0 || sinOpts().length > 0);
  const lechePrecio = (n) => { const l = leches().find((x) => x.nombre === n); return l ? Number(l.precio) || 0 : 0; };
  const detalleOf = (leche, sin) => [leche && (lechePrecio(leche) > 0 || leche !== (leches()[0] || {}).nombre) ? leche : "", ...(sin || [])].filter(Boolean).join(" · ");
  function syncCart() { // si cambió la carta, actualiza precios y saca lo que ya no existe
    cart = cart.filter((c) => {
      const p = find(c.id); if (!p || p.activo === false || (p.categoria === "especial" && !espOpen())) return false; const pr = priceOf(p, c.size); if (!(pr > 0)) return false;
      if (persOn(p)) {
        if (c.leche && !leches().some((l) => l.nombre === c.leche)) c.leche = (leches()[0] || {}).nombre || "";
        c.sin = (c.sin || []).filter((x) => sinOpts().includes(x));
      } else { c.leche = ""; c.sin = []; }
      c.precio = pr + lechePrecio(c.leche); c.detalle = detalleOf(c.leche, c.sin); c.nombre = nameOf(p); return true;
    });
    save();
  }
  /* Pixel de Meta (js/pixel.js): solo IDs de producto, cantidades y montos */
  const px = (name, data) => { if (window.SettoPixel) window.SettoPixel.track(name, data); };
  const pxCarrito = () => ({ content_type: "product", content_ids: [...new Set(cart.map((c) => c.id))], contents: cart.map((c) => ({ id: c.id, quantity: c.qty, item_price: c.precio })), num_items: units() });
  function addItem(p, sz, qty = 1, leche = "", sin = []) {
    const fr = frenoStock(p, qty); if (fr) { toast(fr); return false; }
    if (!persOn(p)) { leche = ""; sin = []; }
    const key = p.id + "|" + (sz || "") + "|" + leche + "|" + sin.join(",");
    const ex = cart.find((c) => c.key === key);
    if (ex) ex.qty += qty;
    else cart.push({ key, id: p.id, nombre: nameOf(p), size: sz || "", leche, sin: [...sin], detalle: detalleOf(leche, sin), precio: priceOf(p, sz) + lechePrecio(leche), img: p.img || "img/mochito-lie.png", qty });
    save(); renderBadge(); toast("Sumado: " + nameOf(p) + (sz ? " · " + sz : ""));
    const pu = priceOf(p, sz) + lechePrecio(leche);
    px("AddToCart", { content_type: "product", content_ids: [p.id], content_name: nameOf(p), contents: [{ id: p.id, quantity: qty, item_price: pu }], value: pu * qty });
    return true;
  }
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2000); }

  /* ---------- render ---------- */
  /* ---------- hero con slides (se edita en Panel → Ajustes) ---------- */
  const HERO_DEF = [
    { img: "img/set-sakura.webp", titulo: "Asian Inspired Home Cafe", texto: "Dirty lattes y mochis en Mar del Plata.", ajuste: "recorte" },
    { img: "img/set-yoru.webp", titulo: "Un set distinto cada día", texto: "Una bebida y un mochi que van juntos.", ajuste: "recorte" },
    { img: "img/mochi-sakura.webp", titulo: "Mochis rellenos", texto: "Masa suave por fuera, crema por dentro.", ajuste: "recorte" },
  ];
  // Botones de cada slide (Panel → Ajustes → Portada). Las slides viejas sin "botones" usan los de siempre.
  const heroBotones = (x) => Array.isArray(x.botones) ? x.botones.filter((b) => b && b.texto)
    : x.tipo === "media" ? (x.boton ? [{ texto: x.boton, link: x.link || "#sets", estilo: "principal" }] : [])
    : [{ texto: "Armar mi pedido", link: "#sets", estilo: "principal" }, { texto: "Pedir por apps", link: "#apps", estilo: "secundario" }];
  let heroI = 0, heroT = null, HS = [], heroPausa = false;
  const RMH = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function renderHero() {
    const h = S.hero || {}; HS = (h.slides || []).filter((x) => x && (x.img || x.img_m || x.video || x.titulo)); if (!HS.length) HS = HERO_DEF;
    const MOB = matchMedia("(max-width: 820px)").matches, todoMedia = HS.every((x) => x.tipo === "media");
    $("#heroSlides").classList.toggle("all-media", todoMedia);
    const pic = (x, i, alt, style = "") => `<picture>${x.img_m ? `<source media="(max-width: 820px)" srcset="${esc(x.img_m)}">` : ""}<img src="${esc(x.img || x.img_m || "img/mochito-lie.png")}" alt="${alt}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}${style}></picture>`;
    $("#heroSlides").innerHTML = HS.map((x, i) => {
      if (x.tipo === "media") {
        const vid = MOB ? x.video_m || x.video : x.video || x.video_m, poster = MOB ? x.img_m || x.img : x.img || x.img_m, alt = esc(x.alt || "Setto");
        const media = vid ? `<video muted loop playsinline preload="${i ? "none" : "metadata"}" ${poster ? `poster="${esc(poster)}"` : ""} data-src="${esc(vid)}" aria-label="${alt}"></video>` : pic(x, i, alt);
        return `<article class="hcard media" aria-roledescription="slide" aria-label="${i + 1} de ${HS.length}" data-hi="${i}">${i === 0 ? `<h1 class="sr-only">${esc(x.alt || "Setto · Asian Inspired Home Cafe en Mar del Plata")}</h1>` : ""}<div class="hmedia">${media}</div></article>`;
      }
      const foto = x.ajuste === "foto", T = i === 0 ? "h1" : "h2";
      return `<article class="hcard ${foto ? "foto" : "recorte"}" aria-roledescription="slide" aria-label="${i + 1} de ${HS.length}" data-hi="${i}">
        <div class="hmedia">${pic(x, i, esc(x.alt || x.titulo || "Setto"), ` style="object-position:center ${esc({ arriba: "top", abajo: "bottom" }[x.pos] || "center")}"`)}</div>
        <div class="h2txt">
          <${T} class="ht">${esc(x.titulo || "Asian Inspired Home Cafe")}</${T}>
          ${x.texto ? `<p class="lead">${esc(x.texto)}</p>` : ""}
        </div></article>`;
    }).join("");
    // los botones van debajo del carrusel: un grupo por slide, todos en la misma celda (así el alto no salta al cambiar)
    $("#heroCtas").innerHTML = HS.map((x, i) => `<div class="hgrp" data-hg="${i}">${heroBotones(x).slice(0, 3).map((b) =>
      `<a class="btn big ${b.estilo === "secundario" ? "ghost" : "solid"}" href="${esc(b.link || "#sets")}">${esc(b.texto)}</a>`).join("")}</div>`).join("");
    $("#heroCtas").hidden = !HS.some((x) => heroBotones(x).length);
    $("#heroDots").innerHTML = HS.length > 1 ? HS.map((_, i) => `<button role="tab" aria-selected="${i === 0}" aria-label="Slide ${i + 1}" data-hero="${i}"></button>`).join("") : "";
    document.querySelector(".hnav").hidden = HS.length < 2;
    heroI = 0; $("#heroSlides").scrollLeft = 0; heroMarcar(); heroAuto();
  }
  const heroCards = () => Array.from(document.querySelectorAll("#heroSlides .hcard"));
  function heroIr(i, smooth = true) {
    const cs = heroCards(); if (!cs.length) return;
    heroI = (i + cs.length) % cs.length;
    const tr = $("#heroSlides"), pad = parseFloat(getComputedStyle(tr).scrollPaddingLeft) || 0;
    tr.scrollTo({ left: cs[heroI].offsetLeft - pad, behavior: smooth && !RMH ? "smooth" : "auto" });
    heroMarcar();
  }
  function heroMarcar() {
    document.querySelectorAll("[data-hero]").forEach((d, k) => d.setAttribute("aria-selected", String(k === heroI)));
    document.querySelectorAll("#heroCtas .hgrp").forEach((g, k) => { g.classList.toggle("on", k === heroI); g.inert = k !== heroI; });
    heroCards().forEach((c, k) => {
      c.classList.toggle("on", k === heroI);
      const v = c.querySelector("video"); if (!v) return;
      if (k === heroI && !heroPausa && !RMH) { if (!v.src) v.src = v.dataset.src; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
      else v.pause();
    });
  }
  // Auto avance: un temporizador por slide que arranca de cero cada vez que cambia la slide (sola o a mano).
  // Si la persona interactúa, la próxima espera es más larga; con el mouse sobre la barra o el foco de teclado adentro, se frena.
  const heroMs = () => Math.max(3, Number((S.hero || {}).intervalo) || 5) * 1000;
  let heroQuieto = 0; // 1 = mouse sobre la barra, 2 = foco de teclado adentro
  function heroAuto(ms = heroMs()) {
    clearTimeout(heroT); if (HS.length < 2 || RMH || heroPausa || heroQuieto || document.hidden) return;
    heroT = setTimeout(() => { heroIr(heroI + 1); heroAuto(); }, ms);
  }
  const heroEspera = () => heroAuto(Math.max(heroMs() * 2, 7000));  // después de tocar, le damos más tiempo
  document.addEventListener("visibilitychange", () => heroAuto());
  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-hero]"); if (d) { heroIr(+d.dataset.hero); heroEspera(); return; }
    if (e.target.closest("#heroPrev")) { heroIr(heroI - 1); heroEspera(); }
    if (e.target.closest("#heroNext")) { heroIr(heroI + 1); heroEspera(); }
    const pz = e.target.closest("#heroPause");
    if (pz) { heroPausa = !heroPausa; pz.setAttribute("aria-pressed", String(heroPausa)); pz.setAttribute("aria-label", heroPausa ? "Reproducir" : "Pausar"); heroMarcar(); heroAuto(); }
  });
  (function heroScroll() {
    const tr = document.getElementById("heroSlides"), sec = document.querySelector(".hero2"); if (!tr || !sec) return; let t = null;
    tr.addEventListener("scroll", () => {
      clearTimeout(t); t = setTimeout(() => {
        const cs = heroCards(), pad = parseFloat(getComputedStyle(tr).scrollPaddingLeft) || 0;
        let best = 0, bd = 1e9; cs.forEach((c, k) => { const dd = Math.abs(c.offsetLeft - pad - tr.scrollLeft); if (dd < bd) { bd = dd; best = k; } });
        if (tr.scrollLeft >= tr.scrollWidth - tr.clientWidth - 2) best = cs.length - 1; // la última no llega a pegarse a la izquierda
        if (best !== heroI) { heroI = best; heroMarcar(); heroEspera(); } // la cambió con el dedo
      }, 80);
    }, { passive: true });
    // tocar la portada (o los botones) reinicia la espera, así no cambia debajo del dedo
    sec.addEventListener("pointerdown", heroEspera, { passive: true });
    // con el mouse sobre los botones o los controles se frena (sobre las fotos sigue, si no parecería trabado)
    const ctl = sec.querySelector(".hctl");
    if (ctl) { ctl.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { heroQuieto |= 1; heroAuto(); } });
      ctl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { heroQuieto &= ~1; heroAuto(); } }); }
    sec.addEventListener("focusin", (e) => { if (e.target.matches(":focus-visible")) { heroQuieto |= 2; heroAuto(); } });
    sec.addEventListener("focusout", (e) => { if (!sec.contains(e.relatedTarget)) { heroQuieto &= ~2; heroAuto(); } });
  })();

  /* ---------- Ubicación (Panel → Ajustes → Ubicación) ---------- */
  function renderUbicacion() {
    const u = S.ubicacion || {}, sec = $("#ubicacion"); if (!sec) return;
    const q = (u.mapa || "").trim(); sec.hidden = !(u.activo && q); if (sec.hidden) return;
    $("#t-ubi").textContent = u.titulo || "Dónde estamos";
    $("#ubiTexto").textContent = u.texto || ""; $("#ubiTexto").hidden = !u.texto;
    const map = $("#ubiMap"), src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${Math.max(12, Math.min(18, +u.zoom || 15))}&output=embed`;
    if (map.getAttribute("src") !== src) map.setAttribute("src", src);
    $("#ubiLink").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  /* ---------- Stickers para WhatsApp (Panel → Ajustes → Stickers). El pack vive en Sticker.ly:
     WhatsApp no deja instalar packs desde una web, solo desde una app. ---------- */
  const STK_DEF = ["01_fantasma", "02_calabaza", "03_diablito", "04_bruja", "05_latte", "06_gatito", "07_momia", "08_durmiendo", "09_fantasmita"].map((n) => `img/stickers/halloween/${n}.webp`);
  function renderStickers() {
    const k = S.stickers || {}, sec = $("#stickers"); if (!sec) return;
    const listo = document.body.dataset.page === "listo"; // ya compró: se presenta como regalo por la compra
    // ?stickers en la URL = vista previa (se ve aunque falte el link o no esté activado)
    const link = (k.link || "").trim(), ok = k.activo && /^https:\/\//.test(link), prev = new URLSearchParams(location.search).has("stickers");
    sec.hidden = !(ok || prev); const g = $("#lsGift"); if (g) g.hidden = sec.hidden; if (sec.hidden) return;
    if (prev && !listo && !sec.dataset.fui) { sec.dataset.fui = "1"; setTimeout(() => sec.scrollIntoView({ block: "start" }), 600); }
    $("#stkEye").textContent = listo ? "Tu regalo" : "Para WhatsApp";
    $("#t-stk").textContent = listo ? "Un regalo por tu compra" : (k.titulo || "Stickers de Mochito");
    $("#stkTexto").textContent = listo ? "Gracias por elegirnos. Llevate a Mochito a tus chats: es un pack de stickers para WhatsApp." : (k.texto || "Llevate a Mochito a tus chats. Son gratis.");
    if (link) $("#stkBtn").href = link; else { $("#stkBtn").removeAttribute("href"); $("#stkBtn").textContent = "Falta el link de Sticker.ly"; }
    const grid = $("#stkGrid");
    if (!grid.dataset.ok) { grid.innerHTML = STK_DEF.map((s) => `<img src="${s}" alt="" width="512" height="512" loading="lazy" decoding="async">`).join(""); grid.dataset.ok = "1"; }
    sec.classList.toggle("desk", !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }

  /* ---------- ¿Qué es un mochi? (se edita en Panel → Ajustes) ---------- */
  const MQ_DEF = {
    activo: true,
    texto: "Un bocado de origen japonés: masa suave y elástica por fuera, relleno cremoso por dentro.",
    puntos: ["La masa | harina de arroz glutinoso y leche.", "El relleno | crema y un corazón de sabor: frutilla, chocolate, oreo y más.", "La textura | suave y elástica por fuera, cremosa por dentro."],
    img: "", ajuste: "recorte",
  };
  function renderQueEs() {
    const m = { ...MQ_DEF, ...(S.mochi_info || {}) }; const sec = $("#quees");
    sec.hidden = m.activo === false; if (sec.hidden) return;
    if (m.titulo) $("#t-quees").textContent = m.titulo;
    $("#mqText").textContent = m.texto || ""; $("#mqText").hidden = !m.texto;
    $("#mqList").innerHTML = (m.puntos || []).filter(Boolean).map((p) => { const [a, ...b] = String(p).split("|"); return b.length ? `<li><span><b>${esc(a.trim())}:</b> ${esc(b.join("|").trim())}</span></li>` : `<li><span>${esc(a.trim())}</span></li>`; }).join("");
    const img = $("#mqImg"); if (m.img) { img.src = m.img; img.classList.toggle("foto", m.ajuste === "foto"); }
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-gomochi]")) { tab = "mochi"; renderCarta(); } });

  /* ---------- decoración de temporada (Panel → Ajustes) ---------- */
  const BAT = '<svg viewBox="0 0 64 28" aria-hidden="true"><path d="M32 9c1.6-3 3.2-4 4.4-4-.6 1.4-.6 2.6 0 3.6 3-3.6 8.6-5.4 14.6-4.2-2.2 1.2-3.4 3-3.4 5 3-1.2 7.6-.6 11.4 2.6-3.4.2-6 1.6-7.4 4-2.6-1.8-6.4-2-9.6-.4-2 1-3.4 3.2-4 6.4-1.2-2.6-3.2-4-6-4s-4.8 1.4-6 4c-.6-3.2-2-5.4-4-6.4-3.2-1.6-7-1.4-9.6.4-1.4-2.4-4-3.8-7.4-4 3.8-3.2 8.4-3.8 11.4-2.6 0-2-1.2-3.8-3.4-5 6-1.2 11.6.6 14.6 4.2.6-1 .6-2.2 0-3.6 1.2 0 2.8 1 4.4 4z" fill="currentColor"/></svg>';
  const PUMPKIN = '<svg viewBox="0 0 64 60" aria-hidden="true"><path d="M30 10c0-5 3-8 7-9-2 3-2 6-1 9" fill="none" stroke="#3f5b2f" stroke-width="4" stroke-linecap="round"/><ellipse cx="20" cy="36" rx="14" ry="20" fill="#e8742a"/><ellipse cx="44" cy="36" rx="14" ry="20" fill="#e8742a"/><ellipse cx="32" cy="36" rx="13" ry="21" fill="#f08c3e"/><path d="M24 33l4-5 4 5zm8 0l4-5 4 5zm-9 10c3 3 6 4 9 4s6-1 9-4l-3 1-2-2-2 2-2-2-2 2-2-2-2 2z" fill="#3a2410"/></svg>';
  const WEB = '<svg viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M0 0L100 100M0 0L50 100M0 0L100 50M0 0L0 100M0 0L100 0"/><path d="M0 22Q12 14 22 0M0 44Q26 30 44 0M0 68Q40 46 68 0M0 92Q55 62 92 0"/></svg>';
  function renderTema() {
    const t = S.tema || {}, hw = t.nombre === "halloween";
    document.body.classList.toggle("t-halloween", hw);
    const av = $("#temaAviso"); av.hidden = !(hw && t.aviso); if (!av.hidden) av.innerHTML = `${PUMPKIN}<span>${esc(t.aviso)}</span>${PUMPKIN}`;
    document.querySelectorAll(".deco").forEach((d) => d.remove());
    if (!hw) return;
    const box = $("#heroBox");
    if (box) box.insertAdjacentHTML("beforeend", `<span class="deco deco-web">${WEB}</span><span class="deco deco-bat b1">${BAT}</span><span class="deco deco-bat b2">${BAT}</span><span class="deco deco-bat b3">${BAT}</span><span class="deco deco-pk">${PUMPKIN}</span>`);
    const esp = $("#especial .head"); if (esp) esp.insertAdjacentHTML("afterbegin", `<span class="deco deco-pk2">${PUMPKIN}</span>`);
  }


  /* ---------- Abierto / cerrado ahora (sale de los horarios de retiro) ---------- */
  function renderAbierto() {
    const el = $("#abierto"); if (!el) return;
    const r = S.retiro || {}, now = new Date(), toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    const mins = now.getHours() * 60 + now.getMinutes();
    const abierto = (r.dias || []).includes(now.getDay()) && (r.rangos || []).some(([a, b]) => mins >= toMin(a) && mins < toMin(b));
    const prox = slots()[0];
    el.classList.toggle("open", abierto); el.classList.toggle("closed", !abierto);
    el.innerHTML = abierto ? `<i></i>Abierto ahora${prox && prox.startsWith("Hoy") ? ` · retirás desde las ${esc(prox.split("· ")[1].replace(" hs", ""))}` : ""}`
      : `<i></i>Cerrado${prox ? ` · abrimos ${esc(prox.split(" · ")[0].toLowerCase())} ${esc(prox.split("· ")[1].replace(" hs", ""))}` : ""}`;
  }
  setInterval(() => { try { renderAbierto(); } catch (_) {} }, 60000);

  /* ---------- Gift cards ---------- */
  const GD = {
    cumple: { nombre: "Cumpleaños", desc: "Regalá algo especial y único a esa persona especial y única en su cumple.", tit: "¡Feliz cumple!", bg: "#f8a29a", fg: "#1f1c18", img: "img/mochito-cup.png", pat: "radial-gradient(circle,#fffdf8 2px,transparent 3px)", psz: "26px" },
    gracias: { nombre: "Gracias", desc: "Para agradecer con algo rico, sin vueltas.", tit: "Gracias", bg: "#296A67", fg: "#fffdf8", img: "img/mochito-run.png", pat: "radial-gradient(circle,rgba(255,253,248,.35) 1.5px,transparent 2.5px)", psz: "22px" },
    tequiero: { nombre: "Te quiero", desc: "Un mimo dulce para esa persona que te importa.", tit: "Te quiero", bg: "#f6c9d0", fg: "#1f1c18", img: "img/mochito-lie.png", pat: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M10 16s-6-3.6-6-7.4C4 6.6 5.4 5.5 7 5.5c1.3 0 2.3.8 3 1.8.7-1 1.7-1.8 3-1.8 1.6 0 3 1.1 3 3.1C16 12.4 10 16 10 16z' fill='%23fffdf8'/%3E%3C/svg%3E\")", psz: "30px" },
    felicitaciones: { nombre: "Felicitaciones", desc: "Para festejar sus logros como se merecen.", tit: "¡Felicitaciones!", bg: "#f1e4ca", fg: "#296A67", img: "img/mochito-run.png", pat: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M10 3l1.8 4.6L16.5 8l-3.6 3 1.1 4.8L10 13.3 6 15.8 7.1 11 3.5 8l4.7-.4z' fill='%23f8a29a'/%3E%3C/svg%3E\")", psz: "34px" },
    porquesi: { nombre: "Porque sí", desc: "No hace falta una excusa para darse un gusto.", tit: "Porque sí", bg: "#fffdf8", fg: "#1f1c18", img: "img/mochito-cup.png", pat: "radial-gradient(circle,#f8a29a 2px,transparent 3px)", psz: "30px" },
    halloween: { nombre: "Halloween", desc: "Un susto dulce para regalar en Halloween.", tit: "Boo!", bg: "#2b2035", fg: "#ffb27a", img: "img/mochito-lie.png", pat: "radial-gradient(circle,rgba(232,116,42,.35) 1.5px,transparent 2.5px)", psz: "24px", bats: true },
  };
  const gcfg = () => S.giftcards || {};
  // diseños: los de base (dibujados) + los que suban con imagen desde el panel
  const gitems = () => (gcfg().items && gcfg().items.length ? gcfg().items : (gcfg().disenos || Object.keys(GD)).map((id) => ({ id, nombre: (GD[id] || {}).nombre, activo: true })));
  const gitem = (k) => gitems().find((x) => x.id === k) || { id: k, nombre: (GD[k] || {}).nombre || "Gift card" };
  const gdis = () => gitems().filter((x) => x.activo !== false && (x.img || GD[x.id])).map((x) => x.id);
  const gnombre = (k) => gitem(k).nombre || (GD[k] || {}).nombre || "Gift card";
  const gdesc = (k) => { const it = gitem(k); return it.desc != null && it.desc !== "" ? it.desc : (GD[k] || {}).desc || ""; };
  function gcardHtml(k, monto, tag = "div", attrs = "") {
    const it = gitem(k);
    if (it.img) return `<${tag} class="gcard gimg" ${attrs}><img class="g-img" src="${esc(it.img)}" alt="Gift card ${esc(gnombre(k))}"><span class="g-logo"><img src="img/logo.svg" alt="Setto"></span><span class="g-bot"><span class="g-amt num">${monto ? money(monto) : esc(gnombre(k))}</span></span></${tag}>`;
    const d = GD[k] || GD.porquesi;
    return `<${tag} class="gcard" style="--gbg:${d.bg};--gfg:${d.fg};--gpat:${d.pat};--gpsz:${d.psz}" ${attrs}>
      <span class="g-logo"><img src="img/logo.svg" alt="Setto"></span>
      ${d.bats ? `<span class="g-bat" style="top:16px;right:22px">${BAT}</span><span class="g-bat" style="top:44px;right:64px;width:20px">${BAT}</span>` : ""}
      <span class="g-tit">${esc(d.tit)}</span>
      <span class="g-bot"><span class="g-amt num">${monto ? money(monto) : "Gift card"}</span></span>
      <img class="g-mito" src="${d.img}" alt=""></${tag}>`;
  }
  function renderGift() {
    const gc = $("#lsGc"); if (gc) gc.hidden = gcfg().activo === false;
    const sec = $("#regalo"); if (!sec) return;
    sec.hidden = gcfg().activo === false; if (sec.hidden) return;
    $("#gcGrid").innerHTML = gdis().map((k) => `<div class="gc-item">${gcardHtml(k, 0, "button", `data-gcpick="${k}" aria-label="Gift card ${esc(gnombre(k))}"`)}
      ${gdesc(k) ? `<p class="gc-txt">${esc(gdesc(k))}</p>` : ""}</div>`).join("");
  }
  const GB = { dis: "cumple", monto: 0, otro: "", de: "", para: "", msg: "", tel: "", sending: false, done: null };
  function abrirGift(k) {
    Object.assign(GB, { dis: k || gdis()[0], monto: (gcfg().montos || [15000])[1] || (gcfg().montos || [15000])[0], otro: "", done: null, tel: GB.tel || form.tel || "" });
    $("#gcBuy").hidden = false; document.body.style.overflow = "hidden"; dibujarGift();
  }
  function cerrarGift() { $("#gcBuy").hidden = true; document.body.style.overflow = ""; }
  const gbMonto = () => (GB.monto === "otro" ? Math.round(Number(String(GB.otro).replace(/\D/g, "")) || 0) : GB.monto);
  function dibujarGift() {
    const b = $("#gbBody");
    if (GB.done) {
      b.innerHTML = `<div class="gb-ok">${gcardHtml(GB.dis, GB.done.monto)}<b style="font-size:1.2rem">¡Listo! Tu gift card quedó reservada</b>
        <p class="muted" style="max-width:36ch">Pagala por transferencia en el WhatsApp. Cuando lo confirmemos te mandamos el link para regalarla.</p>
        <a class="btn wa big" target="_blank" rel="noopener" href="${waLink(GB.done.msg)}">Abrir WhatsApp</a></div>`;
      return;
    }
    const montos = gcfg().montos || [10000, 15000, 20000, 30000];
    b.innerHTML = `<div class="gb-wrap"><div class="gb-prev">${gcardHtml(GB.dis, gbMonto())}<div class="gb-msg">${GB.para ? `<b>Para ${esc(GB.para)}</b>${GB.de ? ` · de ${esc(GB.de)}` : ""}<br>` : ""}<span class="muted">${esc(GB.msg) || "Tu mensaje aparece acá."}</span></div></div>
      <div class="gb-form">
        <div class="f"><span>Diseño</span><div class="gb-dis">${gdis().map((k) => `<button data-gbdis="${k}" aria-pressed="${k === GB.dis}" aria-label="${esc(gnombre(k))}">${gitem(k).img ? `<span class="mini" style="background:url('${esc(gitem(k).img)}') center/cover"></span>` : `<span class="mini" style="--gbg:${GD[k].bg};--gfg:${GD[k].fg}">${esc(gnombre(k))}</span>`}</button>`).join("")}</div></div>
        <div class="f"><span>Monto</span><div class="chips">${montos.map((m) => `<button data-gbm="${m}" aria-pressed="${GB.monto === m}">${money(m)}</button>`).join("")}<button data-gbm="otro" aria-pressed="${GB.monto === "otro"}">Otro</button></div>
          ${GB.monto === "otro" ? `<input id="gbOtro" inputmode="numeric" placeholder="Desde ${money(gcfg().minimo || 5000)}" value="${esc(GB.otro)}" style="margin-top:8px">` : ""}</div>
        <label class="f">Para<input id="gbPara" maxlength="40" value="${esc(GB.para)}" placeholder="Nombre de quien la recibe"></label>
        <label class="f">De (opcional)<input id="gbDe" maxlength="40" value="${esc(GB.de)}" placeholder="Tu nombre"></label>
        <label class="f">Mensaje (opcional)<textarea id="gbMsg" maxlength="160" placeholder="Ej: ¡Feliz cumple! Que lo disfrutes">${esc(GB.msg)}</textarea></label>
        <label class="f">Tu celular (WhatsApp)<input id="gbTel" type="tel" inputmode="tel" value="${esc(GB.tel)}" placeholder="223 347-1277"><span class="hintf">Pago por transferencia. Te mandamos el link para regalarla.</span></label>
        <div id="gbErr" class="err" hidden></div>
        <button class="btn wa big" id="gbSend">${GB.sending ? "Reservando…" : `Comprar · ${money(gbMonto())}`}</button>
      </div></div>`;
    [["gbPara", "para"], ["gbDe", "de"], ["gbMsg", "msg"], ["gbTel", "tel"], ["gbOtro", "otro"]].forEach(([id, k]) => { const el = $("#" + id); if (el) el.addEventListener("input", (e) => { GB[k] = e.target.value; const pv = $(".gb-prev"); if (pv && k !== "tel") pv.innerHTML = `${gcardHtml(GB.dis, gbMonto())}<div class="gb-msg">${GB.para ? `<b>Para ${esc(GB.para)}</b>${GB.de ? ` · de ${esc(GB.de)}` : ""}<br>` : ""}<span class="muted">${esc(GB.msg) || "Tu mensaje aparece acá."}</span></div>`; if (k === "otro") $("#gbSend").textContent = `Comprar · ${money(gbMonto())}`; }); });
  }
  async function comprarGift() {
    const err = $("#gbErr"), m = gbMonto(), mn = gcfg().minimo || 5000, mx = gcfg().maximo || 100000;
    const fallo = (t) => { err.hidden = false; err.textContent = t; };
    if (!(m >= mn && m <= mx)) return fallo(`El monto va de ${money(mn)} a ${money(mx)}.`);
    if (!GB.para.trim()) return fallo("Falta para quién es.");
    if (!API.normPhone(GB.tel)) return fallo("Revisá tu celular.");
    GB.sending = true; $("#gbSend").textContent = "Reservando…";
    try {
      const r = await API.createGiftcard({ diseno: GB.dis, monto: m, de: GB.de.trim(), para: GB.para.trim(), mensaje: GB.msg.trim(), phone: GB.tel });
      const msg = window.SettoMSG.render("gift_compra", { codigo: r.code, diseno: gnombre(GB.dis), monto: money(m), para: GB.para.trim(), de: GB.de.trim() }, S);
      GB.done = { code: r.code, monto: m, msg }; GB.sending = false; dibujarGift();
      const link = waLink(msg); if (matchMedia("(pointer:coarse)").matches) location.href = link; else window.open(link, "_blank", "noopener");
    } catch (e) { GB.sending = false; $("#gbSend").textContent = `Comprar · ${money(m)}`; fallo(e.message); }
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-gcpick],[data-gbdis],[data-gbm],#gbSend,[data-gbclose],[data-gvclose],[data-gvuse],[data-gvcopy]"); if (!t) { if (e.target.id === "gcBuy") cerrarGift(); if (e.target.id === "gcView") cerrarRegalo(); return; }
    if (t.dataset.gcpick) return abrirGift(t.dataset.gcpick);
    if (t.dataset.gbdis) { GB.dis = t.dataset.gbdis; return dibujarGift(); }
    if (t.dataset.gbm) { GB.monto = t.dataset.gbm === "otro" ? "otro" : +t.dataset.gbm; dibujarGift(); if (GB.monto === "otro") $("#gbOtro").focus(); return; }
    if (t.id === "gbSend") return comprarGift();
    if (t.dataset.gbclose !== undefined) return cerrarGift();
    if (t.dataset.gvclose !== undefined) return cerrarRegalo();
    if (t.dataset.gvcopy) { try { navigator.clipboard.writeText(t.dataset.gvcopy); toast("Código copiado"); } catch (_) {} return; }
    if (t.dataset.gvuse) { usarGift(t.dataset.gvuse, +t.dataset.saldo); cerrarRegalo(); irA("#sets"); toast("Gift card guardada: se aplica al pedir"); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#gcBuy").hidden) cerrarGift(); if (!$("#gcView").hidden) cerrarRegalo(); } });

  /* link de regalo: ?regalo=TOKEN */
  function cerrarRegalo() { $("#gcView").hidden = true; document.body.style.overflow = ""; }
  async function abrirRegalo(token) {
    let g = null; try { g = await API.giftcardByToken(token); } catch (_) {}
    const b = $("#gvBody"); $("#gcView").hidden = false; document.body.style.overflow = "hidden";
    if (!g) { b.innerHTML = '<p class="muted" style="padding:20px 0">No encontramos esta gift card.</p>'; return; }
    const activa = g.estado === "activa" || g.estado === "usada";
    b.innerHTML = `<div class="gv">${gcardHtml(g.diseno, g.monto)}
      <div class="gb-msg"><b>Para ${esc(g.para || "vos")}</b>${g.de ? ` · de ${esc(g.de)}` : ""}${g.mensaje ? `<br>${esc(g.mensaje)}` : ""}</div>
      ${activa ? `<div class="gv-code"><span class="num">${esc(g.code)}</span><button class="back" data-gvcopy="${esc(g.code)}">Copiar</button></div>
        <p style="margin:0;text-align:center"><b>Saldo: ${money(g.saldo)}</b>${g.saldo < g.monto ? ` de ${money(g.monto)}` : ""}</p>
        ${g.saldo > 0 ? `<button class="btn solid big" data-gvuse="${esc(g.code)}" data-saldo="${g.saldo}">Usarla en un pedido</button><p class="muted" style="font-size:.82rem;text-align:center;margin:0">Se descuenta del total. Si sobra, te queda para otro pedido.</p>` : '<p class="muted" style="text-align:center">Esta gift card ya se usó completa.</p>'}`
        : g.estado === "anulada" ? '<p class="muted" style="text-align:center">Esta gift card fue anulada.</p>' : '<p class="muted" style="text-align:center">Se activa cuando confirmemos el pago. Volvé a abrir este link en un rato.</p>'}</div>`;
  }
  (function regaloDesdeLink() {
    const t = new URLSearchParams(location.search).get("regalo"); if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) return;
    try { history.replaceState(null, "", location.pathname + (PAGE !== "home" ? "?p=" + PAGE : "") + location.hash); } catch (_) {}
    window.__regalo = t;
  })();

  /* gift card en el checkout */
  let GIFT = null; try { GIFT = JSON.parse(localStorage.getItem("setto-gift") || "null"); } catch (_) {}
  function usarGift(code, saldo) { GIFT = { code, saldo }; try { localStorage.setItem("setto-gift", JSON.stringify(GIFT)); } catch (_) {} }
  function quitarGift() { GIFT = null; try { localStorage.removeItem("setto-gift"); } catch (_) {} }
  const antesGift = () => total() + envioCosto() - (completes() ? premioOff() : 0);
  const giftOff = () => (GIFT ? Math.min(GIFT.saldo, Math.max(antesGift(), 0)) : 0);
  function giftBox() {
    return `<div class="f gcbox">${GIFT ? `<div class="gcon"><span>🎁 Gift card <b>${esc(GIFT.code)}</b> · saldo ${money(GIFT.saldo)}</span><button class="back" data-gcx>Quitar</button></div>`
      : `<details><summary>¿Tenés una gift card?</summary><div class="gcin"><input id="gcCode" placeholder="GIFT-XXXX-XXXX" autocapitalize="characters"><button class="btn" data-gcok>Aplicar</button></div><span class="hintf" id="gcMsg"></span></details>`}</div>`;
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-gcx]")) { quitarGift(); drawDrawer(); return; }
    if (!e.target.closest("[data-gcok]")) return;
    const code = ($("#gcCode").value || "").trim().toUpperCase(), msg = $("#gcMsg"); if (!code) return;
    msg.textContent = "Revisando…";
    try { const g = await API.giftcardCheck(code);
      if (!g) msg.textContent = "No encontramos ese código.";
      else if (g.estado === "pendiente") msg.textContent = "Esa gift card todavía no está activa.";
      else if (!(g.saldo > 0)) msg.textContent = "Esa gift card ya no tiene saldo.";
      else { usarGift(g.code, g.saldo); drawDrawer(); }
    } catch (ex) { msg.textContent = ex.message; }
  });

  /* ---------- Votación ---------- */
  const vcfg = () => S.votacion || {};
  const miVoto = () => { try { return JSON.parse(localStorage.getItem("setto-voto") || "{}")[vcfg().id] || null; } catch (_) { return null; } };
  let VOTO = { sel: null, res: null };
  async function renderVotar() {
    const v = vcfg(), sec = $("#votar"), ops = (v.opciones || []).filter((o) => o && o.nombre);
    const cerrada = v.cierre && new Date(v.cierre) < new Date();
    sec.hidden = !v.activo || ops.length < 2; if (sec.hidden) return;
    $("#t-vot").textContent = v.pregunta || "¿Qué sabor querés?";
    $("#votSub").textContent = cerrada ? "La votación cerró. Gracias por votar." : v.solo_clientes ? "Votan quienes ya pidieron por la web. Un voto por celular." : "Un voto por celular. Podés cambiarlo.";
    const yo = miVoto();
    if (yo || cerrada) { try { VOTO.res = await API.pollResults(v.id); } catch (_) {} }
    const tot = (VOTO.res && VOTO.res.total) || 0;
    $("#vtGrid").innerHTML = ops.map((o) => { const n = (VOTO.res && VOTO.res.conteo && VOTO.res.conteo[o.id]) || 0, pct = tot ? Math.round((n / tot) * 100) : 0, ver = !!VOTO.res;
      return `<button class="vt" data-vt="${esc(o.id)}" aria-pressed="${(VOTO.sel || yo) === o.id}" ${cerrada ? "disabled" : ""}>${yo === o.id ? '<span class="vt-yo">Tu voto</span>' : ""}<span class="vt-img">${o.img ? `<img src="${esc(o.img)}" alt="" loading="lazy">` : "<span>🍡</span>"}</span><b>${esc(o.nombre)}</b>
        ${ver ? `<span class="vt-bar"><i style="width:${pct}%"></i></span><span class="vt-pct">${pct}%</span>` : ""}</button>`; }).join("");
    $("#vtTel").hidden = !VOTO.sel || cerrada; if (VOTO.sel && !$("#vtPhone").value) $("#vtPhone").value = form.tel || "";
    $("#vtMsg").textContent = VOTO.res && tot ? `${tot} voto${tot > 1 ? "s" : ""} hasta ahora` : "";
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-vt]");
    if (b) { VOTO.sel = b.dataset.vt; document.querySelectorAll("[data-vt]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); $("#vtTel").hidden = false; if (!$("#vtPhone").value) $("#vtPhone").value = form.tel || ""; $("#vtPhone").focus(); return; }
    if (e.target.id !== "vtSend") return;
    const tel = $("#vtPhone").value, msg = $("#vtMsg");
    if (!API.normPhone(tel)) { msg.textContent = "Revisá tu celular."; return; }
    e.target.disabled = true; msg.textContent = "Votando…";
    try { VOTO.res = await API.castVote(vcfg().id, VOTO.sel, tel); const l = JSON.parse(localStorage.getItem("setto-voto") || "{}"); l[vcfg().id] = VOTO.sel; localStorage.setItem("setto-voto", JSON.stringify(l)); VOTO.sel = null; await renderVotar(); toast("¡Gracias por votar!"); }
    catch (ex) { msg.textContent = ex.message; } finally { e.target.disabled = false; }
  });

  /* ---------- Preguntas frecuentes (Panel → Ajustes) ---------- */
  const FAQ_DEF = [
    { p: "¿Qué es un mochi?", r: "Un bocado de origen japonés: masa suave y elástica de harina de arroz glutinoso y leche, rellena de crema y un corazón de sabor (frutilla, chocolate, oreo y más)." },
    { p: "¿Cómo llega mi bebida?", r: "Llega por partes: el vaso con la bebida, el cold foam y el hielo aparte, más un revolvedor y un sorbete. [Mirá cómo armarla](/armar)." },
    { p: "¿Cómo hago un pedido?", r: "Armalo acá en la web y se envía por WhatsApp con un código. Por ahí te confirmamos horario y pago." },
    { p: "¿Hacen envíos?", r: "Sí, en Mar del Plata. Con envío el pago es solo por transferencia y el costo te lo pasamos por WhatsApp." },
    { p: "¿Cómo funciona el Setto Club?", r: "Cada pedido desde la web suma un sello. Al completar la tarjeta elegís tu premio." },
    { p: "¿Cómo uso una gift card?", r: "Abrí el link que te mandaron y tocá “Usarla en un pedido”. Se descuenta del total y, si sobra, te queda para otro pedido. [Ver gift cards](/gift-cards)." },
  ];
  const mdLinks = (t) => esc(t).replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)/g, (_, a, u) => `<a href="${u}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : ""}>${a}</a>`).replace(/\n/g, "<br>");
  function renderFaq() {
    const items = ((S.faq || {}).items || FAQ_DEF).filter((x) => x && x.p && x.r);
    $("#faq").hidden = !items.length;
    $("#faqList").innerHTML = items.map((x) => `<details><summary>${esc(x.p)}</summary><div class="faq-a">${mdLinks(x.r)}</div></details>`).join("");
  }

  function renderBand() {
    const words = ["Probá un set distinto cada día", "Dirty lattes fríos", "Mochis rellenos", "Take away en Mar del Plata", "Elegí tu leche"];
    if (S.club && clubOn()) words.splice(1, 0, "Cada pedido suma sellos del Setto Club");
    $("#track").innerHTML = [...words, ...words].map((w) => `<span>${w}</span>`).join("");
  }
  function renderApps() {
    $("#apps").innerHTML = '<span class="eyebrow" style="padding-inline:4px">Delivery por apps</span>' + (S.apps || []).map((a) => {
      const ok = !!a.url;
      return `<a class="app ${ok ? "" : "pend"}" ${ok ? `href="${esc(a.url)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>
        <span class="ico ${a.logo ? "logo" : ""}">${a.logo ? `<img src="${esc(a.logo)}" alt="Logo de ${esc(a.nombre)}">` : esc((a.nombre || "?")[0])}</span><span><b>${esc(a.nombre)}</b><small>${ok ? "Delivery a domicilio" : "Link pendiente"}</small></span>
        <span class="go" aria-hidden="true">${ok ? "↗" : "…"}</span></a>`;
    }).join("") + '<p class="fine">El envío, sus tiempos y su costo los maneja cada app.</p>';
  }
  function renderConviene() {
    const v = S.ventajas || {}, items = (v.items || []).filter((x) => x && x.titulo);
    const el = $("#conviene"); el.hidden = !items.length || v.activo === false; if (el.hidden) return;
    el.innerHTML = `<h3>${esc(v.titulo || "Pedir acá te conviene")}</h3><div class="cv-grid">${items.map((x) => `<div class="cv"><span class="ic" aria-hidden="true">${cvIcon(x)}</span><b>${esc(x.titulo)}</b>${x.detalle ? `<span>${esc(x.detalle)}</span>` : ""}</div>`).join("")}</div>`;
  }
  // Ícono según el título (o el detalle) de cada motivo; los motivos se editan desde el panel.
  const CV_ICONS = [
    [/barat|precio|ahorr|descuent|%|menos/, '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'],
    [/sello|club|premio|punto|tarjeta/, '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>'],
    [/gusto|eleg|tama|leche|extra|personaliz/, '<path d="M4 6h10M4 12h4M12 12h8M4 18h12"/><circle cx="17" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/>'],
    [/directo|whatsapp|chat|mensaje/, '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/>'],
    [/env[ií]o|domicilio|delivery|retir/, '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'],
  ];
  function cvIcon(x) {
    const t = (x.titulo || "").toLowerCase(), d = (x.detalle || "").toLowerCase();
    const hit = CV_ICONS.find(([re]) => re.test(t)) || CV_ICONS.find(([re]) => re.test(d));
    const path = hit ? hit[1] : '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }
  function renderEspecial() {
    const E = ESPC(), items = on(ESP), fase = dropFase(), open = fase === "abierto", fin = fase === "terminado", P = prog();
    const sec = $("#especial"); renderDropBar();
    if (items.length === 0 || (fin && E.al_terminar !== "mostrar")) { sec.hidden = true; return; }
    sec.hidden = false; sec.classList.toggle("drop-antes", antesProg());
    $("#espChip").textContent = fin ? "Este drop terminó" : (open ? E.chip_post || (P ? "¡Ya salió!" : E.chip) : E.chip) || (open ? "Disponible ahora" : P && E.lanzamiento ? "Sale el " + fechaDrop(E.lanzamiento) : "Próxima edición");
    $("#t-esp").textContent = E.titulo || "Edición especial";
    document.querySelectorAll('a[href="#especial"]').forEach((a) => (a.textContent = E.titulo || "Edición especial"));
    $("#espIntro").textContent = (open && E.intro_post) || E.intro || "";
    const hideN = antesProg() && !!E.ocultar_nombres, hideP = antesProg() && !!E.ocultar_precios;
    $("#espGrid").innerHTML = items.map((p, i) => {
      const beb = bebida(p), base = beb ? Number(p.precios["12 oz"]) : Number(p.precio);
      const foto = !!p.img, canBuy = open && !p.agotado && !sinStock(p) && base > 0;
      const nom = hideN ? "Sabor sorpresa" + (items.length > 1 ? " #" + (i + 1) : "") : p.nombre;
      const pic = foto ? `<img src="${esc(p.img)}" alt="${esc(hideN ? nom : nameOf(p))}" loading="lazy">` : `<span class="pend"><img src="img/mochito-lie.png" alt="">Foto en camino</span>`;
      const tag = p.agotado ? '<span class="badge">Agotado</span>' : fin ? '<span class="badge">Terminó</span>' : !open ? '<span class="badge">Próximamente</span>' : stockBadge(p);
      const ph = hideN ? `<div class="ph ${foto ? "foto" : ""}">${tag}${pic}</div>` : `<button class="ph ${foto ? "foto" : ""}" data-open="${p.id}" aria-label="Ver ${esc(p.nombre)}">${tag}${pic}</button>`;
      const precio = hideP ? '<span class="muted" style="font-size:.85rem">Precio el día del drop</span>' : base > 0 ? `<span class="price num">${beb ? "Desde " : ""}${money(base)}</span>` : '<span class="muted" style="font-size:.85rem">Precio a confirmar</span>';
      return `<article class="prem ${p.agotado || fin ? "agotado" : ""} ${tapado(p) ? "soon" : ""}" style="--i:${i}">
        ${ph}<h3>${esc(nom)}</h3><p class="desc">${esc(hideN ? "Se revela el día del drop." : p.desc)}</p>${open ? stockLine(p) : ""}
        <div class="row">${precio}
        ${canBuy ? `<button class="add" ${beb ? `data-open="${p.id}"` : `data-quick="${p.id}"`} aria-label="Sumar ${esc(nameOf(p))}">+</button>` : ""}</div>
      </article>`;
    }).join("");
    const ig = `<strong>@${esc(S.instagram || "setto.project")}</strong>`;
    $("#espSoon").innerHTML = fin ? `<div class="prem-soon"><img src="img/mochito-lie.png" alt=""><div><b>Este drop terminó</b><p>${E.avisame !== false && dropAvHtml("x") ? "Anotate y te avisamos cuando salga el próximo." : `Seguinos en Instagram ${ig} para enterarte del próximo.`}</p>${E.avisame !== false ? `<div class="cd-acts">${dropAvHtml("Avisame del próximo drop")}</div>` : ""}</div></div>`
      : antesProg() && E.lanzamiento ? dropCdHtml()
      : !open ? `<div class="prem-soon"><img src="img/mochito-run.png" alt=""><div><b>Todavía no salió</b><p>Avisamos en Instagram ${ig}.</p></div></div>` : "";
    dots("espGrid"); tickDrop();
  }
  /* cuenta regresiva + avisame + agendar */
  function dropCdHtml() {
    const E = ESPC();
    return `<div class="drop-cd">
      ${E.cuenta !== false ? `<div class="cd" role="timer" aria-label="Falta para el lanzamiento">${[["d", "días"], ["h", "horas"], ["m", "min"], ["s", "seg"]].map(([u, l]) => `<span><b class="num" data-cd="${u}">00</b><small>${l}</small></span>`).join("")}</div>` : ""}
      <p class="cd-when">Sale el <b>${esc(fechaDrop(E.lanzamiento))}</b></p>
      <div class="cd-acts">${E.avisame !== false ? dropAvHtml("Avisame cuando salga") : ""}${E.calendario !== false ? calHtml() : ""}</div>
    </div>`;
  }
  const faltan = () => { const ms = Math.max(0, Date.parse(ESPC().lanzamiento || "") - ahora()) || 0; return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 }; };
  const dos = (n) => String(n).padStart(2, "0");
  let dropUlt = null;
  function tickDrop() {
    if (!S.especial) return;
    const f = dropFase();
    if (dropUlt && f !== dropUlt) { const salio = dropUlt === "antes" && f === "abierto"; dropUlt = f; syncCart(); renderEspecial(); renderCarta(); renderBadge(); if (salio) revelarDrop(); return; }
    dropUlt = f;
    if (f !== "antes") return;
    const t = faltan();
    document.querySelectorAll("[data-cd]").forEach((el) => { const v = dos(t[el.dataset.cd]); if (el.textContent !== v) el.textContent = v; });
    const txt = (t.d ? t.d + "d " : "") + dos(t.h) + ":" + dos(t.m) + ":" + dos(t.s);
    document.querySelectorAll("[data-cdtxt]").forEach((el) => { if (el.textContent !== txt) el.textContent = txt; });
  }
  setInterval(tickDrop, 1000);
  // el momento del lanzamiento con la página abierta: se destapan las fotos
  function revelarDrop() {
    const sec = $("#especial"); if (!sec || sec.hidden) return;
    sec.classList.remove("drop-reveal"); void sec.offsetWidth; sec.classList.add("drop-reveal");
    setTimeout(() => sec.classList.remove("drop-reveal"), 2600);
    toast(`¡Salió ${ESPC().titulo || "la edición especial"}! Ya se puede pedir`);
  }
  /* barra arriba de toda la web: cuenta regresiva y, al salir, "ya salió" por 48 hs */
  const DBX = "setto-dropbar-x";
  function renderDropBar() {
    const E = ESPC(), f = dropFase(), lan = Date.parse(E.lanzamiento || "");
    let cerrada = false; try { cerrada = localStorage.getItem(DBX) === f + lan; } catch (_) {}
    const show = prog() && E.barra !== false && lan && on(ESP).length && !cerrada && (f === "antes" || (f === "abierto" && ahora() - lan < 48 * 36e5));
    let bar = $("#dropBar");
    if (!show) { if (bar) bar.remove(); return; }
    if (!bar) { document.body.insertAdjacentHTML("afterbegin", '<div class="drop-bar" id="dropBar" role="region" aria-label="Lanzamiento"></div>'); bar = $("#dropBar"); }
    const t = esc(E.titulo || "la edición especial");
    bar.innerHTML = `<a href="/#especial">${f === "antes" ? `<i class="db-dot"></i><span><b>${t}</b> sale en <span class="num" data-cdtxt></span></span>` : `<i class="db-dot on"></i><span><b>¡Ya salió ${t}!</b> Pedilo →</span>`}</a><button type="button" class="db-x" data-dropx aria-label="Cerrar aviso">✕</button>`;
    bar.dataset.k = f + lan;
  }
  /* agendar en el calendario */
  function calDatos() {
    const E = ESPC(), ini = new Date(Date.parse(E.lanzamiento)), fin = new Date(ini.getTime() + 36e5);
    return { ini, fin, tit: `${E.titulo || "Edición especial"} · Setto`, det: `${E.intro ? E.intro + "\n\n" : ""}Pedilo en ${location.origin}/#especial` };
  }
  const zulu = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  function calHtml() {
    const c = calDatos();
    const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(c.tit)}&dates=${zulu(c.ini)}/${zulu(c.fin)}&details=${encodeURIComponent(c.det)}&location=${encodeURIComponent(location.origin)}`;
    return `<details class="cal"><summary class="btn">📅 Agendar</summary><div class="cal-m"><a href="${esc(g)}" target="_blank" rel="noopener">Google Calendar</a><button type="button" data-ics>iPhone u otro calendario</button></div></details>`;
  }
  function bajarIcs() {
    const c = calDatos(), e = (t) => t.replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Setto//Drops//ES", "BEGIN:VEVENT", `UID:drop-${c.ini.getTime()}@setto.com.ar`, `DTSTAMP:${zulu(new Date())}`, `DTSTART:${zulu(c.ini)}`, `DTEND:${zulu(c.fin)}`,
      `SUMMARY:${e(c.tit)}`, `DESCRIPTION:${e(c.det)}`, `URL:${location.origin}/#especial`, "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${e(c.tit)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "setto-drop.ics";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function renderSets() {
    $("#setsGrid").innerHTML = on(SETS).map((s) => {
      const ahora = s.precios["12 oz"], antes = suelto(s, "12 oz"), ahorro = antes - ahora, pct = antes > 0 ? Math.round((ahorro / antes) * 100) : 0;
      return `<article class="set">
        <button class="ph ${s.foto ? "foto" : ""}" data-open="${s.id}" aria-label="Ver ${esc(s.nombre)}"><img src="${esc(s.img || "img/mochito-lie.png")}" alt="${esc(descOf(s))}" loading="lazy"></button>
        ${pct > 0 ? `<span class="off num">${pct}% off</span>` : ""}${stockBadge(s)}
        <h3>${esc(s.nombre)}</h3>
        <p class="code">${esc(s.codigo || "")}${s.tema ? " ✦ " + esc(s.tema) : ""}</p>
        <p class="combo">${esc(descOf(s))}</p>${stockLine(s)}
        <div class="foot"><span class="from num">Desde<b>${money(ahora)}${ahorro > 0 ? `<s>${money(antes)}</s>` : ""}</b>${rateTag(s)}</span>
        ${sinStock(s) ? "" : `<button class="add" data-open="${s.id}" aria-label="Elegir tamaño de ${esc(s.nombre)}">+</button>`}</div>
      </article>`;
    }).join("");
    $("#sets").hidden = on(SETS).length === 0;
    dots("setsGrid");
  }
  let tab = "dirty";
  function renderCarta() {
    const list = on(tab === "dirty" ? DIRTY : MOCHIS);
    $("#cntDirty").textContent = on(DIRTY).length + " sabores · fríos";
    $("#cntMochi").textContent = on(MOCHIS).length + " sabores · por unidad";
    $("#cartaEyebrow").textContent = tab === "dirty" ? "Fríos · Elegí tu leche y personalizalo" : "Por unidad · Algunos sabores son rotativos";
    $("#grid").innerHTML = list.map((p) => {
      const agot = p.agotado;
      const precio = tab === "dirty" ? `<span class="from num">Desde<b>${money(p.precios["12 oz"])}</b>${rateTag(p)}</span>` : `<span class="from num">Unidad<b>${money(p.precio)}</b>${rateTag(p)}</span>`;
      const sb = tab === "mochi" ? stockBadge(p) : "";
      const badge = agot ? '<span class="badge">Agotado</span>' : sb ? sb : p.rotativo ? '<span class="badge">Rotativo</span>' : "";
      return `<article class="item">
        <button class="ph ${p.foto ? "foto" : ""}" data-open="${p.id}" aria-label="Ver ${esc(nameOf(p))}">${badge}<img src="${esc(p.img || "img/mochito-lie.png")}" alt="${esc(tab === "dirty" ? p.nombre + " en vaso transparente" : "Mochi de " + p.nombre + " entero y cortado")}" loading="lazy"></button>
        <h3>${esc(p.nombre)}</h3><p class="desc">${esc(p.desc)}</p>${tab === "mochi" ? stockLine(p) : ""}
        <div class="row">${precio}${agot || (tab === "mochi" && sinStock(p)) ? "" : `<button class="add" style="margin-left:auto" ${tab === "dirty" ? `data-open="${p.id}"` : `data-quick="${p.id}"`} aria-label="Sumar ${esc(nameOf(p))}">+</button>`}</div>
      </article>`;
    }).join("") + (tab === "dirty"
      ? `<button class="next-cat" data-goto="mochi"><span class="nc-th"><img src="img/mochi-sakura.webp" alt=""></span><b>¿Y para acompañar?</b><span class="cta">Ver los ${on(MOCHIS).length} mochis →</span></button>`
      : `<button class="next-cat" data-goto="dirty"><span class="nc-th"><img src="img/dirty-caramel.webp" alt=""></span><b>¿Y para tomar?</b><span class="cta">Ver los ${on(DIRTY).length} dirty lattes →</span></button>`);
    $("#panelExtra").innerHTML = "";
    document.querySelectorAll(".sw").forEach((t) => t.setAttribute("aria-selected", String(t.id === "tab-" + tab)));
    $("#panel").setAttribute("aria-labelledby", "tab-" + tab);
    $("#grid").scrollLeft = 0; dots("grid");
  }
  function renderClubInfo() {
    const c = S.club || {};
    $("#club").hidden = c.activo === false;
    $("#clubPremio").textContent = `El pedido que completa los ${c.meta || 8} sellos viene con ${premioTxt()}.` + (c.minimo > 0 ? ` Suman sello los pedidos desde ${money(c.minimo)}.` : "");

    $("#clubRegalo").hidden = !regaloOn();
    $("#mnavClub").hidden = !clubOn();
    drawStamps(0, c.meta || 8, true);
  }
  function drawStamps(n, meta, ejemplo) {
    meta = Math.max(1, Math.min(20, meta | 0));
    $("#stamps").innerHTML = Array.from({ length: meta }, (_, i) => {
      const last = i === meta - 1, filled = i < n;
      if (last) return `<div class="stamp gift ${filled ? "on" : ""}">${filled ? "¡Listo!" : "Premio"}</div>`;
      return `<div class="stamp ${filled ? "on" : ""}">${filled ? '<img src="img/mochito-run.png" alt="">' : i + 1}</div>`;
    }).join("");
    $("#stamps").style.opacity = ejemplo ? ".55" : "1";
  }
  /* ---------- maquinita en la landing: los rodillos giran un toque y abre /maquinita ---------- */
  const MQ_IMG = ["img/mochito-cup.png", "img/mochi-frutilla.webp", "img/mochi-oreo.webp", "img/dirty-caramel.webp", "img/dirty-strawberry.webp"];
  function renderMaquinita() { const sec = $("#maquinita"); if (sec) sec.hidden = !maqOn(); }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("#mqTirar"); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault(); if (a.dataset.giro) return; a.dataset.giro = "1";
    const reels = [...document.querySelectorAll("#maquinita .mq-reel")], h = reels[0].getBoundingClientRect().height;
    reels.forEach((r, i) => {
      const st = r.querySelector(".mq-strip"), imgs = [st.lastElementChild.getAttribute("src")];
      for (let k = 0; k < 8 + i * 3; k++) imgs.push(MQ_IMG[Math.floor(Math.random() * MQ_IMG.length)]);
      st.style.transition = "none"; st.style.transform = "translateY(0)";
      st.innerHTML = imgs.map((x) => `<img src="${x}" alt="">`).join(""); void st.offsetHeight;
      st.style.transition = `transform ${500 + i * 180}ms cubic-bezier(.3,.1,.3,1)`; st.style.transform = `translateY(${-(imgs.length - 1) * h}px)`;
    });
    setTimeout(() => { location.href = a.getAttribute("href"); }, 1000);
  });
  window.addEventListener("pageshow", () => { const a = $("#mqTirar"); if (a) delete a.dataset.giro; });
  function renderFooter() {
    const r = S.retiro || { rangos: [] };
    HORARIO = "De " + r.rangos.map(([a, b]) => a.replace(":00", "") + " a " + b.replace(":00", "")).join(" y de ") + " hs.";
    $("#footHours").textContent = "Retiro: " + HORARIO.charAt(0).toLowerCase() + HORARIO.slice(1);
    $("#waNum").textContent = S.whatsapp_visible || API.prettyPhone(S.whatsapp);
    $("#mnavWa").textContent = S.whatsapp_visible || API.prettyPhone(S.whatsapp);
    $("#navWa").href = `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(window.SettoMSG.render("consulta", {}, S))}`;
  }
  function renderBadge() {
    try { refreshStockUI(); } catch (_) {}
    $("#cartCount").textContent = units();
    $("#mbar").classList.toggle("on", units() > 0 && !$("#drawer").classList.contains("on") && !$("#sheet").classList.contains("on"));
    $("#mbarTot").textContent = money(total()) + " · " + units() + (units() === 1 ? " ítem" : " ítems");
  }
  function dots(id) {
    const rail = document.getElementById(id), d = document.querySelector(`.dots[data-for="${id}"]`);
    if (!d) return;
    d.innerHTML = Array.from(rail.children).map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("");
  }
  function onRail(e) {
    const rail = e.target, d = document.querySelector(`.dots[data-for="${rail.id}"]`); if (!d || !rail.children.length) return;
    const w = rail.children[0].getBoundingClientRect().width + 14;
    const i = Math.min(rail.children.length - 1, Math.round(rail.scrollLeft / w));
    d.querySelectorAll("i").forEach((el, k) => el.classList.toggle("on", k === i));
  }
  ["espGrid", "setsGrid", "grid"].forEach((id) => document.getElementById(id).addEventListener("scroll", onRail, { passive: true }));

  /* ---------- hoja de producto ---------- */
  let sheetState = null;
  function openSheet(id) {
    const p = find(id); if (!p) return;
    sheetState = { p, sz: unit(p) ? "" : "12 oz", qty: 1, leche: persOn(p) ? (leches()[0] || {}).nombre || "" : "", sin: [], rvOpen: false };
    drawSheet();
    px("ViewContent", { content_type: "product", content_ids: [p.id], content_name: nameOf(p), value: Number(priceOf(p, sheetState.sz)) || 0 });
    $("#sheet").classList.add("on"); $("#scrim").classList.add("on"); renderBadge();
    setTimeout(() => $("#sheet .x").focus(), 60);
  }
  function drawSheet() {
    const { p, sz, qty, leche, sin } = sheetState, k = kind(p);
    const custom = persOn(p) ? `${leches().length ? `<div><span class="eyebrow">Leche${fmt(p) === "set" ? " de la bebida" : ""}</span><div class="chips lechas" style="margin-top:8px">${leches().map((l) => `<button data-leche="${esc(l.nombre)}" aria-pressed="${l.nombre === leche}">${esc(l.nombre)}${Number(l.precio) > 0 ? ` <span class="num">+${money(l.precio)}</span>` : ""}</button>`).join("")}</div></div>` : ""}
      ${sinOpts().length ? `<div><span class="eyebrow">¿Algo para sacar?</span><div class="chips" style="margin-top:8px">${sinOpts().map((x) => `<button data-sin="${esc(x)}" aria-pressed="${sin.includes(x)}">${esc(x)}</button>`).join("")}</div></div>` : ""}` : "";
    const opts = unit(p) ? "" : `<div><span class="eyebrow">Tamaño</span><div class="opts" style="margin-top:8px">${["12 oz", "16 oz"].map((oz) => {
      const sv = k === "set" ? suelto(p, oz) : 0, pv = p.precios[oz];
      const pr = k === "set" && sv > pv ? `<s>${money(sv)}</s>${money(pv)} <em class="pct">−${Math.round(((sv - pv) / sv) * 100)}%</em>` : money(pv);
      return `<button class="opt" data-sz="${oz}" aria-pressed="${oz === sz}"><span class="rd"></span><b>${oz.toUpperCase()}</b><span class="pp num">${pr}</span></button>`;
    }).join("")}</div></div>`;
    const sinSt = sinStock(p) && !(k === "premium" && !espOpen());
    const blocked = p.agotado || sinSt || (k === "premium" && (!espOpen() || !(Number(bebida(p) ? p.precios[sz || "12 oz"] : p.precio) > 0)));
    $("#sheet").innerHTML = `<div class="sph ${tapado(p) ? "frost" : ""}"><img src="${esc(p.img || "img/mochito-lie.png")}" alt=""><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div class="sb">
        ${k === "premium" ? `<span class="eyebrow">Edición especial${espOpen() ? "" : " · próximamente"}</span>` : k === "set" ? `<span class="eyebrow">${esc(p.codigo || "")}${p.tema ? " ✦ " + esc(p.tema) : ""}</span>` : p.rotativo ? '<span class="eyebrow">Rotativo · consultá disponibilidad</span>' : ""}
        <h3 id="sTitle">${esc(nameOf(p))}</h3>
        <div class="s-row">${sheetRate(p)}<div class="qty" style="margin:0"><button data-sq="-1" aria-label="Restar uno">−</button><span class="num" style="min-width:18px;text-align:center">${qty}</span><button data-sq="1" aria-label="Sumar uno">+</button></div></div>
        <div class="s-rv" id="sRv" ${sheetState.rvOpen ? "" : "hidden"}>${sheetState.rvOpen ? sheetRvHtml(p) : ""}</div>
        <p class="muted">${esc(descOf(p))}</p>
        ${k === "premium" && !espOpen() ? "" : stockLine(p)}
        ${opts}
        ${custom}
        ${clubOn() && !blocked ? `<span class="clubtag">Tu pedido suma ${sellosTxt(spp())} del Setto Club</span>` : ""}
        <div class="act">
        ${blocked ? `<span class="btn big" style="flex:1;opacity:.7;box-shadow:none;background:var(--bg-2);color:var(--ink);cursor:default">${p.agotado ? "Agotado" : sinSt ? "Sin stock hoy" : "Todavía no disponible"}</span>` : `<button class="btn solid big" id="sheetAdd">Agregar · <span class="num">${money((priceOf(p, sz) + lechePrecio(leche)) * qty)}</span></button>`}</div>
      </div>`;
  }
  /* reseñas dentro de la ficha: promedio con estrellas + desplegable */
  const PRV = {};
  const estrellas = (v) => `<span class="stars5" aria-hidden="true"><span>★★★★★</span><span style="width:${Math.max(0, Math.min(100, (v / 5) * 100))}%">★★★★★</span></span>`;
  function sheetRate(p) {
    const r = RATINGS[p.id];
    if (!r || !r.cantidad) return `<span class="s-rate none">${estrellas(0)}<small>Todavía sin reseñas</small></span>`;
    return `<span class="s-rate">${estrellas(r.promedio)}<b class="num">${String(r.promedio).replace(".", ",")}</b><button class="s-rvbtn" data-rvtoggle aria-expanded="${sheetState.rvOpen}" aria-controls="sRv">${r.cantidad} reseña${r.cantidad > 1 ? "s" : ""} <i>${sheetState.rvOpen ? "▴" : "▾"}</i></button></span>`;
  }
  function sheetRvHtml(p) {
    const d = PRV[p.id];
    if (!d) return '<p class="loading">Cargando reseñas…</p>';
    if (d.error) return `<p class="muted">${esc(d.error)}</p>`;
    if (!d.items || !d.items.length) return '<p class="muted">Todavía no hay reseñas publicadas de este producto.</p>';
    const n = d.cantidad || d.items.length, bars = [5, 4, 3, 2, 1].map((k) => { const c = (d.por_estrella || {})[k] || 0; return `<div class="sb-bar"><span>${k}★</span><i><b style="width:${n ? (c / n) * 100 : 0}%"></b></i><small>${c}</small></div>`; }).join("");
    return `<div class="s-rvsum"><div class="s-rvbig"><b class="num">${String(d.promedio).replace(".", ",")}</b>${estrellas(d.promedio)}<small>${n} reseña${n > 1 ? "s" : ""}</small></div><div class="s-bars">${bars}</div></div>
      <div class="s-rvlist">${d.items.map(rvCard).join("")}</div>`;
  }
  async function cargarRvProducto(p) {
    if (!PRV[p.id]) { try { PRV[p.id] = API.productReviews ? await API.productReviews(p.id) : { items: [] }; } catch (e) { PRV[p.id] = { error: e.message || "No pudimos cargar las reseñas" }; } }
    if (sheetState && sheetState.p.id === p.id && sheetState.rvOpen) { const el = $("#sRv"); if (el) el.innerHTML = sheetRvHtml(p); }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-rvtoggle]") || !sheetState) return;
    sheetState.rvOpen = !sheetState.rvOpen; drawSheet();
    if (sheetState.rvOpen) { cargarRvProducto(sheetState.p); const el = $("#sRv"); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  });
  function closeSheet() { $("#sheet").classList.remove("on"); if (!$("#drawer").classList.contains("on")) $("#scrim").classList.remove("on"); renderBadge(); }

  /* ---------- pedido ---------- */
  let HORARIO = "";
  function slots() {
    const r = S.retiro || { dias: [], rangos: [], cadaMin: 30, anticipacionMin: 40 }, out = [], now = new Date();
    const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    for (let d = 0; d < 3 && out.length < 40; d++) {
      const day = new Date(now); day.setDate(now.getDate() + d);
      if (!r.dias.includes(day.getDay())) continue;
      for (const [a, b] of r.rangos) {
        for (let m = toMin(a); m <= toMin(b); m += r.cadaMin || 30) {
          const t = new Date(day); t.setHours(Math.floor(m / 60), m % 60, 0, 0);
          if (t - now < (r.anticipacionMin || 0) * 60000) continue;
          out.push((d === 0 ? "Hoy" : d === 1 ? "Mañana" : t.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })) + " · " + t.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) + " hs");
        }
      }
    }
    return out;
  }
  let view = "cart", sending = false;
  let form = { nombre: "", tel: "", hora: "", pago: "", nota: "", modo: "retiro", dir: "", dirExtra: "", premio: "" };
  try { const f = JSON.parse(localStorage.getItem("setto-form") || "null"); if (f) { form.nombre = f.nombre || ""; form.tel = f.tel || ""; form.dir = f.dir || ""; form.dirExtra = f.dirExtra || ""; } } catch (_) {}
  let lastOrder = null;
  try { lastOrder = JSON.parse(sessionStorage.getItem("setto-last-order") || "null"); } catch (_) {}

  function buildMessage(o) {
    const lines = o.items.map((c) => `• ${c.qty}× ${c.nombre}${c.size ? ` (${c.size})` : ""} — ${money(c.subtotal)}` + (c.detalle ? `\n   ↳ ${c.detalle}` : ""));
    const envio = o.modo === "envio";
    const entrega = envio ? `Envío: ${o.retiro}\nDirección: ${o.direccion}` + (Number(o.costo_envio) > 0 ? "" : "\n(Costo de envío a coordinar)") : `Retiro: ${o.retiro}`;
    const premio = o.premio ? `\n\n🎁 Con este pedido completo mi tarjeta del Setto Club: ${o.premio_txt || "premio"}` : "";
    const M = window.SettoMSG, ini = M.render("pedido_inicio", { codigo: o.code, entrega: envio ? "con envío a domicilio" : "para retirar" }, S);
    const cierre = o.track ? M.render("pedido_cierre", { link: linkSeguir(o.track) }, S) : "";
    return `${ini}\n\n${lines.join("\n")}\n\nTotal: ${money(o.total)}${premio}\n\nNombre: ${o.nombre}\n${entrega}\nPago: ${o.pago}` + (o.nota ? `\nNota: ${o.nota}` : "")
      + (cierre ? `\n\n${cierre}` : "");
  }
  const envioOn = () => !!(S.envio && S.envio.activo);
  const envioCosto = () => (envioOn() && form.modo === "envio" ? Math.max(0, Number(S.envio.costo) || 0) : 0);
  const fullDir = () => [form.dir.trim(), form.dirExtra.trim()].filter(Boolean).join(" · ");
  const linkSeguir = (t) => `${location.origin}${location.pathname.replace(/index\.html$/, "")}?seguir=${t}`;
  const waLink = (msg) => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(msg)}`;

  function openDrawer() {
    view = lastOrder && view === "sent" ? "sent" : "cart"; $("#drawer").classList.add("on"); $("#scrim").classList.add("on"); drawDrawer(); renderBadge(); setTimeout(() => $("#dClose").focus(), 50);
    closeMenu();
    if (API.normPhone(form.tel) && !(cardCache && cardCache.tel === API.normPhone(form.tel))) loadCard().then(() => { if (view === "cart" && $("#drawer").classList.contains("on")) drawDrawer(); });
  }
  function closeDrawer() { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); if (view === "sent") { view = "cart"; } renderBadge(); }
  function sugeridos() { // "¿Le sumás algo?": lo que hay hoy y no está en el pedido; primero lo que falta (mochi o bebida)
    const ya = new Set(cart.map((c) => c.id));
    const ok = (p) => p.activo !== false && !p.agotado && !sinStock(p) && !ya.has(p.id) && (unit(p) ? Number(p.precio) : Number((p.precios || {})["12 oz"])) > 0;
    const hayMochi = cart.some((c) => { const p = find(c.id); return p && unit(p); }), hayBebida = cart.some((c) => { const p = find(c.id); return p && bebida(p); });
    const esp = espOpen() ? on(ESP) : [], m = [...esp.filter(unit), ...MOCHIS], d = [...esp.filter((p) => fmt(p) === "dirty"), ...DIRTY], st = [...esp.filter((p) => fmt(p) === "set"), ...SETS];
    const orden = hayBebida && !hayMochi ? [m, st, d] : hayMochi && !hayBebida ? [d, st, m] : [m, d, st];
    return orden.flat().filter(ok).slice(0, 6);
  }
  function sugHtml() {
    const l = sugeridos(); if (!l.length) return "";
    return `<div class="sug"><b class="sug-t">¿Le sumás algo?</b><div class="sug-r">${l.map((p) => `<div class="sug-i">
      <button class="sug-ph" data-open="${p.id}" aria-label="Ver ${esc(nameOf(p))}"><img src="${esc(p.img || "img/mochito-lie.png")}" alt="" loading="lazy"></button>
      <button class="add sug-add" ${unit(p) ? `data-quick="${p.id}"` : `data-open="${p.id}"`} aria-label="Sumar ${esc(nameOf(p))}">+</button>
      <b>${esc(p.nombre)}</b><small class="num">${unit(p) ? "" : "Desde "}${money(unit(p) ? p.precio : p.precios["12 oz"])}</small></div>`).join("")}</div></div>`;
  }
  const giftCta = () => gcfg().activo === false ? "" : `<a class="gift-cta" href="/gift-cards" data-closedrawer><span class="gc-ico" aria-hidden="true">🎁</span><span><b>¿Es para regalar?</b><small>Mandá una gift card digital de Setto.</small></span><span class="go" aria-hidden="true">→</span></a>`;
  const maqCta = () => !maqOn() ? "" : `<a class="gift-cta maq-cta" href="/maquinita" data-closedrawer><span class="gc-ico" aria-hidden="true"><img src="img/mochito-cup.png" alt=""></span><span><b>¿Probás suerte?</b><small>Tirá en la maquinita de Mochito antes de pedir.</small></span><span class="go" aria-hidden="true">→</span></a>`;
  function drawDrawer() {
    const body = $("#dBody"), foot = $("#dFoot");
    $("#dBack").hidden = view !== "checkout" && view !== "buscar";
    if (view === "cart") {
      $("#dTitle").textContent = "Tu pedido";
      if (!cart.length) { body.innerHTML = `${trackHtml()}<div class="empty"><img src="img/mochito-cup.png" alt=""><b>Todavía no sumaste nada</b><p class="muted" style="font-size:.9rem">Arrancá por un set: bebida + mochi.</p><div class="empty-acts"><a class="btn" href="#sets" data-closedrawer>Ver sets</a><button class="btn" id="toBuscar">Consultar mi pedido</button></div></div>`; foot.innerHTML = ""; return; }
      body.innerHTML = trackHtml() + cart.map((c, i) => `<div class="line"><span class="th"><img src="${esc(c.img)}" alt=""></span><div><b>${esc(c.nombre)}</b>${c.detalle ? `<small class="det">${esc(c.detalle)}</small>` : ""}<small>${c.size ? c.size.toUpperCase() + " · " : ""}${money(c.precio)} c/u</small>
        <div class="qty"><button data-q="${i}" data-d="-1" aria-label="Restar uno">−</button><span class="num">${c.qty}</span><button data-q="${i}" data-d="1" aria-label="Sumar uno">+</button></div></div>
        <span class="lp num">${money(c.precio * c.qty)}</span></div>`).join("") + sugHtml() + `<div class="ctas">${giftCta()}${maqCta()}</div>`;
      foot.innerHTML = `${regaloLine()}${clubLine()}<div class="tot"><span>Total</span><span class="num">${money(total())}</span></div><button class="btn solid big" id="toCheckout">Continuar</button>
        <p class="muted" style="font-size:.78rem;text-align:center">${envioOn() ? "Retiro o envío: lo elegís después." : "¿Querés delivery? Pedí por PedidosYa, Rappi o Uber Eats."}</p>`;
    }
    if (view === "buscar") { $("#dTitle").textContent = "Consultar pedido"; body.innerHTML = buscarDrawerHtml(); foot.innerHTML = ""; return; }
    if (view === "checkout") {
      $("#dTitle").textContent = "Entrega";
      if (!envioOn()) form.modo = "retiro";
      const pagoEnvio = (S.envio || {}).pago || "Transferencia / Mercado Pago";
      const pagosVer = form.modo === "envio" ? [pagoEnvio] : S.pagos || [];
      if (!pagosVer.includes(form.pago)) form.pago = pagosVer[0] || "";
      const r = S.retiro || {}, isEnv = form.modo === "envio", costo = Math.max(0, Number((S.envio || {}).costo) || 0);
      body.innerHTML = `
        ${envioOn() ? `<div class="modo" role="radiogroup" aria-label="Forma de entrega">
          <button data-modo="retiro" role="radio" aria-checked="${!isEnv}"><b>Retiro</b><small>Pasás a buscarlo</small></button>
          <button data-modo="envio" role="radio" aria-checked="${isEnv}"><b>Envío a domicilio</b><small>${costo > 0 ? "Costo " + money(costo) : "Costo a coordinar"}</small></button>
        </div>` : ""}
        ${isEnv ? `<label class="f" for="fDir">Dirección exacta<input id="fDir" autocomplete="street-address" value="${esc(form.dir)}" placeholder="Calle y número"><span class="hintf">${esc((S.envio || {}).aviso || "")}</span></label>
          <label class="f" for="fDir2">Piso, depto o referencia (opcional)<input id="fDir2" value="${esc(form.dirExtra)}" placeholder="Ej: 3° B, timbre 2, entre Colón y Moreno"></label>` : ""}
        <label class="f" for="fNombre">Nombre<input id="fNombre" autocomplete="given-name" value="${esc(form.nombre)}" placeholder="Cómo te llamamos"></label>
        <label class="f" for="fTel">Tu celular (WhatsApp)<input id="fTel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(form.tel)}" placeholder="223 347-1277"><span class="hintf">Con este número sumás sellos del Setto Club.</span></label>
        <label class="f" for="fHora">${isEnv ? "Horario de entrega" : "Horario de retiro"}<select id="fHora"><option value="">Elegí un horario</option>${slots().map((o) => `<option ${o === form.hora ? "selected" : ""}>${esc(o)}</option>`).join("")}</select><span class="hintf">${esc(HORARIO)} Pedí con al menos ${r.anticipacionMin || 0} minutos.</span></label>
        <div class="f"><span>Forma de pago</span><div class="chips">${pagosVer.map((p) => `<button data-pago="${esc(p)}" aria-pressed="${p === form.pago}">${esc(p)}</button>`).join("")}</div><span class="hintf">${form.modo === "envio" ? "Con envío, solo transferencia." : "El pago se coordina por WhatsApp."}</span></div>
        ${premioPicker()}
        ${giftBox()}
        <label class="f" for="fNota">Nota (opcional)<textarea id="fNota" placeholder="Ej: tocar timbre 2">${esc(form.nota)}</textarea></label>
        <div id="fErr" class="err" hidden></div>`;
      foot.innerHTML = `${regaloLine()}${clubLine()}${envioCosto() > 0 ? `<div class="tot" style="font-weight:500;font-size:.9rem"><span>Envío</span><span class="num">${money(envioCosto())}</span></div>` : ""}${premioOff() > 0 && completes() ? `<div class="tot" style="font-weight:500;font-size:.9rem"><span>Premio ${premioDesc()}% off</span><span class="num">${money(-premioOff())}</span></div>` : ""}${giftOff() > 0 ? `<div class="tot" style="font-weight:500;font-size:.9rem"><span>Gift card</span><span class="num">${money(-giftOff())}</span></div>` : ""}<div class="tot"><span>Total</span><span class="num">${money(antesGift() - giftOff())}</span></div><button class="btn wa big" id="toWA">${sending ? "Enviando…" : "Enviar pedido por WhatsApp"}</button>`;
      [["fNombre", "nombre"], ["fTel", "tel"], ["fHora", "hora"], ["fNota", "nota"], ["fDir", "dir"], ["fDir2", "dirExtra"]].forEach(([id, k]) => { const el = $("#" + id); if (el) el.addEventListener("input", (e) => { form[k] = e.target.value; }); });
      $("#fTel").addEventListener("change", async () => {
        if (!(await loadCard()) || view !== "checkout") return;
        if (completes() && !$(".premio-pick")) return drawDrawer(); // aparece el selector de premio
        const cl = $("#dFoot .clubline"); if (cl) cl.outerHTML = clubLine(); // sin redibujar el botón de enviar
      });
    }
    if (view === "sent" && lastOrder) {
      $("#dTitle").textContent = "Último paso";
      const est = trackVivos.find((x) => x.code === lastOrder.code) || { code: lastOrder.code, status: "pendiente", etapa: "recibido", modo: lastOrder.modo, retiro: "" };
      body.innerHTML = `<div class="ok"><img src="img/mochito-cup.png" alt=""><span class="eyebrow">Tu código de pedido</span><div class="coderow num">${esc(lastOrder.code)}</div>
        ${lastOrder.premio ? `<div class="clubline" style="width:100%;text-align:left"><img src="img/mochito-run.png" alt=""><div><b>¡Completaste tu tarjeta!</b> Tu premio: ${esc(lastOrder.premio_txt || "a confirmar")}.</div></div>` : ""}
        <p class="muted" style="font-size:.9rem">${lastOrder.modo === "envio" ? "Mandanos el WhatsApp y te confirmamos envío y pago." : "Mandanos el WhatsApp y te confirmamos dirección y pago."}${clubOn() ? " Al recibirlo sumás tu sello." : ""}</p></div>
        <div class="dtrk sent-trk">${trackCard(est)}</div>
        <p class="muted" style="font-size:.84rem;text-align:center">Te avisamos acá cuando esté listo. El link para volver va en tu WhatsApp.</p>
        <div class="msg" id="msgText" hidden>${esc(lastOrder.message)}</div>`;
      foot.innerHTML = `<a class="btn wa big" href="${waLink(lastOrder.message)}" target="_blank" rel="noopener" data-resend>${lastOrder.enviado ? "Reenviar mensaje por WhatsApp" : "Enviar por WhatsApp"}</a>
        <div style="display:flex;justify-content:center;gap:18px"><button class="back" id="copyMsg">Copiar mensaje</button><button class="back" id="newOrder">Hacer otro pedido</button></div>`;
    }
  }

  async function sendOrder() {
    const err = []; const el = $("#fErr");
    if (!form.nombre.trim()) err.push("tu nombre");
    if (!API.normPhone(form.tel)) err.push("un celular válido");
    if (!form.hora) err.push("un horario");
    if (form.modo === "envio" && form.dir.trim().length < 5) err.push("la dirección de entrega");
    if (err.length) { el.hidden = false; el.textContent = "Falta " + err.join(", ") + "."; return; }
    if (sending) return;
    if (clubOn() && API.normPhone(form.tel)) await loadCard();
    if (completes() && !form.premio) { drawDrawer(); const e2 = $("#fErr"); e2.hidden = false; e2.textContent = "Completaste tu tarjeta: elegí tu premio antes de enviar."; $(".premio-pick")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    sending = true; drawFootOnly();
    try {
      const isEnv = form.modo === "envio";
      const o = await API.createOrder({ nombre: form.nombre.trim(), phone: form.tel, items: cart.map((c) => ({ id: c.id, size: c.size || null, qty: c.qty, leche: c.leche || null, sin: c.sin || [] })), retiro: form.hora, pago: form.pago, nota: form.nota.trim(), modo: isEnv ? "envio" : "retiro", direccion: isEnv ? fullDir() : null, premio: completes() ? form.premio : null, gift: GIFT ? GIFT.code : null });
      if (window.SettoPixel) window.SettoPixel.purchase(o.code, { ...pxCarrito(), value: Number(o.total) || 0 });
      const ph = o.phone || API.normPhone(form.tel);
      let track = o.track || null;
      if (!track) { try { const st = await API.orderStatus([o.code], ph); track = (st.find((x) => x.code === o.code) || {}).track || null; } catch (_) {} }
      const full = { ...o, track, nombre: form.nombre.trim(), retiro: form.hora, pago: form.pago, nota: form.nota.trim() };
      lastOrder = { code: o.code, track, message: buildMessage(full), modo: o.modo || "retiro", premio: !!o.premio, premio_txt: o.premio_txt, enviado: true };
      cardCache = null;
      trackVivos = [{ code: o.code, status: "pendiente", etapa: "recibido", modo: o.modo || "retiro", retiro: form.hora, created_at: new Date().toISOString(), track }, ...trackVivos.filter((x) => x.code !== o.code)];
      guardarSeguimiento({ code: o.code, phone: ph, track, at: Date.now() });
      refrescarStock();
      try { sessionStorage.setItem("setto-last-order", JSON.stringify(lastOrder)); localStorage.setItem("setto-form", JSON.stringify({ nombre: form.nombre, tel: form.tel, dir: form.dir, dirExtra: form.dirExtra })); } catch (_) {}
      if (GIFT && o.gift) { const rest = GIFT.saldo - o.gift; if (rest > 0) usarGift(GIFT.code, rest); else quitarGift(); }
      cart = []; save(); form.hora = ""; form.nota = ""; form.premio = ""; renderBadge();
      view = "sent"; sending = false; drawDrawer();
      const link = waLink(lastOrder.message);
      if (matchMedia("(pointer:coarse)").matches) setTimeout(() => { location.href = link; }, window.SettoPixel && window.SettoPixel.on ? 350 : 0); // le damos tiempo al pixel antes de abrir WhatsApp
      else window.open(link, "_blank", "noopener");
    } catch (e) {
      sending = false;
      if (/premio/i.test(e.message || "")) { await loadCard(true); drawDrawer(); }
      if (/gift card/i.test(e.message || "")) { quitarGift(); drawDrawer(); }
      if (/nos qued/i.test(e.message || "") && API.getStock) { try { STOCK = await API.getStock(); renderEspecial(); renderSets(); renderCarta(); } catch (_) {} }
      drawFootOnly();
      const el2 = $("#fErr"); if (el2) { el2.hidden = false; el2.textContent = e.message || "No pudimos registrar el pedido. Probá de nuevo."; }
    }
  }
  function drawFootOnly() { const b = $("#toWA"); if (b) { b.textContent = sending ? "Enviando…" : "Enviar pedido por WhatsApp"; b.disabled = sending; } }

  /* ---------- Club: consulta ---------- */
  $("#cardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#cardMsg"), tel = $("#cardPhone").value;
    if (!API.normPhone(tel)) { msg.textContent = "Revisá el número: código de área + número, por ejemplo 223 347-1277."; return; }
    msg.textContent = "Buscando…";
    try {
      const c = await API.getCard(tel);
      drawStamps(c.sellos, c.meta, false);
      const falta = Math.max(0, c.meta - c.sellos);
      msg.textContent = !c.existe ? "Todavía no tenés sellos. Se suman al recibir un pedido de la web."
        : falta === 0 ? `¡Completaste la tarjeta! Avisanos en tu próximo pedido para canjear: ${c.premio || "tu premio"}.`
        : falta <= (S.club && S.club.sellos_por_pedido || 1) ? `Tenés ${c.sellos} de ${c.meta} sellos. ¡Tu próximo pedido viene con ${premioTxt()}!`
        : `Tenés ${c.sellos} de ${c.meta} sellos. Te ${falta === 1 ? "falta 1" : "faltan " + falta} para ${premioTxt()}.`;
      try { localStorage.setItem("setto-form", JSON.stringify({ nombre: form.nombre, tel })); } catch (_) {}
    } catch (err) { msg.textContent = err.message || "No pudimos consultar la tarjeta."; }
  });

  /* ---------- eventos ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button, a"); if (!b) return;
    if (b.dataset.open) openSheet(b.dataset.open);
    if (b.dataset.quick) { const p = find(b.dataset.quick); if (p && addItem(p) && view === "cart" && $("#drawer").classList.contains("on")) drawDrawer(); }
    if (b.dataset.close !== undefined) closeSheet();
    if (b.dataset.sz) { sheetState.sz = b.dataset.sz; drawSheet(); }
    if (b.dataset.sq) { sheetState.qty = Math.max(1, sheetState.qty + +b.dataset.sq); drawSheet(); }
    if (b.id === "sheetAdd") { if (addItem(sheetState.p, sheetState.sz, sheetState.qty, sheetState.leche, sheetState.sin)) { closeSheet(); if (view === "cart" && $("#drawer").classList.contains("on")) drawDrawer(); } }
    if (b.dataset.leche !== undefined && sheetState) { sheetState.leche = b.dataset.leche; drawSheet(); }
    if (b.dataset.sin !== undefined && sheetState) { const x = b.dataset.sin, s = sheetState.sin; sheetState.sin = s.includes(x) ? s.filter((y) => y !== x) : [...s, x]; drawSheet(); }
    if (b.id === "tab-dirty" || b.id === "tab-mochi") { tab = b.id.slice(4); renderCarta(); }
    if (b.dataset.goto) { tab = b.dataset.goto; renderCarta(); $(".switch").scrollIntoView({ behavior: "smooth", block: "center" }); }
    if (b.dataset.q !== undefined) { const c = cart[+b.dataset.q]; if (+b.dataset.d > 0) { const fr = frenoStock(find(c.id), 1); if (fr) { toast(fr); return; } } c.qty += +b.dataset.d; if (c.qty <= 0) cart.splice(+b.dataset.q, 1); save(); renderBadge(); drawDrawer(); }
    if (b.id === "openCart" || b.id === "mbarBtn") openDrawer();
    if (b.id === "dClose" || b.dataset.closedrawer !== undefined) closeDrawer();
    if (b.id === "dBack") { view = "cart"; drawDrawer(); }
    if (b.id === "toCheckout") { view = "checkout"; drawDrawer(); if (cart.length) px("InitiateCheckout", { ...pxCarrito(), value: total() }); }
    if (b.id === "toBuscar") { BQ.res = null; BQ.err = ""; BQ.tel = BQ.tel || form.tel; view = "buscar"; drawDrawer(); setTimeout(() => { const i = $("#bqTel"); if (i && !i.value) i.focus(); }, 30); }
    if (b.dataset.pago) { form.pago = b.dataset.pago; document.querySelectorAll("[data-pago]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
    if (b.id === "toWA") sendOrder();
    if (b.dataset.premio) { form.premio = b.dataset.premio; drawDrawer(); }
    if (b.dataset.modo) { form.modo = b.dataset.modo; drawDrawer(); if (form.modo === "envio") setTimeout(() => { const d = $("#fDir"); if (d && !d.value) d.focus(); }, 30); }
    if (b.id === "copyMsg") {
      const txt = lastOrder ? lastOrder.message : "";
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#msgText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Seleccionado: copialo con tu teclado"); };
      try { navigator.clipboard.writeText(txt).then(() => toast("Mensaje copiado"), fallback); } catch (_) { fallback(); }
    }
    if (b.id === "newOrder") { refrescarStock(); lastOrder = null; try { sessionStorage.removeItem("setto-last-order"); } catch (_) {} view = "cart"; closeDrawer(); irA("#sets"); }
  });
  /* ---------- consultar pedido desde el carrito (otro navegador, pestaña cerrada) ---------- */
  // Celular + código: seguimiento completo y queda guardado acá. Un solo dato: solo si hay un pedido en curso y en qué etapa.
  const BQ = { tel: "", code: "", res: null, por: "", err: "", busy: false };
  const ETAPA_TXT = { recibido: "Recibido", preparando: "En preparación", listo: "Listo" };
  const horaTxt = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  function buscarDrawerHtml() {
    let res = "";
    if (BQ.res && !BQ.res.length) res = `<div class="trk bq-res"><p style="margin:0"><b>No encontramos un pedido en curso${BQ.por === "tel" ? " con ese celular" : " con ese código"}.</b></p>
        <p class="muted" style="margin:6px 0 0;font-size:.88rem">Acá aparecen los pedidos hechos desde la web que todavía no se entregaron (hasta 2 días). ¿Dudas? <a href="${waLink("¡Hola! Quiero consultar por mi pedido.")}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>.</p></div>`;
    else if (BQ.res) res = BQ.res.map((o) => `<div class="trk bq-res"><div class="trk-h"><span class="eyebrow">Pedido en curso</span><b class="num">${esc(o.code)}</b><span class="trk-r">${o.modo === "envio" ? "Envío" : "Retiro"} · pedido ${haceTxt(o.created_at)} ${horaTxt(o.created_at)} hs</span></div>
        <p style="margin:6px 0 0">Estado: <b>${o.etapa === "listo" ? (o.modo === "envio" ? "En camino" : "Listo para retirar") : ETAPA_TXT[o.etapa] || "Recibido"}</b></p></div>`).join("")
        + `<p class="muted" style="font-size:.86rem;margin:4px 0 0">Para seguirlo acá en vivo, completá ${BQ.por === "tel" ? "el código del pedido" : "tu celular"} y tocá Buscar.</p>`;
    return `<form class="bq-form" id="dBuscar" novalidate>
        <p class="muted" style="margin:0;font-size:.9rem">Poné tu celular o el código del pedido (está en el WhatsApp que nos mandaste). Con los dos ves el seguimiento completo y queda guardado en este navegador.</p>
        <label class="f" for="bqTel">Tu celular<input id="bqTel" name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="223 347-1277" value="${esc(BQ.tel)}"></label>
        <label class="f" for="bqCode">Código del pedido<input id="bqCode" name="code" placeholder="STT-1234" autocapitalize="characters" autocomplete="off" maxlength="12" value="${esc(BQ.code)}"></label>
        <span class="rv-err" ${BQ.err ? "" : "hidden"}>${esc(BQ.err)}</span>
        <button class="btn solid big" type="submit" ${BQ.busy ? "disabled" : ""}>${BQ.busy ? "Buscando…" : "Buscar"}</button>
      </form><div class="bq-list">${res}</div>`;
  }
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "dBuscar") return; e.preventDefault();
    const f = e.target, raw = f.code.value.trim().toUpperCase();
    BQ.tel = f.tel.value.trim(); BQ.code = raw; BQ.err = ""; BQ.res = null;
    const code = /^\d{4}$/.test(raw) ? "STT-" + raw : raw.replace(/^STT\s*-?\s*/, "STT-"), ph = API.normPhone(BQ.tel);
    if (!raw && !BQ.tel) BQ.err = "Poné tu celular o el código del pedido.";
    else if (raw && !/^STT-\d{4}$/.test(code)) BQ.err = "El código es STT seguido de 4 números.";
    else if (BQ.tel && !ph) BQ.err = "Revisá el celular: código de área + número.";
    if (BQ.err) { drawDrawer(); return; }
    BQ.busy = true; drawDrawer();
    try {
      if (raw && ph) {
        const r = await API.orderStatus([code], ph);
        if (!r.length) throw new Error("No encontramos ese pedido. Revisá el código y el celular (vale para pedidos de los últimos 3 días).");
        try { localStorage.setItem("setto-trk-ocultos", JSON.stringify(ocultosTrk().filter((c) => c !== code))); } catch (_) {}
        trackVivos = [{ ...r[0], phone: ph }, ...trackVivos.filter((x) => x.code !== code)];
        guardarSeguimiento({ code, phone: ph, track: r[0].track || null, at: Date.now() });
        if (!form.tel) form.tel = BQ.tel;
        BQ.busy = false; BQ.code = ""; view = "cart"; drawDrawer(); toast("¡Lo encontramos!");
        return;
      }
      BQ.por = raw ? "code" : "tel";
      BQ.res = await API.buscarPedido(raw ? null : ph, raw ? code : null);
    } catch (ex) { BQ.err = ex.message || "No pudimos buscar ahora. Probá de nuevo."; }
    BQ.busy = false; if (view === "buscar") drawDrawer();
  });
  /* ---------- menú mobile ---------- */
  function closeMenu() { const m = $("#mnav"); if (!m || m.hidden) return; m.hidden = true; $("#burger").setAttribute("aria-expanded", "false"); $("#burger").setAttribute("aria-label", "Abrir menú"); }
  $("#burger").addEventListener("click", () => {
    const m = $("#mnav"), open = m.hidden; m.hidden = !open;
    $("#burger").setAttribute("aria-expanded", String(open)); $("#burger").setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  });
  $("#mnav").addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });

  $("#scrim").addEventListener("click", () => { closeSheet(); closeDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); closeDrawer(); closeMenu(); } });

  /* ---------- stock en vivo ---------- */
  async function refrescarStock() { if (!API.getStock) return; try { STOCK = await API.getStock(); renderEspecial(); renderSets(); renderCarta(); renderBadge(); } catch (_) {} }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refrescarStock(); if (misPedidos().length) verSeguimiento(); } });

  /* ---------- seguimiento de pedidos ---------- */
  const SKEY = "setto-mis-pedidos";
  const misPedidos = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "[]").filter((x) => Date.now() - x.at < 14 * 864e5); } catch (_) { return []; } };
  function guardarSeguimiento(o) { try { const l = misPedidos().filter((x) => !((o.code && x.code === o.code) || (o.track && x.track === o.track))); l.unshift(o); localStorage.setItem(SKEY, JSON.stringify(l.slice(0, 8))); } catch (_) {} verSeguimiento(); }
  // llega desde el link del WhatsApp: ?seguir=CODIGO → guarda el pedido en este celular y lo muestra
  (function desdeLink() {
    const t = new URLSearchParams(location.search).get("seguir"); if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) return;
    try { const l = misPedidos().filter((x) => x.track !== t); l.unshift({ code: "", phone: "", track: t, at: Date.now() }); localStorage.setItem(SKEY, JSON.stringify(l.slice(0, 8))); } catch (_) {}
    try { history.replaceState(null, "", location.pathname + (PAGE !== "home" ? "?p=" + PAGE : "") + location.hash); } catch (_) {}
    window.scrollTo(0, 0);
  })();
  let trackT = null, trackVivos = [], MIOS = [];
  const telDe = (code) => (trackVivos.find((x) => x.code === code) || MIOS.find((x) => x.code === code) || {}).phone || (misPedidos().find((x) => x.code === code) || {}).phone || "";
  const trackDe = (code) => (trackVivos.find((x) => x.code === code) || MIOS.find((x) => x.code === code) || {}).track || (misPedidos().find((x) => x.code === code) || {}).track || "";
  const ocultosTrk = () => { try { return JSON.parse(localStorage.getItem("setto-trk-ocultos") || "[]"); } catch (_) { return []; } };
  const trackHtml = () => (trackVivos.length ? `<div class="dtrk">${trackVivos.map(trackCard).join("")}</div>` : "");
  async function traerMios() {
    const l = misPedidos(); if (!l.length) return [];
    const byPhone = {}; l.filter((x) => !x.track && x.phone).forEach((x) => (byPhone[x.phone] = byPhone[x.phone] || []).push(x.code));
    const tracks = l.filter((x) => x.track).map((x) => x.track);
    const parts = await Promise.all([tracks.length && API.trackStatus ? API.trackStatus(tracks) : [], ...Object.entries(byPhone).map(([ph, codes]) => API.orderStatus(codes, ph).then((r) => r.map((o) => ({ ...o, phone: o.phone || ph }))))]);
    const seen = new Set(); MIOS = parts.flat().filter((o) => o && !seen.has(o.code) && seen.add(o.code)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return MIOS;
  }
  async function verSeguimiento() {
    clearTimeout(trackT);
    const l = misPedidos(), box = $("#seguimiento"); if (!l.length) { box.hidden = true; if (PAGE === "listo") renderListo(); return; }
    let data = [];
    try { data = await traerMios(); } catch (_) { return; }
    if (PAGE === "listo") renderListo();
    // pendientes; entregados sin reseña (3 días); el resto hasta 3 horas
    const ocultos = ocultosTrk();
    const vivos = data.filter((o) => !ocultos.includes(o.code) && (o.status === "pendiente" || (o.status === "entregado" && !o.resena) || Date.now() - new Date(o.created_at) < 3 * 36e5)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    avisarCambios(vivos); trackVivos = vivos;
    // en vivo: cuando el equipo cambia el estado, la base avisa y refrescamos sin recargar la página
    if (API.onTrack) API.onTrack(vivos.filter((o) => o.status === "pendiente" && o.track).map((o) => o.track), enVivo);
    if ((view === "cart" || view === "sent") && $("#drawer").classList.contains("on")) drawDrawer();
    if (!vivos.length) { box.hidden = true; return; }
    if (box.querySelector(".rv-form")) return; // no pisar una reseña a medio escribir
    if (box.querySelector(".cmb-busy")) return; // ni un cambio que se está enviando
    box.hidden = false; box.innerHTML = `<div class="wrap">${vivos.map(trackCard).join("")}</div>`;
    if (vivos.some((o) => o.status === "pendiente")) trackT = setTimeout(verSeguimiento, 20000); // respaldo si el canal en vivo se corta
  }
  let vivoT = null, etapasVistas = null;
  const enVivo = () => { clearTimeout(vivoT); vivoT = setTimeout(verSeguimiento, 250); };
  const pasoTxt = (o) => (o.status === "entregado" ? "Entregado" : o.status === "cancelado" ? "Cancelado" : o.etapa === "listo" ? (o.modo === "envio" ? "En camino" : "Listo para retirar") : o.etapa === "preparando" ? "En preparación" : "Recibido");
  function avisarCambios(l) { // aviso corto en pantalla cuando el pedido avanza mientras la página está abierta
    const ahora = Object.fromEntries(l.map((o) => [o.code, pasoTxt(o)]));
    if (etapasVistas) { const c = l.find((o) => etapasVistas[o.code] && etapasVistas[o.code] !== ahora[o.code]); if (c) toast(`Tu pedido ${c.code}: ${ahora[c.code]}`); }
    etapasVistas = ahora;
  }
  function trackCard(o) {
    const env = o.modo === "envio";
    const pasos = ["Recibido", "En preparación", env ? "En camino" : "Listo para retirar", "Entregado"];
    const idx = o.status === "entregado" ? 3 : o.etapa === "listo" ? 2 : o.etapa === "preparando" ? 1 : 0;
    const txt = o.status === "cancelado" ? "Pedido cancelado. ¿Dudas? Escribinos por WhatsApp."
      : o.status === "entregado" ? `¡Entregado! Que lo disfrutes.${o.sellos > 0 ? ` Sumaste ${sellosTxt(o.sellos)} al Setto Club.` : ""}`
      : idx === 2 ? (env ? "Tu pedido salió y va en camino." : "¡Está listo! Ya podés pasar a buscarlo.")
      : idx === 1 ? "Lo estamos preparando."
      : "Recibido. Mandanos el WhatsApp para confirmarlo.";
    return `<div class="trk ${o.status}"><div class="trk-h"><span class="eyebrow">Tu pedido</span><b class="num">${esc(o.code)}</b><span class="trk-r">${esc(o.retiro || "")}</span>${o.status !== "pendiente" ? `<button class="trk-x" data-trackx="${esc(o.code)}" aria-label="Ocultar">✕</button>` : ""}</div>
      ${o.status === "cancelado" ? "" : `<ol class="trk-steps">${pasos.map((p, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}"><i></i><span>${p}</span></li>`).join("")}</ol>`}
      <p>${txt}</p>
      ${cambioHtml(o)}
      ${pushHtml(o)}
      ${o.status === "entregado" ? `<div class="trk-acts">${clubOn() ? `<button class="btn" data-vercard="${esc(o.code)}">Ver mis sellos</button>` : ""}${o.resena ? `<span class="muted" style="font-size:.84rem;align-self:center">¡Gracias por tu reseña!</span>` : `<button class="btn solid" data-resena="${esc(o.code)}">Dejar reseña</button>`}<a class="btn" href="/listo">Cómo armar tu bebida</a></div>`
        : o.status === "pendiente" && idx === 2 ? `<div class="trk-acts"><a class="btn" href="/listo">Cómo armar tu bebida</a></div>` : ""}</div>`;
  }
  /* ---------- avisos push: el cliente acepta notificaciones de su pedido ---------- */
  const PKEY = "setto-push";
  const pushMios = () => { try { return JSON.parse(localStorage.getItem(PKEY) || "[]"); } catch (_) { return []; } };
  const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const vapid = (window.SETTO_CONFIG || {}).vapidPublicKey;
  const pushOk = () => !API.DEMO && !!vapid && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let pushIOS = ""; // pedido con la ayuda de iPhone abierta
  function pushHtml(o) {
    if (o.status !== "pendiente" || !o.track) return "";
    const btn = `<button class="btn push-btn" data-push="${esc(o.track)}">🔔 Avisame cuando cambie</button>`;
    if (!pushOk()) {
      if (!esIOS || instalada || API.DEMO) return ""; // navegador sin push: queda el seguimiento de siempre
      return pushIOS !== o.track ? btn : `<div class="push-ios"><b>En iPhone los avisos llegan solo con Setto en tu inicio</b>
        <ol><li>Tocá <b>Compartir</b> (el cuadrado con la flecha) abajo en Safari.</li><li>Elegí <b>Agregar a inicio</b>.</li><li>Abrí Setto desde ese ícono y tocá <b>Avisame cuando cambie</b>.</li></ol>
        <small>Necesitás iOS 16.4 o más nuevo. Si no, te avisamos por WhatsApp como siempre.</small></div>`;
    }
    if (Notification.permission === "denied") return `<p class="push-off">Bloqueaste las notificaciones de Setto. Si las querés, activalas en los ajustes del navegador.</p>`;
    if (Notification.permission === "granted" && pushMios().includes(o.track)) return `<p class="push-on">🔔 Te avisamos con una notificación cuando cambie.</p>`;
    return btn;
  }
  const claveVapid = (k) => { const b = atob((k + "=".repeat((4 - (k.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-push]"); if (!b) return;
    const tr = b.dataset.push;
    if (!pushOk()) { // iPhone sin instalar: mostramos cómo, y dejamos el link del pedido para que el ícono abra este pedido
      pushIOS = tr; try { history.replaceState(null, "", "/?seguir=" + tr); } catch (_) {}
      verSeguimiento(); return;
    }
    b.disabled = true; b.textContent = "Activando…";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(perm === "denied" ? "Bloqueaste las notificaciones" : "Sin permiso no podemos avisarte");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(vapid) }));
      await API.pushSuscribir(tr, sub);
      try { localStorage.setItem(PKEY, JSON.stringify([tr, ...pushMios().filter((x) => x !== tr)].slice(0, 10))); } catch (_) {}
      toast("Listo, te avisamos cuando cambie");
    } catch (ex) { toast(ex.message || "No pudimos activar los avisos"); }
    verSeguimiento();
  });

  /* ---------- avisos de drops: el cliente se anota una vez y le llega cada lanzamiento ---------- */
  const DAV = "setto-drop-av";
  const dropAvOn = () => { try { return localStorage.getItem(DAV) === "1"; } catch (_) { return false; } };
  let dropIOS = false;
  function dropAvHtml(txt) {
    const btn = `<button type="button" class="btn solid" data-dropav>🔔 ${esc(txt)}</button>`;
    if (!pushOk()) {
      if (!esIOS || instalada || API.DEMO) return "";
      return !dropIOS ? btn : `<div class="push-ios"><b>En iPhone los avisos llegan solo con Setto en tu inicio</b>
        <ol><li>Tocá <b>Compartir</b> (el cuadrado con la flecha) abajo en Safari.</li><li>Elegí <b>Agregar a inicio</b>.</li><li>Abrí Setto desde ese ícono y tocá <b>${esc(txt)}</b>.</li></ol>
        <small>Necesitás iOS 16.4 o más nuevo.</small></div>`;
    }
    if (Notification.permission === "denied") return `<p class="push-off">Bloqueaste las notificaciones de Setto. Si las querés, activalas en los ajustes del navegador.</p>`;
    if (Notification.permission === "granted" && dropAvOn()) return `<p class="push-on">🔔 Te avisamos con una notificación. <button type="button" class="lnk" data-dropnoav>No avisarme más</button></p>`;
    return btn;
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-dropx]")) { const bar = $("#dropBar"); try { localStorage.setItem(DBX, bar.dataset.k); } catch (_) {} bar.remove(); return; }
    if (e.target.closest("[data-ics]")) { bajarIcs(); e.target.closest("details").open = false; return; }
    if (e.target.closest("[data-dropnoav]")) {
      try { const reg = await navigator.serviceWorker.getRegistration("/sw.js"); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) await API.dropDesuscribir(sub.endpoint); } catch (_) {}
      try { localStorage.removeItem(DAV); } catch (_) {}
      toast("Listo, no te avisamos más de los drops"); renderEspecial(); return;
    }
    const b = e.target.closest("[data-dropav]"); if (!b) return;
    if (!pushOk()) { dropIOS = true; renderEspecial(); return; }
    b.disabled = true; b.textContent = "Activando…";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(perm === "denied" ? "Bloqueaste las notificaciones" : "Sin permiso no podemos avisarte");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(vapid) }));
      await API.dropSuscribir(sub);
      try { localStorage.setItem(DAV, "1"); } catch (_) {}
      toast("¡Listo! Te avisamos cuando salga");
    } catch (ex) { toast(ex.message || "No pudimos activar los avisos"); }
    renderEspecial();
  });

  /* ---------- cambio de pedido: el cliente elige reemplazo, sacarlo o cancelar ---------- */
  const CMB = {};
  function cambioHtml(o) {
    const c = o.cambio; if (!c) return "";
    if (c.resolucion === "cambiado") return `<p class="cmb-ok">✓ Actualizamos tu pedido con el cambio que elegiste. Total: <b class="num">${money(o.total)}</b></p>`;
    if (c.estado !== "esperando" || o.status !== "pendiente" || !o.track) return "";
    const st = CMB[o.track] || (CMB[o.track] = { data: null, sel: {}, err: "", cancelArm: false });
    if (!st.data && !st.loading) { st.loading = true; API.cambioOpciones(o.track).then((d) => { st.data = d; st.loading = false; redibujarCambio(o.track); }).catch((e) => { st.err = e.message; st.loading = false; redibujarCambio(o.track); }); }
    return `<div class="cmb" data-cmb="${esc(o.track)}">${cambioInner(o.track)}</div>`;
  }
  function cambioInner(tr) {
    const st = CMB[tr], d = st.data;
    if (st.err && !d) return `<p class="rv-err">${esc(st.err)}</p>`;
    if (!d) return '<b>Nos quedamos sin algo de tu pedido 😕</b><p class="loading">Cargando opciones…</p>';
    if (d.estado !== "esperando") return "";
    let total = Number(d.total) || 0, listo = true;
    const filas = d.faltan.map((f) => {
      const e = st.sel[f.idx];
      if (!e) listo = false;
      else if (e === "quitar") total -= f.precio * f.qty;
      else { const a = f.alternativas.find((x) => x.id === e); if (a) total += (a.precio - f.precio) * f.qty; }
      const dif = (p) => { const x = (p - f.precio) * f.qty; return x === 0 ? "mismo precio" : (x > 0 ? "+" : "−") + money(Math.abs(x)).replace("−", ""); };
      return `<div class="cmb-f"><b>${f.qty}× ${esc(f.nombre)}${f.size ? ` (${esc(f.size)})` : ""}</b><small>${f.qty < f.de ? `Nos quedaron ${f.de - f.qty} de ${f.de}. ¿Qué hacemos con ${f.qty === 1 ? "el que falta" : `los ${f.qty} que faltan`}?` : "¿Con qué lo reemplazamos?"}</small>
        <div class="cmb-opts">${f.alternativas.map((a) => `<button type="button" data-cmbsel="${f.idx}:${esc(a.id)}" aria-pressed="${e === a.id}">${a.img ? `<img src="${esc(a.img)}" alt="">` : ""}<span>${esc(a.nombre)}<small>${dif(a.precio)}</small></span></button>`).join("")}
          <button type="button" class="cmb-quitar" data-cmbsel="${f.idx}:quitar" aria-pressed="${e === "quitar"}"><span>Sacarlo<small>−${money(f.precio * f.qty)}</small></span></button></div>
        ${f.alternativas.length ? "" : '<small class="muted">No tenemos otro igual disponible ahora.</small>'}</div>`;
    }).join("");
    return `<b>Nos quedamos sin algo de tu pedido 😕</b><p class="muted" style="margin:2px 0 8px;font-size:.88rem">Elegí qué hacemos y confirmá. El total se ajusta solo.${d.nota ? ` <i>“${esc(d.nota)}”</i>` : ""}</p>
      ${filas}
      <div class="cmb-tot"><span>Nuevo total</span><b class="num">${listo ? money(Math.max(0, total)) : "—"}</b></div>
      ${st.err ? `<p class="rv-err">${esc(st.err)}</p>` : ""}
      <div class="trk-acts" style="margin-top:8px"><button class="btn solid" data-cmbok ${listo ? "" : "disabled"}>Confirmar cambio</button>
        <button class="back" data-cmbcancel>${st.cancelArm ? "¿Seguro? Tocá de nuevo para cancelar el pedido" : "Prefiero cancelar el pedido"}</button></div>`;
  }
  function redibujarCambio(tr) { document.querySelectorAll(`[data-cmb="${CSS.escape(tr)}"]`).forEach((el) => (el.innerHTML = cambioInner(tr))); }
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-cmbsel],[data-cmbok],[data-cmbcancel]"); if (!t) return;
    const box = t.closest("[data-cmb]"), tr = box.dataset.cmb, st = CMB[tr]; if (!st) return;
    if (t.dataset.cmbsel) { const [ix, v] = t.dataset.cmbsel.split(":"); st.sel[+ix] = v; st.err = ""; st.cancelArm = false; redibujarCambio(tr); return; }
    const cancelar = t.dataset.cmbcancel !== undefined;
    if (cancelar && !st.cancelArm) { st.cancelArm = true; redibujarCambio(tr); return; }
    box.classList.add("cmb-busy"); t.disabled = true; t.textContent = "Enviando…";
    try {
      const r = await API.resolverCambio(tr, Object.entries(st.sel).map(([idx, v]) => (v === "quitar" ? { idx: +idx, accion: "quitar" } : { idx: +idx, accion: "cambiar", id: v })), cancelar);
      delete CMB[tr]; box.classList.remove("cmb-busy");
      toast(r.estado === "cancelado" ? "Pedido cancelado. ¡Perdón por la molestia!" : `¡Listo! Tu pedido quedó en ${money(r.total)}`);
      refrescarStock(); verSeguimiento();
    } catch (ex) { box.classList.remove("cmb-busy"); st.err = ex.message; st.data = null; st.cancelArm = false; redibujarCambio(tr); cambioHtmlReload(tr); }
  });
  function cambioHtmlReload(tr) { const st = CMB[tr]; if (!st || st.loading) return; st.loading = true; API.cambioOpciones(tr).then((d) => { st.data = d; st.loading = false; redibujarCambio(tr); }).catch(() => { st.loading = false; }); }
  function rvForm(code) {
    return `<div class="rv-form" data-rvcode="${esc(code)}"><b style="font-size:.9rem">¿Qué tal estuvo?</b>
      <div class="stars" role="radiogroup" aria-label="Puntaje">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-pressed="false" aria-label="${n} estrella${n > 1 ? "s" : ""}">★</button>`).join("")}</div>
      <textarea maxlength="400" placeholder="Contanos qué te pareció (opcional)"></textarea>
      <label class="rv-foto"><input type="file" accept="image/*" data-rvfoto hidden><span class="rv-prev">📷</span><span><b>Sumá una foto de tu pedido</b><small>Opcional · se ve con tu reseña</small></span></label>
      <label class="rv-ig"><span>@</span><input type="text" maxlength="40" placeholder="tu usuario de Instagram (opcional)" autocapitalize="off" autocomplete="off" data-rvig></label>
      <small class="muted" style="font-size:.76rem">Mostramos tu nombre, foto y usuario. Nunca tu teléfono.</small>
      <span class="rv-err" hidden></span>
      <div class="trk-acts" style="margin:0"><button class="btn solid" data-rvsend>Enviar reseña</button><button class="back" data-rvcancel>Ahora no</button></div></div>`;
  }
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-resena],[data-star],[data-rvsend],[data-rvcancel],[data-vercard]"); if (!t) return;
    if (t.dataset.vercard) {
      const tel = telDe(t.dataset.vercard); closeDrawer(); $("#cardPhone").value = API.prettyPhone ? API.prettyPhone(tel) : tel;
      $("#club").scrollIntoView({ behavior: "smooth" }); $("#cardForm").requestSubmit(); return;
    }
    if (t.dataset.resena) { const card = t.closest(".trk"); const acts = t.closest(".trk-acts"); if (!card.querySelector(".rv-form")) acts.insertAdjacentHTML("afterend", rvForm(t.dataset.resena)); acts.hidden = true; return; }
    const f = t.closest(".rv-form"); if (!f) return;
    if (t.dataset.star) { const n = +t.dataset.star; f.dataset.rating = n; f.querySelectorAll("[data-star]").forEach((s) => s.setAttribute("aria-pressed", String(+s.dataset.star <= n))); return; }
    if (t.dataset.rvcancel !== undefined) { const acts = f.previousElementSibling; f.remove(); if (acts) acts.hidden = false; return; }
    if (t.dataset.rvsend !== undefined) {
      const err = f.querySelector(".rv-err"), r = +f.dataset.rating || 0;
      if (!r) { err.hidden = false; err.textContent = "Tocá las estrellas para puntuar."; return; }
      t.disabled = true; t.textContent = "Enviando…";
      try {
        let foto = null; const file = f._foto;
        if (file) { t.textContent = "Subiendo foto…"; foto = await API.uploadReviewPhoto(await achicarFoto(file)); }
        t.textContent = "Enviando…";
        const tr = trackDe(f.dataset.rvcode), ig = f.querySelector("[data-rvig]").value, tx = f.querySelector("textarea").value;
        if (tr && API.createReviewTrack) await API.createReviewTrack(tr, r, tx, foto, ig); else await API.createReview(f.dataset.rvcode, telDe(f.dataset.rvcode), r, tx, foto, ig);
        f.outerHTML = `<p style="margin-top:10px"><b>¡Gracias!</b> La publicamos cuando la revisemos.</p>`; setTimeout(verSeguimiento, 4000);
      } catch (ex) { err.hidden = false; err.textContent = ex.message; t.disabled = false; t.textContent = "Enviar reseña"; }
    }
  });
  async function achicarFoto(file, max = 1200) {
    let src; try { src = await createImageBitmap(file); } catch (_) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("No pudimos leer esa foto")); im.src = URL.createObjectURL(file); }); }
    const k = Math.min(1, max / Math.max(src.width, src.height)), cv = document.createElement("canvas");
    cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k); cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    const as = (t, q) => new Promise((r) => cv.toBlob(r, t, q)); let b = await as("image/webp", 0.8); if (!b || b.type !== "image/webp") b = await as("image/jpeg", 0.82); return b;
  }
  document.addEventListener("change", (e) => {
    const inp = e.target.closest("[data-rvfoto]"); if (!inp || !inp.files || !inp.files[0]) return;
    const f = inp.closest(".rv-form"), file = inp.files[0];
    if (!/^image\//.test(file.type)) { const er = f.querySelector(".rv-err"); er.hidden = false; er.textContent = "Elegí una imagen."; return; }
    f._foto = file; f.querySelector(".rv-prev").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Tu foto">`; f.querySelector(".rv-foto b").textContent = "Foto lista · tocá para cambiarla";
  });
  const haceTxt = (iso) => { const d = Math.floor((Date.now() - new Date(iso)) / 864e5); return d <= 0 ? "hoy" : d === 1 ? "ayer" : d < 30 ? `hace ${d} días` : new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }); };
  const rvCard = (r) => `<article class="rv">${r.foto ? `<img class="rv-img" src="${esc(r.foto)}" alt="Foto del pedido de ${esc(r.nombre)}" loading="lazy">` : ""}
        <div class="rv-top"><span class="st" aria-label="${r.rating} de 5">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span><span class="rv-when">${haceTxt(r.fecha)}</span></div>
        ${r.texto ? `<p>${esc(r.texto)}</p>` : ""}
        <div class="rv-who"><span class="rv-av">${esc((r.nombre || "?")[0])}</span><span><b>${esc(r.nombre)}</b>${r.instagram ? `<a href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener nofollow">@${esc(r.instagram)}</a>` : ""}</span></div>
        <span class="rv-ver">✓ Compra verificada${r.pedido && r.pedido.length ? ` · pidió ${esc(r.pedido.slice(0, 3).join(", "))}` : ""}</span></article>`;
  /* ---------- /listo: la página del QR del sticker (armar + reseña + sellos) ---------- */
  const puedeResenar = (o) => !o.resena && (o.status === "entregado" || (o.status === "pendiente" && o.etapa === "listo"));
  const buscarHtml = (abierto) => `<details class="ls-buscar"${abierto ? " open" : ""}><summary>${abierto ? "Buscá tu pedido" : "¿Es otro pedido? Buscalo acá"}</summary>
      <form class="ls-form" id="lsBuscar" novalidate>
        <label class="f">Código del pedido<input name="code" placeholder="STT-1234" autocapitalize="characters" autocomplete="off" maxlength="12"></label>
        <label class="f">Tu celular<input name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="223 347-1277"></label>
        <button class="btn solid" type="submit">Buscar</button>
      </form><small class="muted">El código está en el mensaje de WhatsApp de tu pedido (empieza con STT).</small><span class="rv-err" id="lsErr" hidden></span></details>`;
  let lsTel = false;
  function renderListo() {
    const box = $("#lsResBody"); if (!box || box.querySelector(".rv-form")) return;
    const mios = MIOS.filter((o) => o.status !== "cancelado");
    const tel = (mios.find((o) => o.phone) || {}).phone;
    if (tel && !lsTel && clubOn()) { lsTel = true; $("#cardPhone").value = API.prettyPhone ? API.prettyPhone(tel) : tel; $("#cardForm").requestSubmit(); }
    if (!mios.length) {
      box.innerHTML = `<div class="trk ls-trk"><p style="margin:0 0 6px"><b>Las reseñas son de pedidos hechos desde la web.</b> Si pediste por acá, buscalo con tu código y tu celular.</p>${buscarHtml(true)}</div>
        <p class="muted ls-alt">¿Pediste por WhatsApp o por una app? Contanos qué tal en <a href="https://instagram.com/setto.project" target="_blank" rel="noopener">@setto.project</a>. La próxima, pedí desde la web y sumás sellos.</p>`;
      return;
    }
    const o = mios.find(puedeResenar) || mios[0];
    let body;
    if (puedeResenar(o)) body = `<div class="trk-acts" hidden><button class="btn solid" data-resena="${esc(o.code)}">Dejar reseña</button></div>${rvForm(o.code)}`;
    else if (o.resena) body = `<p style="margin:6px 0 0"><b>¡Gracias por tu reseña!</b> La publicamos cuando la revisemos.</p><div class="trk-acts"><button class="btn" data-verresenas>Ver reseñas</button></div>`;
    else body = `<p style="margin:6px 0 0">Tu pedido todavía está ${o.etapa === "preparando" ? "en preparación" : "en camino a estar listo"}. Cuando esté listo vas a poder dejar tu reseña acá.</p>`;
    box.innerHTML = `<div class="trk ls-trk"><div class="trk-h"><span class="eyebrow">Tu pedido</span><b class="num">${esc(o.code)}</b><span class="trk-r">${esc(o.retiro || "")}</span></div>${body}</div>${buscarHtml(false)}`;
  }
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "lsBuscar") return; e.preventDefault();
    const f = e.target, err = $("#lsErr"), code = f.code.value.trim().toUpperCase().replace(/^STT-?/, "STT-"), tel = f.tel.value;
    err.hidden = true;
    if (!/^STT-\d{4}$/.test(code)) { err.hidden = false; err.textContent = "El código es STT seguido de 4 números."; return; }
    if (!API.normPhone(tel)) { err.hidden = false; err.textContent = "Revisá el celular: código de área + número."; return; }
    const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Buscando…";
    try {
      const r = await API.orderStatus([code], tel);
      if (!r.length) throw new Error("No encontramos ese pedido. Revisá el código y el celular (vale para pedidos de los últimos 3 días).");
      guardarSeguimiento({ code, phone: API.normPhone(tel), at: Date.now() }); lsTel = false;
    } catch (ex) { err.hidden = false; err.textContent = ex.message; btn.disabled = false; btn.textContent = "Buscar"; }
  });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-verresenas]")) abrirResenas(); });

  /* ---------- todas las reseñas ---------- */
  const AR = { items: [], off: 0, fil: "todas", data: null };
  async function abrirResenas() {
    const el = $("#allRev"); el.hidden = false; document.body.style.overflow = "hidden"; $("#arList").innerHTML = '<p class="loading">Cargando…</p>';
    try { const d = await API.publicReviewsAll(0); AR.data = d; AR.items = d.items || []; AR.off = AR.items.length; dibujarAR(); } catch (e) { $("#arList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    setTimeout(() => $("#arClose").focus(), 50);
  }
  function cerrarResenas() { $("#allRev").hidden = true; document.body.style.overflow = ""; }
  function dibujarAR() {
    const d = AR.data || {}, n = d.cantidad || 0, por = d.por_estrella || {};
    $("#arSum").innerHTML = n ? `<div class="ar-sum"><div class="ar-big"><b>${String(d.promedio).replace(".", ",")}</b><span class="st">${"★".repeat(Math.round(d.promedio))}${"☆".repeat(5 - Math.round(d.promedio))}</span><small>${n} reseña${n > 1 ? "s" : ""} de compras verificadas</small></div>
      <div class="ar-bars">${[5, 4, 3, 2, 1].map((k) => `<div><span>${k}★</span><i><em style="width:${n ? Math.round(((por[k] || 0) / n) * 100) : 0}%"></em></i><span class="num">${por[k] || 0}</span></div>`).join("")}</div></div>` : '<p class="muted">Todavía no hay reseñas publicadas.</p>';
    const fotos = AR.items.filter((r) => r.foto).length;
    $("#arFil").innerHTML = [["todas", "Todas"], ["foto", `Con foto (${fotos})`], ["texto", "Con comentario"], ["5", "5★"], ["4", "4★"], ["3m", "3★ o menos"]].map(([k, l]) => `<button data-arf="${k}" aria-pressed="${AR.fil === k}">${l}</button>`).join("");
    const f = AR.fil, list = AR.items.filter((r) => f === "todas" || (f === "foto" && r.foto) || (f === "texto" && r.texto) || (f === "3m" && r.rating <= 3) || String(r.rating) === f);
    $("#arList").innerHTML = list.length ? list.map(rvCard).join("") : '<p class="muted" style="grid-column:1/-1;text-align:center">No hay reseñas con este filtro.</p>';
    $("#arMore").hidden = AR.items.length >= n;
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#verResenas")) return abrirResenas();
    if (e.target.closest("[data-navres]")) { e.preventDefault(); closeMenu(); return abrirResenas(); }
    if (e.target.closest("#arClose") || e.target.id === "allRev") return cerrarResenas();
    const f = e.target.closest("[data-arf]"); if (f) { AR.fil = f.dataset.arf; dibujarAR(); return; }
    if (e.target.closest("#arMore")) { try { const d = await API.publicReviewsAll(AR.off); AR.items = AR.items.concat(d.items || []); AR.off = AR.items.length; dibujarAR(); } catch (_) {} }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#allRev").hidden) cerrarResenas(); });

  async function renderResenas() {
    try {
      const d = await API.publicReviews(); const sec = $("#resenas");
      if (!d || !d.cantidad) { sec.hidden = true; return; }
      sec.hidden = false; $("#resGrid").hidden = !(d.items && d.items.length);
      $("#verResenas").textContent = `Ver todas las reseñas (${d.cantidad})`;
      $("#resProm").textContent = `★ ${String(d.promedio).replace(".", ",")} · ${d.cantidad} reseña${d.cantidad > 1 ? "s" : ""} verificada${d.cantidad > 1 ? "s" : ""}`;
      $("#resGrid").innerHTML = (d.items || []).map(rvCard).join("");
    } catch (_) {}
  }
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-trackx]"); if (!x) return; try { localStorage.setItem("setto-trk-ocultos", JSON.stringify([...ocultosTrk(), x.dataset.trackx].slice(-20))); } catch (_) {} verSeguimiento(); });

  /* ---------- arranque ---------- */
  function loading() {
    ["espGrid", "setsGrid", "grid"].forEach((id) => (document.getElementById(id).innerHTML = '<p class="loading">Cargando la carta…</p>'));
  }
  async function boot() {
    $("#demoBar").hidden = !API.DEMO;
    fetch("/", { method: "HEAD", cache: "no-store" }).then((r) => { const d = Date.parse(r.headers.get("date") || ""); if (d && Math.abs(d - Date.now()) > 3000) { SKEW = d - Date.now(); tickDrop(); } }).catch(() => {});
    renderBand(); loading();
    try {
      const stockP = API.getStock ? API.getStock().catch(() => null) : Promise.resolve(null);
      const { settings, products } = await API.loadAll();
      STOCK = await stockP;
      verSeguimiento(); renderResenas();
      API.productRatings && API.productRatings().then((r) => { RATINGS = r || {}; renderSets(); renderCarta(); renderEspecial(); }).catch(() => {});
      S = settings; adapt(products); syncCart();
      renderTema(); renderHero(); renderUbicacion(); renderStickers(); renderFaq(); renderAbierto(); renderGift(); renderVotar(); if (window.__regalo) abrirRegalo(window.__regalo); renderBand(); renderApps(); renderConviene(); renderEspecial(); renderSets(); renderCarta(); renderClubInfo(); renderMaquinita(); renderFooter(); renderBadge();
      if (form.tel) $("#cardPhone").value = form.tel;
      if (PAGE === "listo" && form.tel && clubOn()) setTimeout(() => { if (!lsTel) { lsTel = true; $("#cardForm").requestSubmit(); } }, 1500);
      if (lastOrder && location.hash !== "#club") { /* vuelve de WhatsApp: deja el código a mano */ view = "sent"; }
    } catch (e) {
      const bar = $("#errBar"); bar.hidden = false; bar.textContent = "No pudimos cargar la carta. Escribinos por WhatsApp.";
      ["espGrid", "setsGrid", "grid"].forEach((id) => (document.getElementById(id).innerHTML = ""));
      console.error(e);
    }
  }
  boot();
})();
