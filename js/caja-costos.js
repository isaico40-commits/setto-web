/*
  Caja · Costos de producción (materia prima + packaging).
  Lee insumos, precios y recetas (migración 070) y calcula todo acá, así al editar
  una cantidad el costo cambia en el momento. Se guarda con las funciones costo_*.
  - Precio de un insumo = el último cargado (precio del paquete / lo que trae).
  - Costo por unidad de una receta = suma de ingredientes / (rinde × (1 − merma)).
  - Sets: bebida + mochi de la carta (no tienen receta propia).
*/
window.CajaCostos = function (K) {
  const { sb, $, esc, fail, toast, openSheet, closeSheet, needMe } = K;
  const UN = { g: "g", ml: "ml", u: "u" };
  const UNL = { g: "Gramos (g)", ml: "Mililitros (ml / cc)", u: "Unidades" };
  const PARTES = ["Masa", "Relleno", "Bebida", "Foam", "Packaging", "Otros"];
  const VIEJO = 30; // días: un precio más viejo se muestra en gris
  const C = { an: { g: "todos", t: "12 oz", si: null, sf: 0.2 }, ok: false, loading: null, err: "", tab: "productos", filtro: "todos", qi: "", fi: "todos", ins: [], pre: {}, rec: [], lin: [], prods: [], lug: [] };
  {
    const t = (location.hash.split("/")[1] || "");
    if (["productos", "preps", "insumos", "graficos"].includes(t)) C.tab = t;
  }

  /* ---------- formatos ---------- */
  const pesos = (n, dec) => "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtC = (n) => (n == null || isNaN(n) ? "—" : Math.abs(n) >= 100 ? pesos(Math.round(n), 0) : pesos(n, 2));
  const fmtQ = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  /* en los campos: sin separador de miles, con coma decimal (1500 · 2,5) */
  const fmtIn = (n) => String(Math.round(Number(n) * 1000) / 1000).replace(".", ",");
  const num = (s) => {
    let t = String(s ?? "").trim().replace(/\s/g, ""); if (!t) return NaN;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    return parseFloat(t);
  };
  const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
  const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const dias = (d) => Math.round((new Date(hoyISO() + "T12:00:00") - new Date(d + "T12:00:00")) / 864e5);
  const fechaC = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", ""); };
  const porTxt = (pu, u) => (pu == null ? "" : u === "u" ? `${fmtC(pu)} c/u` : `${fmtC(pu * 1000)} el ${u === "g" ? "kg" : "litro"}`);
  const trae = (q, u) => (u === "u" ? `${fmtQ(q)} u` : u === "g" ? (q >= 1000 ? `${fmtQ(q / 1000)} kg` : `${fmtQ(q)} g`) : q >= 1000 ? `${fmtQ(q / 1000)} l` : `${fmtQ(q)} ml`);
  const tono = (m) => (m == null ? "na" : m >= 0.65 ? "ok" : m >= 0.5 ? "mid" : "low");
  const ICO = {
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
  };

  /* ---------- datos ---------- */
  const NUEVO = "__nuevo";
  function lugOpts(sel) {
    const ls = C.lug || [], tiene = sel && ls.some((l) => l.toLowerCase() === String(sel).toLowerCase());
    return `<option value="">Elegí…</option>${ls.map((l) => `<option${tiene && l.toLowerCase() === String(sel).toLowerCase() ? " selected" : ""}>${esc(l)}</option>`).join("")}<option value="${NUEVO}">+ Lugar nuevo…</option>`;
  }
  async function load() {
    const r = await Promise.all([
      sb.from("costo_insumos").select("*").order("orden"),
      sb.from("costo_precio_actual").select("*"),
      sb.from("costo_recetas").select("*").eq("activo", true).order("orden"),
      sb.from("costo_receta_lineas").select("*").order("orden"),
      sb.from("products").select("id,categoria,nombre,formato,img,precio,precio_12,precio_16,set_bebida,set_mochi,activo,orden").order("orden"),
      sb.from("costo_lugares").select("nombre").eq("activo", true).order("nombre"),
    ]);
    const [ins, pre, rec, lin, prods, lug] = r.map(fail);
    C.lug = lug.map((l) => l.nombre);
    C.ins = ins; C.pre = {}; pre.forEach((p) => (C.pre[p.insumo_id] = p));
    C.rec = rec; C.lin = lin; C.prods = prods; C.ok = true; C.err = "";
  }
  async function reload() { await load(); memo = {}; }
  const insPor = (id) => C.ins.find((i) => i.id === id);
  const recPor = (id) => C.rec.find((r) => r.id === id);
  const prodPor = (id) => C.prods.find((p) => p.id === id);
  const lineasDe = (rid) => C.lin.filter((l) => l.receta_id === rid).sort((a, b) => a.orden - b.orden);
  const recDe = (pid, tam) => C.rec.find((r) => r.tipo === "producto" && r.product_id === pid && (r.tamano || null) === (tam || null));
  let SIM = { id: null, f: 0 }; // simulación "¿y si sube?": multiplica el precio de un insumo
  const precioU = (iid) => { const p = C.pre[iid]; if (!p) return null; const v = Number(p.precio) / Number(p.paquete); return SIM.id === iid ? v * (1 + SIM.f) : v; };
  const unidadL = (l) => (l.insumo_id ? (insPor(l.insumo_id) || {}).unidad : (recPor(l.sub_id) || {}).rinde_unidad) || "u";
  const nombreL = (l) => (l.insumo_id ? (insPor(l.insumo_id) || {}).nombre : (recPor(l.sub_id) || {}).nombre) || "(borrado)";

  /* ---------- cálculo ---------- */
  let memo = {};
  function recUnit(id, stack) {
    if (memo[id]) return memo[id];
    const r = recPor(id);
    if (!r) return { unit: null, total: 0, faltan: new Set(["una preparación borrada"]), costs: [], partes: {} };
    if (stack.includes(id)) return { unit: 0, total: 0, faltan: new Set(), costs: [], partes: {} };
    const res = calcLineas(lineasDe(id), r.rinde, r.merma, [...stack, id]);
    memo[id] = res;
    return res;
  }
  function calcLineas(lineas, rinde, merma, stack = []) {
    let total = 0; const faltan = new Set(), costs = [], partes = {};
    lineas.forEach((l) => {
      let c = null; const q = Number(l.cantidad) || 0;
      if (l.insumo_id) { const pu = precioU(l.insumo_id); if (pu == null) faltan.add(nombreL(l)); else c = q * pu; }
      else if (l.sub_id) { const s = recUnit(l.sub_id, stack); s.faltan.forEach((f) => faltan.add(f)); if (s.unit != null) c = q * s.unit; }
      costs.push(c);
      if (c != null) { total += c; const k = l.parte || "Otros"; partes[k] = (partes[k] || 0) + c; }
    });
    const ef = Number(rinde) * (1 - (Number(merma) || 0) / 100);
    return { total, unit: ef > 0 ? total / ef : null, faltan, costs, partes };
  }
  const esSet = (p) => p.categoria === "set" || (p.categoria === "especial" && p.formato === "set");
  const esBebida = (p) => p.categoria === "dirty" || (p.categoria === "especial" && p.formato === "dirty");
  const grupo = (p) => (esSet(p) ? "sets" : esBebida(p) ? "bebidas" : "mochis");
  const tamanos = (p) => (esSet(p) || esBebida(p) ? ["12 oz", "16 oz"] : [null]);
  const precioDe = (p, tam) => Number(tam ? p["precio_" + tam.slice(0, 2)] : p.precio) || 0;
  /* costo de un producto de la carta en un tamaño */
  function costoProd(p, tam) {
    if (esSet(p)) {
      const b = p.set_bebida && prodPor(p.set_bebida), m = p.set_mochi && prodPor(p.set_mochi);
      const cb = b ? costoProd(b, tam) : null, cm = m ? costoProd(m, null) : null;
      const sinReceta = [...(cb ? cb.sinReceta : ["la bebida"]), ...(cm ? cm.sinReceta : ["el mochi"])];
      const faltan = new Set([...(cb ? cb.faltan : []), ...(cm ? cm.faltan : [])]);
      const cost = (cb && cb.cost != null ? cb.cost : 0) + (cm && cm.cost != null ? cm.cost : 0);
      return { cost: (cb && cb.cost != null) || (cm && cm.cost != null) ? cost : null, faltan, sinReceta, partes: { Bebida: cb ? cb.cost : null, Mochi: cm ? cm.cost : null }, b, m, cb, cm };
    }
    const r = recDe(p.id, tam);
    if (!r) return { cost: null, faltan: new Set(), sinReceta: [p.nombre + (tam ? " " + tam : "")], receta: null };
    const c = recUnit(r.id, []);
    return { cost: c.faltan.size && !c.total ? null : c.unit, faltan: c.faltan, sinReceta: [], receta: r, partes: c.partes, rinde: Number(r.rinde) * (1 - (Number(r.merma) || 0) / 100) };
  }
  function filasProductos() {
    return C.prods.filter((p) => p.activo && ["mochi", "dirty", "especial", "set"].includes(p.categoria)).map((p) => ({
      p, g: grupo(p),
      sizes: tamanos(p).map((t) => { const c = costoProd(p, t), pr = precioDe(p, t), ok = !c.sinReceta.length && !c.faltan.size && c.cost != null;
        return { t, c, pr, m: pr > 0 && c.cost != null ? (pr - c.cost) / pr : null, ok }; }),
    }));
  }

  /* ---------- vista ---------- */
  function view() {
    const el = $("#view"); if (!el) return;
    if (!C.ok) {
      el.innerHTML = `<button class="back" data-go="inicio">‹ Inicio</button><h1 class="h1">Costos</h1>${C.err ? `<p class="note">${esc(C.err)}</p>` : `<div class="loading">Cargando costos…</div>`}`;
      if (!C.loading && !C.err) C.loading = load().then(() => { memo = {}; }).catch((e) => { C.err = /costo_/.test(e.message) || /does not exist|schema cache/.test(e.message) ? "Falta instalar los costos en la base: corré supabase/migrations/070_costos.sql en el SQL Editor de Supabase." : e.message; }).finally(() => { C.loading = null; if (K.view() === "costos") view(); });
      return;
    }
    memo = {};
    const tab = (k, l) => `<button type="button" data-kt="${k}" aria-pressed="${C.tab === k}">${l}</button>`;
    el.innerHTML = `<button class="back" data-go="inicio">‹ Inicio</button>
      <h1 class="h1">Costos</h1>
      <p class="muted kintro">Cuánto cuesta hacer cada producto en materia prima y packaging, y cuánto queda del precio de la carta.</p>
      <div class="seg ktabs">${tab("productos", "Productos")}${tab("preps", "Preparaciones")}${tab("insumos", "Insumos")}${tab("graficos", "Gráficos")}</div>
      <div id="kbody"></div>`;
    ({ productos: vProductos, preps: vPreps, insumos: vInsumos, graficos: vGraficos }[C.tab] || vProductos)();
  }
  function setTab(t) { C.tab = t; history.replaceState(null, "", "#costos" + (t === "productos" ? "" : "/" + t)); view(); window.scrollTo(0, 0); }

  function vProductos() {
    const filas = filasProductos();
    const ver = C.filtro === "todos" ? filas : filas.filter((f) => f.g === C.filtro);
    const tods = filas.flatMap((f) => f.sizes), ok = tods.filter((s) => s.ok && s.m != null);
    const prom = ok.length ? ok.reduce((a, s) => a + s.m, 0) / ok.length : null;
    const sinPrecio = C.ins.filter((i) => i.activo && !C.pre[i.id] && usado(i.id)).length;
    const conRec = filas.filter((f) => f.sizes.every((s) => !s.c.sinReceta.length)).length;
    const chip = (k, l) => `<button class="chip" data-kf="${k}" aria-pressed="${C.filtro === k}">${l}</button>`;
    $("#kbody").innerHTML = `
      <div class="kpis kk">
        <div class="kpi"><div class="k">Margen promedio</div><div class="v num">${ok.length ? pct(prom) : "—"}</div></div>
        <div class="kpi"><div class="k">Con receta</div><div class="v num">${conRec} de ${filas.length}</div></div>
        <button class="kpi ${sinPrecio ? "warn" : "res"}" data-kt="insumos"><div class="k">Sin precio</div><div class="v num">${sinPrecio ? sinPrecio + " insumo" + (sinPrecio > 1 ? "s" : "") : "Ninguno"}</div></button>
      </div>
      ${sinPrecio ? `<p class="note kfalta">Faltan precios: los costos de abajo están incompletos. <button class="linkbtn" data-kt="insumos">Cargar precios ›</button></p>` : ""}
      <div class="filters" style="margin-top:14px">${chip("todos", "Todos")}${chip("mochis", "Mochis")}${chip("bebidas", "Bebidas")}${chip("sets", "Sets")}</div>
      <div class="kprods">${ver.map(cardProd).join("") || `<div class="emptyc"><span>No hay productos en la carta.</span></div>`}</div>
      <p class="kpinote kleyenda"><span class="kdot kd-ok"></span>65% o más <span class="kdot kd-mid"></span>50 a 65% <span class="kdot kd-low"></span>menos de 50%. Margen = (precio − costo) / precio. Solo materia prima y packaging: no incluye mano de obra, alquiler ni comisiones.</p>`;
  }
  function cardProd(f) {
    const { p } = f;
    const pill = (s) => {
      if (s.c.sinReceta.length && !esSet(p)) return `<span class="kpill kt-na">Sin receta</span>`;
      if (s.c.cost == null) return `<span class="kpill kt-na">${s.c.sinReceta.length ? "Sin receta" : "Sin precios"}</span>`;
      return `<span class="kpill kt-${s.ok ? tono(s.m) : "na"}">${s.ok ? pct(s.m) : "incompleto"}</span>`;
    };
    const fila = (s) => `<span class="ksz">${s.t ? `<b>${esc(s.t)}</b>` : ""}<span class="kc"><small>Costo</small>${s.c.cost == null ? "—" : (s.ok ? "" : "~") + fmtC(s.c.cost)}</span><span class="kc"><small>Precio</small>${s.pr ? fmtC(s.pr) : "—"}</span>${pill(s)}</span>`;
    return `<button class="kprod" data-kp="${esc(p.id)}">
      ${p.img ? `<img class="kth" src="${esc(p.img)}" alt="" loading="lazy">` : `<span class="kth ph">${esc(p.nombre[0])}</span>`}
      <span class="kpb"><span class="kpn"><b>${esc(p.nombre)}</b><small>${{ mochis: p.categoria === "especial" ? "Especial" : "Mochi", bebidas: p.categoria === "especial" ? "Especial" : "Bebida", sets: "Set · bebida + mochi" }[f.g]}</small></span>
      ${f.sizes.map(fila).join("")}</span><span class="kgo">›</span></button>`;
  }

  /* ---------- gráficos ---------- */
  // cuánto pone cada insumo en 1 unidad de una receta (entra en las preparaciones)
  function aporte(rid, mult, acc, stack = []) {
    const r = recPor(rid); if (!r || stack.includes(rid)) return;
    const ef = Number(r.rinde) * (1 - (Number(r.merma) || 0) / 100); if (!(ef > 0)) return;
    lineasDe(rid).forEach((l) => {
      const q = ((Number(l.cantidad) || 0) * mult) / ef;
      if (l.insumo_id) { const pu = precioU(l.insumo_id); if (pu != null) acc[l.insumo_id] = (acc[l.insumo_id] || 0) + q * pu; }
      else if (l.sub_id) aporte(l.sub_id, q, acc, [...stack, rid]);
    });
  }
  const etiq = (p, t) => p.nombre + (t ? " " + t.replace(" oz", "") : "");
  function vGraficos() {
    const A = C.an, filas = filasProductos();
    // 1) costo y lo que queda, por producto
    const items = filas.filter((f) => A.g === "todos" || f.g === A.g).flatMap((f) => f.sizes.filter((s) => !s.t || s.t === A.t).map((s) => ({ f, s })))
      .filter(({ s }) => s.ok && s.pr > 0).sort((a, b) => b.s.m - a.s.m);
    const fuera = filas.filter((f) => A.g === "todos" || f.g === A.g).flatMap((f) => f.sizes.filter((s) => !s.t || s.t === A.t)).filter((s) => !(s.ok && s.pr > 0)).length;
    const maxP = Math.max(1, ...items.map(({ s }) => s.pr));
    const conTam = A.g !== "mochis";
    const chip = (k, l) => `<button class="chip" data-kag="${k}" aria-pressed="${A.g === k}">${l}</button>`;
    const barra = ({ f, s }) => `<div class="kbar" title="${esc(etiq(f.p, s.t))}: costo ${fmtC(s.c.cost)}, precio ${fmtC(s.pr)}, te quedan ${fmtC(s.pr - s.c.cost)} (${pct(s.m)})">
        <span class="kbn">${esc(f.p.nombre)}${s.t ? ` <small>${esc(s.t)}</small>` : ""}</span>
        <span class="kbt"><span class="kbw" style="width:${(s.pr / maxP) * 100}%"><i class="kbc" style="width:${(s.c.cost / s.pr) * 100}%"></i><i class="kbg kg-${tono(s.m)}"></i></span></span>
        <span class="kbv"><b class="num">${pct(s.m)}</b><small class="num">${fmtC(s.pr - s.c.cost)}</small></span></div>`;
    // 2) qué insumos pesan más (1 unidad de cada producto de la carta)
    const acc = {}, enProd = {};
    filas.filter((f) => f.g !== "sets").forEach((f) => f.sizes.forEach((s) => { if (!s.c.receta) return; const a = {}; aporte(s.c.receta.id, 1, a); Object.keys(a).forEach((k) => { acc[k] = (acc[k] || 0) + a[k]; (enProd[k] = enProd[k] || new Set()).add(f.p.id); }); }));
    const tot = Object.values(acc).reduce((x, y) => x + y, 0);
    const top = Object.entries(acc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top8 = top.slice(0, 8), resto = top.slice(8).reduce((x, [, v]) => x + v, 0), maxI = top8.length ? top8[0][1] : 1;
    const filaI = ([id, v]) => { const i = insPor(id) || { nombre: "(borrado)" }, n = enProd[id].size;
      return `<button class="kbar kbari" data-ki="${id}" title="${esc(i.nombre)}: ${pct(v / tot)} del costo de la carta, en ${n} producto${n > 1 ? "s" : ""}">
        <span class="kbn">${esc(i.nombre)}<small>en ${n} producto${n > 1 ? "s" : ""}</small></span>
        <span class="kbt"><span class="kbw" style="width:${(v / maxI) * 100}%"><i class="kbi${i.tipo === "packaging" ? " kbpk" : ""}"></i></span></span>
        <span class="kbv"><b class="num">${pct(v / tot)}</b></span></button>`; };
    // 3) ¿y si sube un insumo?
    if (!A.si || !acc[A.si]) A.si = top.length ? top[0][0] : null;
    let simHTML = "";
    if (A.si) {
      const antes = filas.flatMap((f) => f.sizes.map((s) => ({ f, s })));
      SIM = { id: A.si, f: A.sf }; memo = {};
      const desp = filasProductos().flatMap((f) => f.sizes.map((s) => ({ f, s })));
      SIM = { id: null, f: 0 }; memo = {};
      const pares = antes.map((x, k) => ({ f: x.f, t: x.s.t, m0: x.s.m, m1: desp[k].s.m, c0: x.s.c.cost, c1: desp[k].s.c.cost, ok: x.s.ok && x.s.pr > 0 }))
        .filter((x) => x.ok && x.c1 - x.c0 > 0.005);
      const okAll = antes.filter((x) => x.s.ok && x.s.pr > 0), prom0 = okAll.length ? okAll.reduce((a, x) => a + x.s.m, 0) / okAll.length : null;
      const prom1 = okAll.length ? prom0 + pares.reduce((a, x) => a + (x.m1 - x.m0), 0) / okAll.length : null;
      const cruzan = (lim) => pares.filter((x) => x.m0 >= lim && x.m1 < lim).length;
      const peores = pares.sort((a, b) => (a.m1 - a.m0) - (b.m1 - b.m0)).slice(0, 6);
      const opts = top.map(([id]) => `<option value="${id}" ${id === A.si ? "selected" : ""}>${esc((insPor(id) || {}).nombre || "?")}</option>`).join("");
      simHTML = `<div class="krow ksimrow"><label class="fl"><span>Insumo</span><select id="ksi">${opts}</select></label>
          <div class="fl"><span>Sube</span><div class="seg ksimseg">${[0.1, 0.2, 0.3, 0.5].map((f) => `<button type="button" data-ksf="${f}" aria-pressed="${A.sf === f}">+${f * 100}%</button>`).join("")}</div></div></div>
        ${pares.length ? `<div class="kpis kk ksimk">
          <div class="kpi"><div class="k">Productos afectados</div><div class="v num">${pares.length}</div></div>
          <div class="kpi"><div class="k">Margen promedio</div><div class="v num">${pct(prom0)} → ${pct(prom1)}</div></div>
          <div class="kpi ${cruzan(0.65) + cruzan(0.5) ? "warn" : ""}"><div class="k">Bajan de 65% / 50%</div><div class="v num">${cruzan(0.65)} / ${cruzan(0.5)}</div></div></div>
          <div class="items ksimlist">${peores.map((x) => `<div class="it"><span class="t"><b>${esc(x.f.p.nombre)}${x.t ? ` <small>${esc(x.t)}</small>` : ""}</b><span>Costo ${fmtC(x.c0)} → ${fmtC(x.c1)}</span></span>
            <span class="side kside"><span class="kpill kt-${tono(x.m1)}">${pct(x.m0)} → ${pct(x.m1)}</span></span></div>`).join("")}</div>`
        : `<p class="hintp">Ese insumo no está en ningún producto con costo completo.</p>`}`;
    }
    $("#kbody").innerHTML = `
      <section class="kchart"><h3 class="kch">Costo y lo que te queda</h3>
        <p class="kpinote">Cada barra es el precio de la carta: la parte gris es el costo y la de color lo que te queda. Ordenado de mayor a menor margen.</p>
        <div class="filters">${chip("todos", "Todos")}${chip("mochis", "Mochis")}${chip("bebidas", "Bebidas")}${chip("sets", "Sets")}</div>
        ${conTam ? `<div class="seg ktamseg">${["12 oz", "16 oz"].map((t) => `<button type="button" data-kat="${t}" aria-pressed="${A.t === t}">${t}</button>`).join("")}</div>` : ""}
        <div class="klegend kleg2"><span><i class="kbc"></i>Costo</span><span><i class="kg-ok"></i>Te queda (65%+)</span><span><i class="kg-mid"></i>50 a 65%</span><span><i class="kg-low"></i>menos de 50%</span></div>
        <div class="kbars">${items.map(barra).join("") || `<div class="emptyc"><span>No hay productos con costo completo en este filtro.</span></div>`}</div>
        ${fuera ? `<p class="kpinote">${fuera} sin receta o con precios faltantes no aparecen.</p>` : ""}</section>
      <section class="kchart"><h3 class="kch">Qué insumos pesan más</h3>
        <p class="kpinote">Sumando una unidad de cada producto de la carta (incluye lo que va dentro de las preparaciones). Tocá uno para ver su precio.</p>
        <div class="kbars">${top8.map(filaI).join("")}${resto > 0 ? `<div class="kbar"><span class="kbn">Otros ${top.length - 8}</span><span class="kbt"><span class="kbw" style="width:${(resto / maxI) * 100}%"><i class="kbi kbo"></i></span></span><span class="kbv"><b class="num">${pct(resto / tot)}</b></span></div>` : ""}</div>
        ${top8.some(([id]) => (insPor(id) || {}).tipo === "packaging") ? `<div class="klegend kleg2"><span><i class="kbi"></i>Materia prima</span><span><i class="kbi kbpk"></i>Packaging</span></div>` : ""}</section>
      <section class="kchart"><h3 class="kch">¿Y si sube un insumo?</h3>
        <p class="kpinote">Elegí un insumo y cuánto sube para ver qué productos pierden margen.</p>
        ${simHTML || `<p class="hintp">Cargá precios y recetas para simular.</p>`}</section>`;
  }

  // línea del precio de un insumo en el tiempo (por kg, litro o unidad)
  function histChart(hist, u) {
    const pts = hist.map((h) => ({ d: new Date(h.fecha + "T12:00:00").getTime(), v: (Number(h.precio) / Number(h.paquete)) * (u === "u" ? 1 : 1000), h })).sort((a, b) => a.d - b.d);
    const W = 320, H = 120, L = 8, R = 8, T = 22, B = 22;
    const d0 = pts[0].d, d1 = pts[pts.length - 1].d, vs = pts.map((p) => p.v), lo = Math.min(...vs) * 0.9, hi = Math.max(...vs) * 1.05;
    const x = (d) => (d1 === d0 ? W / 2 : L + ((d - d0) / (d1 - d0)) * (W - L - R)), y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const ult = pts[pts.length - 1], pri = pts[0], dif = pri.v ? (ult.v - pri.v) / pri.v : 0;
    const fC = (t) => new Date(t).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
    return `<h4 class="kh4">Precio en el tiempo <small class="kdif ${dif > 0.005 ? "up" : dif < -0.005 ? "down" : ""}">${dif > 0.005 ? "▲" : dif < -0.005 ? "▼" : "="} ${Math.abs(Math.round(dif * 100))}% desde ${fC(pri.d)}</small></h4>
      <svg class="khist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Precio ${u === "u" ? "por unidad" : u === "g" ? "por kg" : "por litro"}: ${pts.map((p) => fC(p.d) + " " + fmtC(p.v)).join(", ")}">
        <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="kax"/>
        <polyline points="${pts.map((p) => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}" class="kln2"/>
        ${pts.map((p) => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5" class="kpt"><title>${fC(p.d)}: ${fmtC(p.v)}${p.h.lugar ? " · " + esc(p.h.lugar) : ""}</title></circle>`).join("")}
        <text x="${x(ult.d).toFixed(1)}" y="${(y(ult.v) - 9).toFixed(1)}" text-anchor="end" class="ktx">${fmtC(ult.v)}</text>
        <text x="${L}" y="${H - 6}" class="ktx2">${fC(pri.d)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ktx2">${fC(ult.d)}</text>
      </svg>`;
  }

  function usado(iid) { return C.lin.some((l) => l.insumo_id === iid && recPor(l.receta_id)); }
  function usosDe(rid) { return [...new Set(C.lin.filter((l) => l.sub_id === rid && recPor(l.receta_id)).map((l) => l.receta_id))].map(recPor); }

  function vPreps() {
    const bases = C.rec.filter((r) => r.tipo === "base").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    $("#kbody").innerHTML = `
      <p class="kpinote" style="margin:4px 0 12px">Las bases que preparás antes: masa, siropes, foams, pulpa, espresso. Su costo por kg, litro o unidad se usa en los productos.</p>
      <div class="items kplist">${bases.map((r) => { const c = recUnit(r.id, []), us = usosDe(r.id);
        return `<button class="it kprep" data-kr="${r.id}"><span class="t"><b>${esc(r.nombre)}</b><span>Rinde ${trae(Number(r.rinde), r.rinde_unidad)}${Number(r.merma) ? ` · merma ${fmtQ(r.merma)}%` : ""}${us.length ? ` · en ${us.length} receta${us.length > 1 ? "s" : ""}` : ""}</span></span>
          <span class="side kside"><b class="num">${c.unit == null ? "—" : (c.faltan.size ? "~" : "") + porTxt(c.unit, r.rinde_unidad)}</b>${c.faltan.size ? `<small class="kwarn">faltan ${c.faltan.size} precio${c.faltan.size > 1 ? "s" : ""}</small>` : ""}</span></button>`; }).join("") || `<div class="emptyc"><span>Todavía no hay preparaciones.</span></div>`}</div>
      <div class="toolsrow"><button class="ghost" data-knewr>+ Preparación</button></div>`;
  }

  function vInsumos() {
    const q = C.qi.trim().toLowerCase();
    let list = C.ins.filter((i) => i.activo);
    if (C.fi === "sin") list = list.filter((i) => !C.pre[i.id]);
    if (C.fi === "packaging") list = list.filter((i) => i.tipo === "packaging");
    if (C.fi === "materia") list = list.filter((i) => i.tipo === "materia");
    if (q) list = list.filter((i) => i.nombre.toLowerCase().includes(q));
    list.sort((a, b) => (!!C.pre[a.id] - !!C.pre[b.id]) || a.nombre.localeCompare(b.nombre, "es"));
    const sin = C.ins.filter((i) => i.activo && !C.pre[i.id]).length;
    const chip = (k, l) => `<button class="chip" data-kfi="${k}" aria-pressed="${C.fi === k}">${l}</button>`;
    $("#kbody").innerHTML = `
      <input class="search" id="kqi" placeholder="Buscar insumo" value="${esc(C.qi)}" autocomplete="off">
      <div class="filters">${chip("todos", "Todos")}${chip("sin", `Sin precio${sin ? ` (${sin})` : ""}`)}${chip("materia", "Materia prima")}${chip("packaging", "Packaging")}</div>
      ${list.length ? [["Insumos", list.filter((i) => i.tipo !== "packaging")], ["Packaging", list.filter((i) => i.tipo === "packaging")]].filter(([, xs]) => xs.length)
        .map(([t, xs]) => `<small class="kpk-h kins-h">${t} <span class="num">${xs.length}</span></small><div class="items">${xs.map(filaIns).join("")}</div>`).join("")
        : `<div class="items"><div class="emptyc"><span>No hay insumos con ese filtro.</span></div></div>`}
      <div class="toolsrow"><button class="ghost" data-knewi>+ Insumo</button></div>
      <p class="kpinote">El costo usa siempre el último precio cargado. En gris, los que tienen más de ${VIEJO} días.</p>`;
  }
  function filaIns(i) {
    const p = C.pre[i.id], viejo = p && dias(p.fecha) > VIEJO;
    return `<button class="it kins ${viejo ? "old" : ""}" data-ki="${i.id}"><span class="t"><b>${esc(i.nombre)}</b>
      <span>${p ? `${fmtC(Number(p.precio))} por ${trae(Number(p.paquete), i.unidad)} · ${fechaC(p.fecha)}${p.lugar ? " · " + esc(p.lugar) : ""}${viejo ? ` · hace ${dias(p.fecha)} días` : ""}` : "Sin precio todavía"}</span></span>
      <span class="side kside">${p ? `<b class="num">${porTxt(precioU(i.id), i.unidad)}</b>` : `<span class="kcargar">Cargar</span>`}</span></button>`;
  }

  /* ---------- ficha de un producto (o set) ---------- */
  function abrirProd(pid, tam) {
    const p = prodPor(pid); if (!p) return;
    const ts = tamanos(p); tam = ts.includes(tam) ? tam : ts[0];
    if (esSet(p)) return fichaSet(p, tam);
    const r = recDe(p.id, tam);
    editor(r ? { id: r.id } : { nuevo: { nombre: p.nombre, tipo: "producto", product_id: p.id, tamano: tam, rinde: 1, rinde_unidad: "u", merma: 0 } }, { p, tam });
  }
  function fichaSet(p, tam) {
    memo = {};
    const c = costoProd(p, tam), pr = precioDe(p, tam), m = pr > 0 && c.cost != null && !c.sinReceta.length ? (pr - c.cost) / pr : null, ok = !c.sinReceta.length && !c.faltan.size;
    const sz = tamanos(p);
    const fila = (lbl, prod, cc, t) => `<button class="it kset" ${prod ? `data-kp="${esc(prod.id)}" data-ktam="${t || ""}"` : "disabled"}><span class="t"><b>${esc(lbl)}</b><span>${prod ? esc(prod.nombre) + (t ? " · " + t : "") : "No está en la carta"}${cc && cc.sinReceta.length ? " · sin receta" : cc && cc.faltan.size ? " · faltan precios" : ""}</span></span><span class="side kside"><b class="num">${cc && cc.cost != null ? fmtC(cc.cost) : "—"}</b></span>${prod ? '<span class="kgo">›</span>' : ""}</button>`;
    openSheet(`<div class="sh"><h3>${esc(p.nombre)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      ${sz.length > 1 ? `<div class="seg kszseg">${sz.map((t) => `<button type="button" data-kp="${esc(p.id)}" data-ktam="${t}" aria-pressed="${t === tam}">${t}</button>`).join("")}</div>` : ""}
      ${resumenHTML(c.cost, pr, m, ok, c.faltan, c.sinReceta, "Set")}
      <div class="items" style="margin-top:12px">${fila("Bebida", c.b, c.cb, tam)}${fila("Mochi", c.m, c.cm, null)}</div>
      <p class="hintp">El set no tiene receta propia: suma la bebida y el mochi de la carta. Tocá cada uno para ver o editar su receta.</p>`);
  }
  function resumenHTML(cost, pr, m, ok, faltan, sinRec, unidadTxt, partes) {
    const tot = partes ? Object.values(partes).reduce((a, b) => a + (b || 0), 0) : 0;
    const orden = partes ? Object.entries(partes).filter(([, v]) => v > 0).sort((a, b) => PARTES.indexOf(a[0]) - PARTES.indexOf(b[0])) : [];
    return `<div class="ksum">
      <div class="kbig"><span><small>Costo ${esc(unidadTxt)}</small><b class="num">${cost == null ? "—" : (ok ? "" : "~") + fmtC(cost)}</b></span>
        ${pr != null ? `<span><small>Precio</small><b class="num">${pr ? fmtC(pr) : "—"}</b></span><span class="kmg kt-${ok ? tono(m) : "na"}"><small>Margen</small><b class="num">${m == null ? "—" : pct(m)}</b>${m != null && pr ? `<em>${ok ? "" : "~"}${fmtC(pr - cost)} te quedan</em>` : ""}</span>` : ""}</div>
      ${tot > 0 && orden.length > 1 ? `<div class="kstack">${orden.map(([k, v], i) => `<i class="p${i % 6}" style="width:${(v / tot) * 100}%" title="${esc(k)}"></i>`).join("")}</div>
        <div class="klegend">${orden.map(([k, v], i) => `<span><i class="p${i % 6}"></i>${esc(k)} <b>${Math.round((v / tot) * 100)}%</b></span>`).join("")}</div>` : ""}
      ${sinRec && sinRec.length ? `<p class="note">Falta la receta de: ${esc(sinRec.join(", "))}.</p>` : ""}
      ${faltan && faltan.size ? `<p class="note">Faltan precios de: ${esc([...faltan].join(", "))}. El costo está incompleto.</p>` : ""}
    </div>`;
  }

  /* ---------- editor de receta (producto o preparación) ---------- */
  function editor(src, ctx = {}) {
    let D;
    if (src.id) {
      const r = recPor(src.id); if (!r) return toast("No encontré esa receta");
      D = { id: r.id, d: { nombre: r.nombre, tipo: r.tipo, product_id: r.product_id, tamano: r.tamano, rinde: Number(r.rinde), rinde_unidad: r.rinde_unidad, merma: Number(r.merma), nota: r.nota || "" },
        L: lineasDe(r.id).map((l) => ({ insumo_id: l.insumo_id, sub_id: l.sub_id, cantidad: Number(l.cantidad), parte: l.parte || "" })), meta: r };
    } else D = { id: null, d: Object.assign({ nota: "" }, src.nuevo), L: [], meta: null };
    if (D.d.tipo === "producto" && !ctx.p) { ctx.p = prodPor(D.d.product_id); ctx.tam = D.d.tamano; }
    const ORIG = D.L.map((l) => Object.assign({}, l)); // para sincronizar ingredientes con el otro tamaño
    const E = { dirty: false, pick: false, q: "", parte: D.d.tipo === "producto" ? (D.L.length ? D.L[D.L.length - 1].parte || "Otros" : esBebida(ctx.p || {}) ? "Bebida" : "Relleno") : "", seguro: false };
    const sh = () => $("#sheet");
    const unitTxt = () => (D.d.tipo === "producto" ? "por unidad" : D.d.rinde_unidad === "u" ? "por unidad" : D.d.rinde_unidad === "g" ? "por kg" : "por litro");
    const calc = () => { memo = {}; return calcLineas(D.L, D.d.rinde, D.d.merma, D.id ? [D.id] : []); };

    function sumHTML() {
      const c = calc();
      if (D.d.tipo === "producto") {
        const vacio = !D.L.length || (c.faltan.size && !c.total), cu = vacio ? null : c.unit;
        const pr = ctx.p ? precioDe(ctx.p, D.d.tamano) : 0, m = pr > 0 && cu != null ? (pr - cu) / pr : null;
        return resumenHTML(cu, pr, m, !c.faltan.size && D.L.length > 0, c.faltan, D.L.length ? [] : null, "por unidad", c.partes)
          + (Number(D.d.rinde) !== 1 && !vacio ? `<p class="kpinote" style="margin-top:6px">La tanda cuesta ${fmtC(c.total)} y rinde ${fmtQ(D.d.rinde)}${Number(D.d.merma) ? ` (−${fmtQ(D.d.merma)}% de merma)` : ""}.</p>` : "");
      }
      const unit = c.unit == null || !D.L.length || (c.faltan.size && !c.total) ? null : D.d.rinde_unidad === "u" ? c.unit : c.unit * 1000;
      return resumenHTML(unit, null, null, !c.faltan.size && D.L.length > 0, c.faltan, null, unitTxt(), null)
        + `<p class="kpinote" style="margin-top:6px">La tanda cuesta ${fmtC(c.total)} y rinde ${trae(Number(D.d.rinde) || 0, D.d.rinde_unidad)}${Number(D.d.merma) ? ` (−${fmtQ(D.d.merma)}% de merma)` : ""}. ${D.d.rinde_unidad === "u" ? "" : `Por ${D.d.rinde_unidad}: ${fmtC(c.unit)}.`}</p>`;
    }
    function lineaHTML(l, i, c) {
      const u = unidadL(l), sub = l.sub_id && recPor(l.sub_id), mov = D.d.tipo === "producto";
      return `<div class="kln${mov ? " kln-d" : ""}" data-i="${i}">${mov ? `<span class="kln-h" data-kdrag="${i}" title="Arrastrá para moverlo" aria-hidden="true">⠿</span>` : ""}
        <span class="kln-n">${sub ? `<button type="button" class="kln-sub" data-kr="${sub.id}">${esc(sub.nombre)} <span>›</span></button>` : `<button type="button" class="kln-ins" data-ki="${esc(l.insumo_id)}">${esc(nombreL(l))}</button>`}
          ${c.costs[i] == null ? `<small class="kwarn">${sub ? "faltan precios" : "sin precio"}</small>` : ""}</span>
        <label class="kq"><input data-kq="${i}" value="${l.cantidad ? fmtIn(l.cantidad) : ""}" inputmode="decimal" autocomplete="off" aria-label="Cantidad de ${esc(nombreL(l))}"><span>${UN[u]}</span></label>
        <span class="kln-c num" data-kc="${i}">${c.costs[i] == null ? "—" : fmtC(c.costs[i])}</span>
        <button type="button" class="kln-x" data-kdel="${i}" aria-label="Quitar ${esc(nombreL(l))}">×</button></div>`;
    }
    function lineasHTML() {
      const c = calc();
      if (!D.L.length) return `<div class="emptyc" style="padding:16px 10px"><span>Todavía no tiene ingredientes.</span></div>`;
      if (D.d.tipo !== "producto") return `<div class="klines">${D.L.map((l, i) => lineaHTML(l, i, c)).join("")}</div>`;
      const gs = {}; D.L.forEach((l, i) => (gs[l.parte || "Otros"] = gs[l.parte || "Otros"] || []).push(i));
      return Object.keys(gs).sort((a, b) => PARTES.indexOf(a) - PARTES.indexOf(b)).map((g) => `<div class="kgrp" data-kg="${esc(g)}"><div class="kgh">${esc(g)}<span class="num">${fmtC(gs[g].reduce((a, i) => a + (c.costs[i] || 0), 0))}</span></div><div class="klines">${gs[g].map((i) => lineaHTML(D.L[i], i, c)).join("")}</div></div>`).join("");
    }
    function pickHTML() {
      const q = E.q.trim().toLowerCase();
      const usados = new Set(D.L.map((l) => l.insumo_id || l.sub_id));
      const ins = C.ins.filter((i) => i.activo && !usados.has(i.id) && (!q || i.nombre.toLowerCase().includes(q)));
      const subs = C.rec.filter((r) => r.tipo === "base" && r.id !== D.id && !usados.has(r.id) && (!q || r.nombre.toLowerCase().includes(q)));
      const sec = (t, xs) => xs.length ? `<small class="kpk-h">${t}</small>${xs.slice(0, 30).map((i) => `<button type="button" class="chip" data-kadd="i:${i.id}">${esc(i.nombre)}</button>`).join("")}` : "";
      return `${subs.length ? `<small class="kpk-h">Preparaciones</small>${subs.slice(0, 12).map((r) => `<button type="button" class="chip" data-kadd="s:${r.id}">${esc(r.nombre)}</button>`).join("")}` : ""}
        ${sec("Insumos", ins.filter((i) => i.tipo !== "packaging"))}
        ${sec("Packaging", ins.filter((i) => i.tipo === "packaging"))}
        ${q && !C.ins.some((i) => i.activo && i.nombre.toLowerCase() === q) ? `<button type="button" class="chip knewchip" data-knewin>+ Crear insumo "${esc(E.q.trim())}"</button>` : ""}`;
    }
    function draw() {
      const p = ctx.p, esProd = D.d.tipo === "producto";
      const sz = esProd && p ? tamanos(p) : [null];
      const meta = D.meta && D.meta.updated_por ? `Última edición: ${esc(D.meta.updated_por)} · ${new Date(D.meta.updated_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : "";
      const html = `<div class="grab"></div><div class="sh"><h3>${esc(esProd && p ? p.nombre : D.d.nombre || "Nueva preparación")}</h3>${E.dirty ? `<button class="x" data-kx aria-label="Cerrar sin guardar">×</button>` : `<button class="x" data-close aria-label="Cerrar">×</button>`}</div>
        ${esProd && sz.length > 1 ? `<div class="seg kszseg">${sz.map((t) => `<button type="button" data-ksz="${t}" aria-pressed="${t === D.d.tamano}">${t}</button>`).join("")}</div>` : ""}
        ${!D.id && esProd ? `<p class="note ok">Este producto todavía no tiene receta${D.d.tamano ? " en " + D.d.tamano : ""}. Agregale los ingredientes y guardala.</p>` : ""}
        ${!esProd ? `<label class="fl"><span>Nombre</span><input id="kN" value="${esc(D.d.nombre)}" maxlength="60" placeholder="Ej: Sirope de mango"></label>` : ""}
        <div id="ksum">${sumHTML()}</div>
        <h4 class="kh4">Ingredientes${esProd && Number(D.d.rinde) !== 1 ? ` <small>para ${fmtQ(D.d.rinde)} unidades</small>` : ""}</h4>
        <div id="klist">${lineasHTML()}</div>
        ${E.pick ? `<div class="kpick"><input class="search" id="kpq" placeholder="Buscar insumo o preparación" value="${esc(E.q)}" autocomplete="off">
            ${esProd ? `<div class="kpartes"><span>Va en</span>${PARTES.map((x) => `<button type="button" class="chip" data-kparte="${x}" aria-pressed="${E.parte === x}">${x}</button>`).join("")}</div>` : ""}
            <div class="kpk" id="kpk">${pickHTML()}</div><button type="button" class="linkbtn" data-kpick>Listo</button></div>`
          : `<button type="button" class="ghost kaddb" data-kpick>+ Agregar ingrediente</button>`}
        <div class="krow">
          <label class="fl"><span>${esProd ? "La receta rinde (unidades)" : "Rinde"}</span><span class="kq kq-big"><input id="kR" value="${fmtIn(D.d.rinde)}" inputmode="decimal" autocomplete="off">${esProd ? "<span>u</span>" : ""}</span></label>
          ${!esProd ? `<div class="fl"><span>Unidad del rinde</span><div class="seg">${["g", "ml", "u"].map((u) => `<button type="button" data-kru="${u}" aria-pressed="${D.d.rinde_unidad === u}">${u}</button>`).join("")}</div></div>` : ""}
          <label class="fl"><span>Merma estimada</span><span class="kq kq-big"><input id="kM" value="${fmtIn(D.d.merma)}" inputmode="decimal" autocomplete="off"><span>%</span></span></label>
        </div>
        ${!esProd && D.id ? (() => { const us = usosDe(D.id); return us.length ? `<p class="hintp">Se usa en: ${us.map((r) => esc(r.nombre + (r.tamano ? " " + r.tamano : ""))).join(", ")}.</p>` : ""; })() : ""}
        <label class="fl"><span>Nota</span><textarea id="kNo" rows="2" maxlength="400" placeholder="Ej: rinde medido el 20/11">${esc(D.d.nota)}</textarea></label>
        <p class="err" id="kerr" hidden></p>
        <div class="ksave"><button type="button" class="btn solid big" data-ksave ${E.dirty || !D.id ? "" : "disabled"}>${D.id ? (E.dirty ? "Guardar cambios" : "Sin cambios") : "Guardar receta"}</button></div>
        <div class="toolsrow kfoot">
          ${esProd && D.id && p && tamanos(p).length > 1 ? (() => { const otro = tamanos(p).find((t) => t !== D.d.tamano); return recDe(p.id, otro) ? "" : `<button type="button" class="ghost" data-kdup="${otro}">Copiar a ${otro}</button>`; })() : ""}
          ${D.id ? `<button type="button" class="linkbtn warn" data-khide>${E.seguro ? "Tocá de nuevo para ocultarla" : "Ocultar receta"}</button>` : ""}
        </div>
        ${meta ? `<p class="hintp">${meta}</p>` : ""}`;
      const s = sh(); s.innerHTML = html;
    }
    const refresh = () => { const c = calc(); $("#ksum").innerHTML = sumHTML(); D.L.forEach((_, i) => { const el = sh().querySelector(`[data-kc="${i}"]`); if (el) el.textContent = c.costs[i] == null ? "—" : fmtC(c.costs[i]); }); };
    const ensucia = () => { if (!E.dirty) { E.dirty = true; const b = sh().querySelector("[data-ksave]"); if (b) { b.disabled = false; b.textContent = "Guardar cambios"; } const x = sh().querySelector(".sh .x"); if (x) { x.removeAttribute("data-close"); x.setAttribute("data-kx", ""); } } };
    const leer = () => { const s = sh(); const n = s.querySelector("#kN"); if (n) D.d.nombre = n.value; const no = s.querySelector("#kNo"); if (no) D.d.nota = no.value; };

    const montar = () => { openSheet("", () => {}); draw(); sh().oninput = onInput; sh().onclick = onClick; sh().onpointerdown = onDrag; };
    // Arrastrar un ingrediente (por la manija ⠿) a otro lugar o a otro grupo (Bebida, Foam…).
    function onDrag(e) {
      const h = e.target.closest("[data-kdrag]"); if (!h || (e.button && e.button !== 0)) return;
      e.preventDefault(); leer();
      const i = +h.dataset.kdrag, row = h.closest(".kln"), list = sh().querySelector("#klist"), r0 = row.getBoundingClientRect();
      const hay = new Set([...list.querySelectorAll("[data-kg]")].map((g) => g.dataset.kg));
      PARTES.filter((x) => !hay.has(x)).forEach((x) => list.insertAdjacentHTML("beforeend", `<div class="kgrp kzone" data-kg="${x}"><div class="kgh">${x}</div><div class="klines kdrop">Soltá acá para pasarlo a ${x}</div></div>`));
      const ghost = row.cloneNode(true); ghost.classList.add("kghost"); ghost.style.width = r0.width + "px"; ghost.style.left = r0.left + "px"; document.body.appendChild(ghost);
      const off = e.clientY - r0.top; row.classList.add("kdragsrc");
      let tgt = null, timer = null, lastY = e.clientY;
      const marca = () => sh().querySelectorAll(".kover,.kbefore,.kafter").forEach((x) => x.classList.remove("kover", "kbefore", "kafter"));
      const mover = (x, y) => {
        ghost.style.top = y - off + "px"; lastY = y;
        ghost.style.display = "none"; const el = document.elementFromPoint(x, y); ghost.style.display = "";
        marca(); tgt = null;
        const grp = el && el.closest("#klist [data-kg]"); if (!grp) return;
        const ln = el.closest(".kln[data-i]");
        if (ln && ln !== row) { const b = ln.getBoundingClientRect(), after = y > b.top + b.height / 2; ln.classList.add(after ? "kafter" : "kbefore"); tgt = { parte: grp.dataset.kg, ref: +ln.dataset.i, after }; }
        else { grp.classList.add("kover"); tgt = { parte: grp.dataset.kg, ref: null }; }
      };
      const scroll = () => { const s = sh(), b = s.getBoundingClientRect(); if (lastY < b.top + 70) s.scrollTop -= 12; else if (lastY > b.bottom - 70) s.scrollTop += 12; };
      timer = setInterval(scroll, 30); mover(e.clientX, e.clientY);
      const mv = (ev) => mover(ev.clientX, ev.clientY);
      const up = () => {
        clearInterval(timer); h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
        ghost.remove();
        if (tgt) {
          const it = D.L[i], antes = it.parte; it.parte = tgt.parte;
          const ref = tgt.ref != null ? D.L[tgt.ref] : null;
          D.L.splice(i, 1);
          let idx;
          if (ref) idx = D.L.indexOf(ref) + (tgt.after ? 1 : 0);
          else { const ult = D.L.map((l) => l.parte).lastIndexOf(tgt.parte); idx = ult >= 0 ? ult + 1 : D.L.length; }
          D.L.splice(idx, 0, it);
          if (antes !== tgt.parte || idx !== i) ensucia();
        }
        draw();
      };
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
      h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
    }
    const onInput = (e) => {
      const t = e.target;
      if (t.dataset.kq !== undefined) { const v = num(t.value); D.L[+t.dataset.kq].cantidad = isNaN(v) ? 0 : v; ensucia(); refresh(); return; }
      if (t.id === "kR") { const v = num(t.value); D.d.rinde = isNaN(v) ? 0 : v; ensucia(); refresh(); return; }
      if (t.id === "kM") { const v = num(t.value); D.d.merma = isNaN(v) ? 0 : v; ensucia(); refresh(); return; }
      if (t.id === "kN" || t.id === "kNo") { leer(); ensucia(); return; }
      if (t.id === "kpq") { E.q = t.value; $("#kpk").innerHTML = pickHTML(); return; }
    };
    const onClick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.kx !== undefined) { if (E.seguroX) return closeSheet(); E.seguroX = true; toast("Tenés cambios sin guardar. Tocá × de nuevo para descartarlos."); return; }
      if (d.ksz) { if (E.dirty) return toast("Guardá los cambios antes de cambiar de tamaño"); return abrirProd(ctx.p.id, d.ksz); }
      if (d.kpick !== undefined) { leer(); E.pick = !E.pick; E.q = ""; draw(); if (E.pick) sh().querySelector("#kpq").focus(); return; }
      if (d.kparte) { E.parte = d.kparte; sh().querySelectorAll("[data-kparte]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.kparte === E.parte)); return; }
      if (d.kadd) {
        leer(); const [k, id] = d.kadd.split(":");
        const it = k === "i" ? insPor(id) : null;
        D.L.push({ insumo_id: k === "i" ? id : null, sub_id: k === "s" ? id : null, cantidad: 0, parte: D.d.tipo === "producto" ? (it && it.tipo === "packaging" ? "Packaging" : E.parte || "Otros") : "" });
        E.pick = false; E.q = ""; ensucia(); draw();
        const inp = sh().querySelector(`[data-kq="${D.L.length - 1}"]`); if (inp) inp.focus();
        return;
      }
      if (d.knewin !== undefined) { leer(); const nombre = E.q.trim(); return insumoForm(null, { nombre }, (nid) => { const it = insPor(nid); D.L.push({ insumo_id: nid, sub_id: null, cantidad: 0, parte: D.d.tipo === "producto" ? (it && it.tipo === "packaging" ? "Packaging" : E.parte || "Otros") : "" }); E.pick = false; E.q = ""; E.dirty = true; montar(); const inp = sh().querySelector(`[data-kq="${D.L.length - 1}"]`); if (inp) inp.focus(); }); }
      if (d.kdel !== undefined) { leer(); D.L.splice(+d.kdel, 1); ensucia(); draw(); return; }
      if (d.kru) { leer(); D.d.rinde_unidad = d.kru; ensucia(); draw(); return; }
      if (d.kr) { if (E.dirty) return toast("Guardá los cambios antes de abrir otra receta"); return editor({ id: d.kr }); }
      if (d.ki) { if (E.dirty) return toast("Guardá los cambios antes de abrir el insumo"); return insumoSheet(d.ki); }
      if (d.ksave !== undefined) return guardar();
      if (d.kdup) return copiarA(d.kdup);
      if (d.khide !== undefined) {
        if (!E.seguro) { E.seguro = true; b.textContent = "Tocá de nuevo para ocultarla"; return; }
        return guardar(false);
      }
    };
    montar();
    async function guardar(activo = true) {
      if (!needMe()) return;
      leer();
      const er = sh().querySelector("#kerr"); er.hidden = true;
      const malas = D.L.filter((l) => !(Number(l.cantidad) > 0));
      if (activo && malas.length) { er.textContent = `Poné la cantidad de: ${malas.map(nombreL).join(", ")}.`; er.hidden = false; return; }
      if (activo && !(Number(D.d.rinde) > 0)) { er.textContent = "El rinde tiene que ser mayor a 0."; er.hidden = false; return; }
      const b = sh().querySelector("[data-ksave]"); b.disabled = true; b.textContent = "Guardando…";
      try {
        const id = fail(await sb.rpc("costo_receta_guardar", { p_id: D.id, p_datos: Object.assign({}, D.d, { activo }), p_lineas: activo ? D.L.map((l) => ({ insumo_id: l.insumo_id, sub_id: l.sub_id, cantidad: l.cantidad, parte: l.parte || null })) : null, p_por: K.me() }));
        await reload();
        let extra = "";
        if (activo) { try { extra = await sincronizarTam(); } catch (e2) { extra = ` (no se pudo pasar al otro tamaño: ${e2.message})`; } }
        if (K.view() === "costos") view();
        if (!activo) { closeSheet(); toast("Receta oculta"); return; }
        toast("Guardado" + extra); editor({ id }, ctx);
      } catch (err) { er.textContent = err.message; er.hidden = false; b.disabled = false; b.textContent = "Guardar cambios"; }
    }
    // Los dos tamaños de una bebida llevan los mismos ingredientes: lo que se agrega o se quita en uno
    // se agrega o se quita en el otro (con la misma cantidad, para ajustar a mano). El vaso 12 ↔ 16 oz se cambia solo.
    async function sincronizarTam() {
      const p = ctx.p;
      if (D.d.tipo !== "producto" || !D.d.tamano || !p || tamanos(p).length < 2) return "";
      const t = tamanos(p).find((x) => x !== D.d.tamano);
      const al = (L) => L.map((l) => aTam(l, t)), k = (l) => (l.insumo_id ? "i:" + l.insumo_id : "s:" + l.sub_id);
      const antes = new Set(al(ORIG).map(k)), ahora = al(D.L), ahoraK = new Set(ahora.map(k));
      const sumar = ahora.filter((l) => !antes.has(k(l))), sacar = [...antes].filter((x) => !ahoraK.has(x));
      const otra = recDe(p.id, t);
      if (!otra) {
        if (!D.L.length || !(precioDe(p, t) > 0)) return "";
        fail(await sb.rpc("costo_receta_guardar", { p_id: null, p_datos: Object.assign({}, D.d, { tamano: t, nota: `Copiada de ${D.d.tamano}: ajustá las cantidades.` }), p_lineas: ahora.map(lin), p_por: K.me() }));
        await reload(); return `. Armé la de ${t} con los mismos ingredientes: ajustá las cantidades.`;
      }
      if (!sumar.length && !sacar.length) return "";
      const L2 = lineasDe(otra.id).map((l) => ({ insumo_id: l.insumo_id, sub_id: l.sub_id, cantidad: Number(l.cantidad), parte: l.parte || "" }));
      const L2k = new Set(L2.map(k));
      const nuevaL = L2.filter((l) => !sacar.includes(k(l))).concat(sumar.filter((l) => !L2k.has(k(l))));
      const cambios = nuevaL.length !== L2.length || sumar.some((l) => !L2k.has(k(l)));
      if (!cambios) return "";
      fail(await sb.rpc("costo_receta_guardar", { p_id: otra.id, p_datos: { nombre: otra.nombre, tipo: otra.tipo, product_id: otra.product_id, tamano: otra.tamano, rinde: Number(otra.rinde), rinde_unidad: otra.rinde_unidad, merma: Number(otra.merma), nota: otra.nota || "", activo: true }, p_lineas: nuevaL.map(lin), p_por: K.me() }));
      await reload();
      const n = sumar.filter((l) => !L2k.has(k(l))).length, m = L2.length - (nuevaL.length - n);
      return `. En ${t}: ${[n ? `+${n} ingrediente${n > 1 ? "s" : ""} (ajustá la cantidad)` : "", m ? `−${m}` : ""].filter(Boolean).join(", ")}`;
    }
    const lin = (l) => ({ insumo_id: l.insumo_id, sub_id: l.sub_id, cantidad: l.cantidad, parte: l.parte || null });
    function aTam(l, t) {
      const i = l.insumo_id && insPor(l.insumo_id);
      if (!i || !/(12|16)\s?oz/i.test(i.nombre)) return l;
      const nom = i.nombre.replace(/(12|16)(\s?oz)/i, (_, __, r) => t.slice(0, 2) + r).toLowerCase();
      const j = C.ins.find((x) => x.activo && x.nombre.toLowerCase() === nom);
      return j ? Object.assign({}, l, { insumo_id: j.id }) : l;
    }
    async function copiarA(t) {
      if (!needMe()) return;
      if (E.dirty) return toast("Guardá los cambios primero");
      try {
        const id = fail(await sb.rpc("costo_receta_guardar", { p_id: null, p_datos: Object.assign({}, D.d, { tamano: t, nota: "Copiada de " + D.d.tamano + ": ajustá las cantidades." }), p_lineas: D.L.map((l) => lin(aTam(l, t))), p_por: K.me() }));
        await reload(); if (K.view() === "costos") view();
        toast(`Copiada a ${t}. Ajustá las cantidades.`); editor({ id }, ctx);
      } catch (err) { toast(err.message); }
    }
  }

  /* ---------- insumo: precio, historial y datos ---------- */
  async function insumoSheet(id) {
    const i = insPor(id); if (!i) return;
    const p = C.pre[id];
    openSheet(`<div class="sh"><h3>${esc(i.nombre)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div><div class="loading" style="padding:20px">Cargando…</div>`);
    let hist = [];
    try { hist = fail(await sb.from("costo_precios").select("*").eq("insumo_id", id).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(12)); } catch (_) {}
    const usos = [...new Set(C.lin.filter((l) => l.insumo_id === id && recPor(l.receta_id)).map((l) => l.receta_id))].map(recPor);
    const pq = p ? Number(p.paquete) : i.paquete ? Number(i.paquete) : "";
    const s = $("#sheet");
    s.innerHTML = `<div class="grab"></div><div class="sh"><h3>${esc(i.nombre)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="ksum"><div class="kbig"><span><small>Último precio</small><b class="num">${p ? fmtC(Number(p.precio)) : "—"}</b>${p ? `<em>por ${trae(Number(p.paquete), i.unidad)}</em>` : ""}</span>
        <span><small>${i.unidad === "u" ? "Por unidad" : i.unidad === "g" ? "Por kg" : "Por litro"}</small><b class="num">${p ? fmtC(i.unidad === "u" ? precioU(id) : precioU(id) * 1000) : "—"}</b>${p ? `<em>${fechaC(p.fecha)}${dias(p.fecha) > VIEJO ? ` · hace ${dias(p.fecha)} días` : ""}</em>` : ""}</span></div></div>
      <form class="form kpform" id="kpf">
        <h4 class="kh4">Cargar precio nuevo</h4>
        <div class="krow">
          <label class="fl"><span>Pagaste</span><div class="monto"><input id="kpP" inputmode="decimal" autocomplete="off" placeholder="0"></div></label>
          <label class="fl"><span>Por un paquete de</span><span class="kq kq-big"><input id="kpQ" inputmode="decimal" autocomplete="off" value="${pq ? fmtIn(pq) : ""}" placeholder="${i.unidad === "u" ? "12" : "1000"}"><span>${UN[i.unidad]}</span></span></label>
        </div>
        <div class="krow">
          <label class="fl"><span>Fecha</span><input id="kpF" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
          <label class="fl"><span>Dónde lo compraste</span><select id="kpL">${lugOpts(p && p.lugar)}</select></label>
        </div>
        <label class="fl" id="kpLnw" hidden><span>Lugar nuevo</span><input id="kpLn" maxlength="60" autocomplete="off" placeholder="Ej: Distribuidora Centro"></label>
        <label class="fl"><span>Marca o presentación (opcional)</span><input id="kpD" maxlength="60" autocomplete="off" placeholder="Ej: La Paulina 350 ml" value="${esc(p && p.detalle ? p.detalle : "")}"></label>
        <p class="hintp" id="kpPrev">${i.unidad === "u" ? "Ej: si el pack trae 12 vasos, poné 12." : `En ${i.unidad === "g" ? "gramos: 1 kg = 1000" : "ml: 1 litro = 1000"}.`}</p>
        <p class="err" id="kperr" hidden></p>
        <button class="btn solid big" type="submit">Guardar precio</button>
      </form>
      ${hist.length > 1 ? histChart(hist, i.unidad) : ""}
      ${hist.length ? `<h4 class="kh4">Historial</h4><div class="items">${hist.map((h) => `<div class="it"><span class="t"><b>${fmtC(Number(h.precio))} por ${trae(Number(h.paquete), i.unidad)}</b><span>${fechaC(h.fecha)}${h.lugar ? " · " + esc(h.lugar) : ""}${h.detalle ? " · " + esc(h.detalle) : ""} · ${esc(h.registro)}${h.origen !== "manual" ? " · " + ({ compras: "lista de compras", app: "app de compras" }[h.origen] || h.origen) : ""}</span></span><span class="side num">${porTxt(Number(h.precio) / Number(h.paquete), i.unidad)}</span></div>`).join("")}</div>` : ""}
      ${usos.length ? `<p class="hintp">Se usa en: ${usos.map((r) => esc(r.nombre + (r.tamano ? " " + r.tamano : ""))).join(", ")}.</p>` : `<p class="hintp">Todavía no se usa en ninguna receta.</p>`}
      <div class="toolsrow"><button type="button" class="ghost" data-kedi="${id}">Nombre, tipo y unidad</button></div>`;
    const prev = () => { const pp = num(s.querySelector("#kpP").value), qq = num(s.querySelector("#kpQ").value); if (pp > 0 && qq > 0) s.querySelector("#kpPrev").textContent = `Queda en ${porTxt(pp / qq, i.unidad)}.`; };
    const lugNuevo = () => { const nw = s.querySelector("#kpL").value === NUEVO; s.querySelector("#kpLnw").hidden = !nw; if (nw) s.querySelector("#kpLn").focus(); };
    s.oninput = (e) => { if (["kpP", "kpQ"].includes(e.target.id)) prev(); };
    s.onchange = (e) => { if (e.target.id === "kpL") lugNuevo(); };
    lugNuevo();
    s.onclick = (e) => { const b = e.target.closest("[data-kedi]"); if (b) insumoForm(id); };
    s.onsubmit = async (e) => {
      e.preventDefault(); if (!needMe()) return;
      const er = s.querySelector("#kperr"); er.hidden = true;
      const pp = num(s.querySelector("#kpP").value), qq = num(s.querySelector("#kpQ").value);
      if (!(pp > 0)) { er.textContent = "Poné cuánto pagaste."; er.hidden = false; return; }
      if (!(qq > 0)) { er.textContent = "Poné cuánto trae el paquete."; er.hidden = false; return; }
      const ls = s.querySelector("#kpL").value, lugar = (ls === NUEVO ? s.querySelector("#kpLn").value : ls).trim();
      if (!lugar) { er.textContent = ls === NUEVO ? "Escribí el nombre del lugar nuevo." : "Elegí dónde lo compraste."; er.hidden = false; return; }
      try {
        fail(await sb.rpc("costo_precio_cargar", { p_insumo: id, p_precio: pp, p_paquete: qq, p_fecha: s.querySelector("#kpF").value || null, p_lugar: lugar, p_origen: "manual", p_por: K.me(), p_detalle: s.querySelector("#kpD").value.trim() || null }));
        await reload(); if (K.view() === "costos") view();
        toast(`Precio de ${i.nombre} guardado`); insumoSheet(id);
      } catch (err) { er.textContent = err.message; er.hidden = false; }
    };
  }
  function insumoForm(id, pre = {}, onNuevo) {
    const i = id ? insPor(id) : Object.assign({ nombre: "", tipo: "materia", unidad: "g" }, pre);
    const conPrecio = id && C.pre[id];
    const F = { tipo: i.tipo, unidad: i.unidad };
    const draw = (s) => {
      s.innerHTML = `<div class="grab"></div><div class="sh"><h3>${id ? "Editar insumo" : "Nuevo insumo"}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="kif"><label class="fl"><span>Nombre</span><input id="kiN" value="${esc(F.nombre ?? i.nombre)}" maxlength="60" required placeholder="Ej: Leche de avena"></label>
      <div class="fl"><span>Tipo</span><div class="seg">${[["materia", "Materia prima"], ["packaging", "Packaging"]].map(([k, l]) => `<button type="button" data-kit="${k}" aria-pressed="${F.tipo === k}">${l}</button>`).join("")}</div></div>
      <div class="fl"><span>Se mide en</span><div class="seg">${["g", "ml", "u"].map((u) => `<button type="button" data-kiu="${u}" aria-pressed="${F.unidad === u}" ${conPrecio && u !== i.unidad ? "disabled" : ""}>${UNL[u]}</button>`).join("")}</div></div>
      ${conPrecio ? `<p class="hintp">La unidad no se puede cambiar porque ya tiene precios. Si te equivocaste, creá otro insumo.</p>` : ""}
      <p class="err" id="kierr" hidden></p>
      <button class="btn solid big" type="submit">Guardar</button>
      ${id ? `<button type="button" class="btn danger" data-kihide>Ocultar insumo</button>` : ""}</form>`;
    };
    openSheet("", draw);
    const s = $("#sheet");
    s.oninput = (e) => { if (e.target.id === "kiN") F.nombre = e.target.value; };
    s.onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.kit) { F.tipo = b.dataset.kit; draw(s); return; }
      if (b.dataset.kiu) { F.unidad = b.dataset.kiu; draw(s); return; }
      if (b.dataset.kihide !== undefined) {
        if (C.lin.some((l) => l.insumo_id === id && recPor(l.receta_id))) return toast("Está en recetas: sacalo de las recetas antes de ocultarlo");
        try { fail(await sb.rpc("costo_insumo_guardar", { p_id: id, p_nombre: i.nombre, p_tipo: i.tipo, p_unidad: i.unidad, p_paquete: i.paquete, p_activo: false, p_por: K.me() })); await reload(); closeSheet(); if (K.view() === "costos") view(); toast("Insumo oculto"); } catch (err) { toast(err.message); }
      }
    };
    s.onsubmit = async (e) => {
      e.preventDefault(); if (!needMe()) return;
      const er = s.querySelector("#kierr"); er.hidden = true;
      try {
        const nid = fail(await sb.rpc("costo_insumo_guardar", { p_id: id || null, p_nombre: s.querySelector("#kiN").value, p_tipo: F.tipo, p_unidad: F.unidad, p_paquete: i.paquete || null, p_activo: true, p_por: K.me() }));
        await reload(); if (K.view() === "costos") view();
        toast("Guardado");
        if (onNuevo) return onNuevo(nid);
        insumoSheet(nid);
      } catch (err) { er.textContent = err.message; er.hidden = false; }
    };
  }

  /* ---------- eventos de la vista ---------- */
  document.addEventListener("click", (e) => {
    if (K.view() !== "costos") return;
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset, enHoja = !!b.closest("#sheet");
    if (enHoja && !d.kp) return; // dentro de una hoja lo maneja la hoja (salvo abrir un producto desde un set)
    if (d.kt) return setTab(d.kt);
    if (d.kf) { C.filtro = d.kf; return view(); }
    if (d.kfi) { C.fi = d.kfi; return view(); }
    if (d.kag) { C.an.g = d.kag; return view(); }
    if (d.kat) { C.an.t = d.kat; return view(); }
    if (d.ksf) { C.an.sf = Number(d.ksf); return view(); }
    if (d.kp) return abrirProd(d.kp, d.ktam || null);
    if (d.kr) return editor({ id: d.kr });
    if (d.ki) return insumoSheet(d.ki);
    if (d.knewi !== undefined) return insumoForm(null);
    if (d.knewr !== undefined) return editor({ nuevo: { nombre: "", tipo: "base", rinde: 1000, rinde_unidad: "ml", merma: 0 } });
  });
  document.addEventListener("change", (e) => {
    if (K.view() !== "costos" || e.target.id !== "ksi") return;
    C.an.si = e.target.value; view();
  });
  document.addEventListener("input", (e) => {
    if (K.view() !== "costos" || e.target.id !== "kqi") return;
    C.qi = e.target.value; const p = e.target.selectionStart; view(); const i = $("#kqi"); if (i) { i.focus(); i.setSelectionRange(p, p); }
  });

  return {
    view,
    linkHTML: () => `<button class="kentry" data-go="costos"><span class="kei">${ICO.calc}</span><span class="ket"><b>Costos de producción</b><small>Cuánto cuesta hacer cada producto y cuánto te queda</small></span><span class="kgo">›</span></button>`,
    invalidar: () => { C.ok = false; },
  };
};
