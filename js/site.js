/* Sitio público de Setto: carta, pedido a WhatsApp con código y tarjeta del Club */
(function () {
  const API = window.SettoAPI;
  const $ = (s) => document.querySelector(s);
  const money = (n) => (Number(n) < 0 ? "−$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-AR");
  const lcFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
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

  /* ---------- stock visible (sale de la caja del equipo) ---------- */
  let STOCK = null;
  const umbral = () => Math.max(1, Number((S.stock_web || {}).umbral) || 3);
  const stockDe = (p) => {
    if (!STOCK || !p) return null;
    const id = p.categoria === "set" ? p.set_mochi : p.id;
    return Object.prototype.hasOwnProperty.call(STOCK, id) ? Number(STOCK[id]) : null;
  };
  const stockBadge = (p) => { const n = stockDe(p); if (n === null || p.agotado) return ""; return n <= 0 ? '<span class="badge">Sin stock hoy</span>' : n <= umbral() ? '<span class="badge low">¡Últimos!</span>' : ""; };
  const stockLine = (p) => {
    const n = stockDe(p); if (n === null || p.agotado) return "";
    if (n <= 0) return '<p class="stk out">Sin stock por ahora · consultanos por WhatsApp</p>';
    if (p.categoria === "set") return n <= umbral() ? `<p class="stk low">Quedan ${n} para este set</p>` : "";
    return n <= umbral() ? `<p class="stk low">Quedan ${n} · ¡últimos!</p>` : `<p class="stk">${n} disponibles hoy</p>`;
  };

  /* el stock frena: no se puede pedir más de lo que hay (la base también lo controla) */
  const mochiDe = (p) => (!p ? null : p.categoria === "set" ? p.set_mochi : ["mochi", "especial"].includes(p.categoria) ? p.id : null);
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
  const unit = (p) => kind(p) === "mochi" || kind(p) === "premium";
  const priceOf = (p, sz) => (unit(p) ? p.precio : p.precios[sz]);
  const nameOf = (p) => (unit(p) ? "Mochi " + p.nombre : p.nombre);
  const espOpen = () => (S.especial || {}).estado === "disponible";
  const setParts = (s) => ({ b: DIRTY.find((x) => x.id === s.bebida), m: MOCHIS.find((x) => x.id === s.mochi) });
  const suelto = (s, sz) => { const { b, m } = setParts(s); return (b ? Number(b.precios[sz]) : 0) + (m ? Number(m.precio) : 0); };
  const descOf = (p) => { if (p.categoria !== "set") return p.desc; const { b, m } = setParts(p); return (b ? b.nombre : "Bebida") + " + mochi " + (m ? m.nombre.toLowerCase() : ""); };

  /* ---------- Setto Club: helpers ---------- */
  const club = () => S.club || {};
  const clubOn = () => club().activo !== false && (club().sellos_por_pedido ?? 1) > 0;
  const spp = () => club().sellos_por_pedido ?? 1;
  const sellosTxt = (n) => n + (n === 1 ? " sello" : " sellos");
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
    if (min > 0 && total() < min) return `<div class="clubline"><img src="img/mochito-run.png" alt=""><div>Sumá <b>${money(min - total())}</b> más y este pedido suma ${sellosTxt(spp())} del Setto Club.</div></div>`;
    const n = spp(), meta = club().meta || 8, premio = club().premio && club().premio !== "Premio a definir" ? club().premio : "tu premio";
    const c = cardCache && cardCache.tel === API.normPhone(form.tel) ? cardCache.data : null;
    let txt, pct = null;
    if (c && c.existe) {
      const after = c.sellos + n;
      pct = Math.min(100, Math.round((after / meta) * 100));
      txt = after >= meta ? (form.premio ? `<b>¡Este pedido completa tu tarjeta!</b> Tu premio: ${esc(form.premio === "descuento" ? premioDesc() + "% off en este pedido" : ((SETS.find((x) => "set:" + x.id === form.premio) || {}).nombre || "set") + " (12 oz) de regalo")}.` : `<b>¡Este pedido completa tu tarjeta!</b> Elegí tu premio: ${esc(premioTxt())}.`)
        : `Tenés <b>${c.sellos} de ${meta}</b> sellos. Con este pedido llegás a <b>${after}</b>.`;
    } else {
      txt = `Este pedido suma <b>${sellosTxt(n)}</b> del Setto Club. El pedido que completa los ${meta} sellos viene con ${esc(premioTxt())}.`;
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
  const persOn = (p) => ["set", "dirty"].includes(kind(p)) && (leches().length > 0 || sinOpts().length > 0);
  const lechePrecio = (n) => { const l = leches().find((x) => x.nombre === n); return l ? Number(l.precio) || 0 : 0; };
  const detalleOf = (leche, sin) => [leche && (lechePrecio(leche) > 0 || leche !== (leches()[0] || {}).nombre) ? leche : "", ...(sin || [])].filter(Boolean).join(" · ");
  function syncCart() { // si cambió la carta, actualiza precios y saca lo que ya no existe
    cart = cart.filter((c) => {
      const p = find(c.id); if (!p || p.activo === false) return false; const pr = priceOf(p, c.size); if (!(pr > 0)) return false;
      if (persOn(p)) {
        if (c.leche && !leches().some((l) => l.nombre === c.leche)) c.leche = (leches()[0] || {}).nombre || "";
        c.sin = (c.sin || []).filter((x) => sinOpts().includes(x));
      } else { c.leche = ""; c.sin = []; }
      c.precio = pr + lechePrecio(c.leche); c.detalle = detalleOf(c.leche, c.sin); c.nombre = nameOf(p); return true;
    });
    save();
  }
  function addItem(p, sz, qty = 1, leche = "", sin = []) {
    const fr = frenoStock(p, qty); if (fr) { toast(fr); return false; }
    if (!persOn(p)) { leche = ""; sin = []; }
    const key = p.id + "|" + (sz || "") + "|" + leche + "|" + sin.join(",");
    const ex = cart.find((c) => c.key === key);
    if (ex) ex.qty += qty;
    else cart.push({ key, id: p.id, nombre: nameOf(p), size: sz || "", leche, sin: [...sin], detalle: detalleOf(leche, sin), precio: priceOf(p, sz) + lechePrecio(leche), img: p.img || "img/mochito-lie.png", qty });
    save(); renderBadge(); toast("Sumado: " + nameOf(p) + (sz ? " · " + sz : ""));
    return true;
  }
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2000); }

  /* ---------- render ---------- */
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
    el.innerHTML = `<h3>${esc(v.titulo || "Pedir acá te conviene")}</h3><div class="cv-grid">${items.map((x, i) => `<div class="cv"><i>${i + 1}</i><b>${esc(x.titulo)}</b>${x.detalle ? `<span>${esc(x.detalle)}</span>` : ""}</div>`).join("")}</div>`;
  }
  function renderEspecial() {
    const E = S.especial || {}, items = on(ESP), open = espOpen();
    $("#espChip").textContent = E.chip || (open ? "Disponible ahora" : "Próxima edición");
    $("#espIntro").textContent = E.intro || "";
    $("#espGrid").innerHTML = items.map((p) => {
      const foto = !!p.img, canBuy = open && !p.agotado && !sinStock(p) && Number(p.precio) > 0;
      const pic = foto ? `<img src="${esc(p.img)}" alt="Mochi ${esc(p.nombre)}" loading="lazy">` : `<span class="pend"><img src="img/mochito-lie.png" alt="">Foto en camino</span>`;
      const tag = p.agotado ? '<span class="badge">Agotado</span>' : !open ? '<span class="badge">Próximamente</span>' : stockBadge(p);
      return `<article class="prem ${p.agotado ? "agotado" : ""}">
        <button class="ph ${foto ? "foto" : ""}" data-open="${p.id}" aria-label="Ver ${esc(p.nombre)}">${tag}${pic}</button>
        <h3>${esc(p.nombre)}</h3><p class="desc">${esc(p.desc)}</p>${open ? stockLine(p) : ""}
        <div class="row">${Number(p.precio) > 0 ? `<span class="price num">${money(p.precio)}</span>` : `<span class="muted" style="font-size:.85rem">Precio a confirmar</span>`}
        ${canBuy ? `<button class="add" data-quick="${p.id}" aria-label="Sumar ${esc(nameOf(p))}">+</button>` : ""}</div>
      </article>`;
    }).join("");
    $("#espSoon").innerHTML = open ? "" : `<div class="prem-soon"><img src="img/mochito-run.png" alt=""><div><b>Todavía no salió la próxima edición</b><p>Seguinos en Instagram <strong>@${esc(S.instagram || "setto.project")}</strong> para enterarte el día que sale.</p></div></div>`;
    $("#especial").hidden = items.length === 0;
    dots("espGrid");
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
        <div class="foot"><span class="from num">Desde<b>${money(ahora)}${ahorro > 0 ? `<s>${money(antes)}</s>` : ""}</b></span>
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
      const precio = tab === "dirty" ? `<span class="from num">Desde<b>${money(p.precios["12 oz"])}</b></span>` : `<span class="from num">Unidad<b>${money(p.precio)}</b></span>`;
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
    $("#heroClub").hidden = !clubOn();
    $("#heroClub span").innerHTML = `Cada pedido desde la web suma ${sellosTxt(spp())} del <b>Setto Club</b>`;
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
  function renderFooter() {
    const r = S.retiro || { rangos: [] };
    HORARIO = "De " + r.rangos.map(([a, b]) => a.replace(":00", "") + " a " + b.replace(":00", "")).join(" y de ") + " hs.";
    $("#footHours").textContent = "Retiro: " + HORARIO.charAt(0).toLowerCase() + HORARIO.slice(1);
    $("#waNum").textContent = S.whatsapp_visible || API.prettyPhone(S.whatsapp);
    $("#mnavWa").textContent = S.whatsapp_visible || API.prettyPhone(S.whatsapp);
    $("#navWa").href = `https://wa.me/${S.whatsapp}?text=${encodeURIComponent("¡Hola Setto! Tengo una consulta.")}`;
  }
  function renderBadge() {
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
    sheetState = { p, sz: unit(p) ? "" : "12 oz", qty: 1, leche: persOn(p) ? (leches()[0] || {}).nombre || "" : "", sin: [] };
    drawSheet();
    $("#sheet").classList.add("on"); $("#scrim").classList.add("on"); renderBadge();
    setTimeout(() => $("#sheet .x").focus(), 60);
  }
  function drawSheet() {
    const { p, sz, qty, leche, sin } = sheetState, k = kind(p);
    const custom = persOn(p) ? `${leches().length ? `<div><span class="eyebrow">Leche${k === "set" ? " de la bebida" : ""}</span><div class="chips lechas" style="margin-top:8px">${leches().map((l) => `<button data-leche="${esc(l.nombre)}" aria-pressed="${l.nombre === leche}">${esc(l.nombre)}${Number(l.precio) > 0 ? ` <span class="num">+${money(l.precio)}</span>` : ""}</button>`).join("")}</div></div>` : ""}
      ${sinOpts().length ? `<div><span class="eyebrow">¿Algo para sacar?</span><div class="chips" style="margin-top:8px">${sinOpts().map((x) => `<button data-sin="${esc(x)}" aria-pressed="${sin.includes(x)}">${esc(x)}</button>`).join("")}</div></div>` : ""}` : "";
    const opts = unit(p) ? "" : `<div><span class="eyebrow">Tamaño</span><div class="opts" style="margin-top:8px">${["12 oz", "16 oz"].map((oz) => {
      const sv = k === "set" ? suelto(p, oz) : 0, pv = p.precios[oz];
      const pr = k === "set" && sv > pv ? `<s>${money(sv)}</s>${money(pv)} <em class="pct">−${Math.round(((sv - pv) / sv) * 100)}%</em>` : money(pv);
      return `<button class="opt" data-sz="${oz}" aria-pressed="${oz === sz}"><span class="rd"></span><b>${oz.toUpperCase()}</b><span class="pp num">${pr}</span></button>`;
    }).join("")}</div></div>`;
    const sinSt = sinStock(p) && !(k === "premium" && !espOpen());
    const blocked = p.agotado || sinSt || (k === "premium" && (!espOpen() || !(Number(p.precio) > 0)));
    $("#sheet").innerHTML = `<div class="sph"><img src="${esc(p.img || "img/mochito-lie.png")}" alt=""><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div class="sb">
        ${k === "premium" ? `<span class="eyebrow">Edición especial${espOpen() ? "" : " · próximamente"}</span>` : k === "set" ? `<span class="eyebrow">${esc(p.codigo || "")}${p.tema ? " ✦ " + esc(p.tema) : ""}</span>` : p.rotativo ? '<span class="eyebrow">Rotativo · consultá disponibilidad</span>' : ""}
        <h3 id="sTitle">${esc(nameOf(p))}</h3>
        <p class="muted">${esc(descOf(p))}</p>
        ${k === "premium" && !espOpen() ? "" : stockLine(p)}
        ${opts}
        ${custom}
        ${clubOn() && !blocked ? `<span class="clubtag">Tu pedido suma ${sellosTxt(spp())} del Setto Club</span>` : ""}
        <div class="act"><div class="qty" style="margin:0"><button data-sq="-1" aria-label="Restar uno">−</button><span class="num" style="min-width:18px;text-align:center">${qty}</span><button data-sq="1" aria-label="Sumar uno">+</button></div>
        ${blocked ? `<span class="btn big" style="flex:1;opacity:.7;box-shadow:none;background:var(--bg-2);color:var(--ink);cursor:default">${p.agotado ? "Agotado" : sinSt ? "Sin stock hoy" : "Todavía no disponible"}</span>` : `<button class="btn solid big" id="sheetAdd">Agregar · <span class="num">${money((priceOf(p, sz) + lechePrecio(leche)) * qty)}</span></button>`}</div>
      </div>`;
  }
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
    return `¡Hola Setto! Te paso mi pedido ${o.code} ${envio ? "con envío a domicilio" : "para retirar"}:\n\n${lines.join("\n")}\n\nTotal: ${money(o.total)}${premio}\n\nNombre: ${o.nombre}\n${entrega}\nPago: ${o.pago}` + (o.nota ? `\nNota: ${o.nota}` : "");
  }
  const envioOn = () => !!(S.envio && S.envio.activo);
  const envioCosto = () => (envioOn() && form.modo === "envio" ? Math.max(0, Number(S.envio.costo) || 0) : 0);
  const fullDir = () => [form.dir.trim(), form.dirExtra.trim()].filter(Boolean).join(" · ");
  const waLink = (msg) => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(msg)}`;

  function openDrawer() {
    view = lastOrder && view === "sent" ? "sent" : "cart"; $("#drawer").classList.add("on"); $("#scrim").classList.add("on"); drawDrawer(); renderBadge(); setTimeout(() => $("#dClose").focus(), 50);
    closeMenu();
    if (API.normPhone(form.tel) && !(cardCache && cardCache.tel === API.normPhone(form.tel))) loadCard().then(() => { if (view === "cart" && $("#drawer").classList.contains("on")) drawDrawer(); });
  }
  function closeDrawer() { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); if (view === "sent") { view = "cart"; } renderBadge(); }
  function drawDrawer() {
    const body = $("#dBody"), foot = $("#dFoot");
    $("#dBack").hidden = view !== "checkout";
    if (view === "cart") {
      $("#dTitle").textContent = "Tu pedido";
      if (!cart.length) { body.innerHTML = `${trackHtml()}<div class="empty"><img src="img/mochito-cup.png" alt=""><b>Todavía no sumaste nada</b><p class="muted" style="font-size:.9rem">Arrancá por un set: bebida + mochi.</p><a class="btn" href="#sets" data-closedrawer>Ver sets</a></div>`; foot.innerHTML = ""; return; }
      body.innerHTML = trackHtml() + cart.map((c, i) => `<div class="line"><span class="th"><img src="${esc(c.img)}" alt=""></span><div><b>${esc(c.nombre)}</b>${c.detalle ? `<small class="det">${esc(c.detalle)}</small>` : ""}<small>${c.size ? c.size.toUpperCase() + " · " : ""}${money(c.precio)} c/u</small>
        <div class="qty"><button data-q="${i}" data-d="-1" aria-label="Restar uno">−</button><span class="num">${c.qty}</span><button data-q="${i}" data-d="1" aria-label="Sumar uno">+</button></div></div>
        <span class="lp num">${money(c.precio * c.qty)}</span></div>`).join("");
      foot.innerHTML = `${clubLine()}<div class="tot"><span>Total</span><span class="num">${money(total())}</span></div><button class="btn solid big" id="toCheckout">Continuar</button>
        <p class="muted" style="font-size:.78rem;text-align:center">${envioOn() ? "Retiro o envío a domicilio: lo elegís en el próximo paso." : "¿Querés delivery? Pedí por PedidosYa, Rappi o Uber Eats."}</p>`;
    }
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
        <div class="f"><span>Forma de pago</span><div class="chips">${pagosVer.map((p) => `<button data-pago="${esc(p)}" aria-pressed="${p === form.pago}">${esc(p)}</button>`).join("")}</div><span class="hintf">${form.modo === "envio" ? "Con envío a domicilio se paga solo por transferencia, antes de despachar el pedido." : "El pago se coordina por WhatsApp."}</span></div>
        ${premioPicker()}
        <label class="f" for="fNota">Nota (opcional)<textarea id="fNota" placeholder="Ej: tocar timbre 2">${esc(form.nota)}</textarea></label>
        <div id="fErr" class="err" hidden></div>`;
      foot.innerHTML = `${clubLine()}${envioCosto() > 0 ? `<div class="tot" style="font-weight:500;font-size:.9rem"><span>Envío</span><span class="num">${money(envioCosto())}</span></div>` : ""}${premioOff() > 0 && completes() ? `<div class="tot" style="font-weight:500;font-size:.9rem"><span>Premio ${premioDesc()}% off</span><span class="num">${money(-premioOff())}</span></div>` : ""}<div class="tot"><span>Total</span><span class="num">${money(total() + envioCosto() - (completes() ? premioOff() : 0))}</span></div><button class="btn wa big" id="toWA">${sending ? "Enviando…" : "Enviar pedido por WhatsApp"}</button>`;
      [["fNombre", "nombre"], ["fTel", "tel"], ["fHora", "hora"], ["fNota", "nota"], ["fDir", "dir"], ["fDir2", "dirExtra"]].forEach(([id, k]) => { const el = $("#" + id); if (el) el.addEventListener("input", (e) => { form[k] = e.target.value; }); });
      $("#fTel").addEventListener("change", async () => {
        if (!(await loadCard()) || view !== "checkout") return;
        if (completes() && !$(".premio-pick")) return drawDrawer(); // aparece el selector de premio
        const cl = $("#dFoot .clubline"); if (cl) cl.outerHTML = clubLine(); // sin redibujar el botón de enviar
      });
    }
    if (view === "sent" && lastOrder) {
      $("#dTitle").textContent = "Último paso";
      body.innerHTML = `<div class="ok"><img src="img/mochito-cup.png" alt=""><span class="eyebrow">Tu código de pedido</span><div class="coderow num">${esc(lastOrder.code)}</div>
        ${lastOrder.premio ? `<div class="clubline" style="width:100%;text-align:left"><img src="img/mochito-run.png" alt=""><div><b>¡Completaste tu tarjeta!</b> Tu premio: ${esc(lastOrder.premio_txt || "a confirmar")}.</div></div>` : ""}
        <p class="muted" style="font-size:.9rem">${lastOrder.modo === "envio" ? "Enviá el mensaje por WhatsApp. Te confirmamos el horario, el costo del envío y el pago." : "Enviá el mensaje por WhatsApp. El pedido queda confirmado cuando te respondemos con la dirección y el pago."}${clubOn() ? " Cuando lo recibís, sumás tu sello del Setto Club." : ""}</p></div>
        <div class="msg" id="msgText">${esc(lastOrder.message)}</div>
        <p class="muted" style="font-size:.8rem;text-align:center">Podés seguir el estado de tu pedido arriba de todo en la web.</p>`;
      foot.innerHTML = `<a class="btn wa big" href="${waLink(lastOrder.message)}" target="_blank" rel="noopener">Abrir WhatsApp</a>
        <button class="btn big" id="copyMsg">Copiar mensaje</button>
        <button class="back" id="newOrder" style="justify-self:center">Hacer otro pedido</button>`;
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
      const o = await API.createOrder({ nombre: form.nombre.trim(), phone: form.tel, items: cart.map((c) => ({ id: c.id, size: c.size || null, qty: c.qty, leche: c.leche || null, sin: c.sin || [] })), retiro: form.hora, pago: form.pago, nota: form.nota.trim(), modo: isEnv ? "envio" : "retiro", direccion: isEnv ? fullDir() : null, premio: completes() ? form.premio : null });
      const full = { ...o, nombre: form.nombre.trim(), retiro: form.hora, pago: form.pago, nota: form.nota.trim() };
      lastOrder = { code: o.code, message: buildMessage(full), modo: o.modo || "retiro", premio: !!o.premio, premio_txt: o.premio_txt };
      cardCache = null;
      guardarSeguimiento({ code: o.code, phone: o.phone || API.normPhone(form.tel), at: Date.now() });
      refrescarStock();
      try { sessionStorage.setItem("setto-last-order", JSON.stringify(lastOrder)); localStorage.setItem("setto-form", JSON.stringify({ nombre: form.nombre, tel: form.tel, dir: form.dir, dirExtra: form.dirExtra })); } catch (_) {}
      cart = []; save(); form.hora = ""; form.nota = ""; form.premio = ""; renderBadge();
      view = "sent"; sending = false; drawDrawer();
      const link = waLink(lastOrder.message);
      if (matchMedia("(pointer:coarse)").matches) location.href = link;
      else window.open(link, "_blank", "noopener");
    } catch (e) {
      sending = false;
      if (/premio/i.test(e.message || "")) { await loadCard(true); drawDrawer(); }
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
      msg.textContent = !c.existe ? "Todavía no tenés sellos con este número. Se suman cuando retirás un pedido hecho desde la web."
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
    if (b.dataset.quick) { const p = find(b.dataset.quick); if (p) addItem(p); }
    if (b.dataset.close !== undefined) closeSheet();
    if (b.dataset.sz) { sheetState.sz = b.dataset.sz; drawSheet(); }
    if (b.dataset.sq) { sheetState.qty = Math.max(1, sheetState.qty + +b.dataset.sq); drawSheet(); }
    if (b.id === "sheetAdd") { if (addItem(sheetState.p, sheetState.sz, sheetState.qty, sheetState.leche, sheetState.sin)) closeSheet(); }
    if (b.dataset.leche !== undefined && sheetState) { sheetState.leche = b.dataset.leche; drawSheet(); }
    if (b.dataset.sin !== undefined && sheetState) { const x = b.dataset.sin, s = sheetState.sin; sheetState.sin = s.includes(x) ? s.filter((y) => y !== x) : [...s, x]; drawSheet(); }
    if (b.id === "tab-dirty" || b.id === "tab-mochi") { tab = b.id.slice(4); renderCarta(); }
    if (b.dataset.goto) { tab = b.dataset.goto; renderCarta(); $(".switch").scrollIntoView({ behavior: "smooth", block: "center" }); }
    if (b.dataset.q !== undefined) { const c = cart[+b.dataset.q]; if (+b.dataset.d > 0) { const fr = frenoStock(find(c.id), 1); if (fr) { toast(fr); return; } } c.qty += +b.dataset.d; if (c.qty <= 0) cart.splice(+b.dataset.q, 1); save(); renderBadge(); drawDrawer(); }
    if (b.id === "openCart" || b.id === "mbarBtn") openDrawer();
    if (b.id === "dClose" || b.dataset.closedrawer !== undefined) closeDrawer();
    if (b.id === "dBack") { view = "cart"; drawDrawer(); }
    if (b.id === "toCheckout") { view = "checkout"; drawDrawer(); }
    if (b.dataset.pago) { form.pago = b.dataset.pago; document.querySelectorAll("[data-pago]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
    if (b.id === "toWA") sendOrder();
    if (b.dataset.premio) { form.premio = b.dataset.premio; drawDrawer(); }
    if (b.dataset.modo) { form.modo = b.dataset.modo; drawDrawer(); if (form.modo === "envio") setTimeout(() => { const d = $("#fDir"); if (d && !d.value) d.focus(); }, 30); }
    if (b.id === "copyMsg") {
      const txt = lastOrder ? lastOrder.message : "";
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#msgText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Seleccionado: copialo con tu teclado"); };
      try { navigator.clipboard.writeText(txt).then(() => toast("Mensaje copiado"), fallback); } catch (_) { fallback(); }
    }
    if (b.id === "newOrder") { refrescarStock(); lastOrder = null; try { sessionStorage.removeItem("setto-last-order"); } catch (_) {} view = "cart"; closeDrawer(); location.hash = "#sets"; }
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
  const misPedidos = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "[]").filter((x) => Date.now() - x.at < 3 * 864e5); } catch (_) { return []; } };
  function guardarSeguimiento(o) { try { const l = misPedidos().filter((x) => x.code !== o.code); l.unshift(o); localStorage.setItem(SKEY, JSON.stringify(l.slice(0, 5))); } catch (_) {} verSeguimiento(); }
  let trackT = null, trackVivos = [];
  const telDe = (code) => (misPedidos().find((x) => x.code === code) || {}).phone || "";
  const ocultosTrk = () => { try { return JSON.parse(localStorage.getItem("setto-trk-ocultos") || "[]"); } catch (_) { return []; } };
  const trackHtml = () => (trackVivos.length ? `<div class="dtrk">${trackVivos.map(trackCard).join("")}</div>` : "");
  async function verSeguimiento() {
    clearTimeout(trackT);
    const l = misPedidos(), box = $("#seguimiento"); if (!l.length) { box.hidden = true; return; }
    const byPhone = {}; l.forEach((x) => (byPhone[x.phone] = byPhone[x.phone] || []).push(x.code));
    let data = [];
    try { data = (await Promise.all(Object.entries(byPhone).map(([ph, codes]) => API.orderStatus(codes, ph)))).flat(); } catch (_) { return; }
    // pendientes; entregados sin reseña (3 días); el resto hasta 3 horas
    const ocultos = ocultosTrk();
    const vivos = data.filter((o) => !ocultos.includes(o.code) && (o.status === "pendiente" || (o.status === "entregado" && !o.resena) || Date.now() - new Date(o.created_at) < 3 * 36e5)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    trackVivos = vivos;
    if (view === "cart" && $("#drawer").classList.contains("on")) drawDrawer();
    if (!vivos.length) { box.hidden = true; return; }
    if (box.querySelector(".rv-form")) return; // no pisar una reseña a medio escribir
    box.hidden = false; box.innerHTML = `<div class="wrap">${vivos.map(trackCard).join("")}</div>`;
    if (vivos.some((o) => o.status === "pendiente")) trackT = setTimeout(verSeguimiento, 30000);
  }
  function trackCard(o) {
    const env = o.modo === "envio";
    const pasos = ["Recibido", "En preparación", env ? "En camino" : "Listo para retirar", "Entregado"];
    const idx = o.status === "entregado" ? 3 : o.etapa === "listo" ? 2 : o.etapa === "preparando" ? 1 : 0;
    const txt = o.status === "cancelado" ? "Este pedido se canceló. Si tenés dudas, escribinos por WhatsApp."
      : o.status === "entregado" ? `¡Entregado! Que lo disfrutes.${o.sellos > 0 ? ` Sumaste ${sellosTxt(o.sellos)} al Setto Club.` : ""}`
      : idx === 2 ? (env ? "Tu pedido salió y va en camino." : "¡Está listo! Ya podés pasar a buscarlo.")
      : idx === 1 ? "Lo estamos preparando."
      : "Lo recibimos. Si todavía no mandaste el WhatsApp, mandalo así lo confirmamos.";
    return `<div class="trk ${o.status}"><div class="trk-h"><span class="eyebrow">Tu pedido</span><b class="num">${esc(o.code)}</b><span class="trk-r">${esc(o.retiro || "")}</span>${o.status !== "pendiente" ? `<button class="trk-x" data-trackx="${esc(o.code)}" aria-label="Ocultar">✕</button>` : ""}</div>
      ${o.status === "cancelado" ? "" : `<ol class="trk-steps">${pasos.map((p, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}"><i></i><span>${p}</span></li>`).join("")}</ol>`}
      <p>${txt}</p>
      ${o.status === "entregado" ? `<div class="trk-acts">${clubOn() ? `<button class="btn" data-vercard="${esc(o.code)}">Ver mis sellos</button>` : ""}${o.resena ? `<span class="muted" style="font-size:.84rem;align-self:center">¡Gracias por tu reseña!</span>` : `<button class="btn solid" data-resena="${esc(o.code)}">Dejar reseña</button>`}</div>` : ""}</div>`;
  }
  function rvForm(code) {
    return `<div class="rv-form" data-rvcode="${esc(code)}"><b style="font-size:.9rem">¿Qué tal estuvo?</b>
      <div class="stars" role="radiogroup" aria-label="Puntaje">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-pressed="false" aria-label="${n} estrella${n > 1 ? "s" : ""}">★</button>`).join("")}</div>
      <textarea maxlength="400" placeholder="Contanos qué pediste y qué te pareció (opcional)"></textarea>
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
      try { await API.createReview(f.dataset.rvcode, telDe(f.dataset.rvcode), r, f.querySelector("textarea").value);
        f.outerHTML = `<p style="margin-top:10px"><b>¡Gracias!</b> La publicamos cuando la revisemos.</p>`; setTimeout(verSeguimiento, 4000);
      } catch (ex) { err.hidden = false; err.textContent = ex.message; t.disabled = false; t.textContent = "Enviar reseña"; }
    }
  });
  async function renderResenas() {
    try {
      const d = await API.publicReviews(); const sec = $("#resenas");
      if (!d || !d.items || !d.items.length) { sec.hidden = true; return; }
      sec.hidden = false;
      $("#resProm").textContent = d.cantidad >= 3 ? `★ ${String(d.promedio).replace(".", ",")} · ${d.cantidad} reseñas` : "Reseñas reales";
      $("#resGrid").innerHTML = d.items.map((r) => `<article class="rv"><span class="st" aria-label="${r.rating} de 5">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span><p>${esc(r.texto)}</p><b>${esc(r.nombre)}</b></article>`).join("");
    } catch (_) {}
  }
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-trackx]"); if (!x) return; try { localStorage.setItem("setto-trk-ocultos", JSON.stringify([...ocultosTrk(), x.dataset.trackx].slice(-20))); } catch (_) {} verSeguimiento(); });

  /* ---------- arranque ---------- */
  function loading() {
    ["espGrid", "setsGrid", "grid"].forEach((id) => (document.getElementById(id).innerHTML = '<p class="loading">Cargando la carta…</p>'));
  }
  async function boot() {
    $("#demoBar").hidden = !API.DEMO;
    renderBand(); loading();
    try {
      const stockP = API.getStock ? API.getStock().catch(() => null) : Promise.resolve(null);
      const { settings, products } = await API.loadAll();
      STOCK = await stockP;
      verSeguimiento(); renderResenas();
      S = settings; adapt(products); syncCart();
      renderBand(); renderApps(); renderConviene(); renderEspecial(); renderSets(); renderCarta(); renderClubInfo(); renderFooter(); renderBadge();
      if (form.tel) $("#cardPhone").value = form.tel;
      if (lastOrder && location.hash !== "#club") { /* vuelve de WhatsApp: deja el código a mano */ view = "sent"; }
    } catch (e) {
      const bar = $("#errBar"); bar.hidden = false; bar.textContent = "No pudimos cargar la carta. Escribinos por WhatsApp mientras lo resolvemos.";
      ["espGrid", "setsGrid", "grid"].forEach((id) => (document.getElementById(id).innerHTML = ""));
      console.error(e);
    }
  }
  boot();
})();
