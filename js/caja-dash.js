/*
  Caja · Dashboard (pestaña de la barra de abajo, #dash). Vistas Día / Semana / Mes con navegación hacia atrás.
  - Facturado (bruto) = todas las entradas de la Caja. Gastado = todos los gastos. Te queda en caja = facturado − gastado.
  - Ganancia neta = facturado − mercadería y packaging de lo vendido (recetas, js/costos-calc.js, con los precios de
    insumos de ESE día). Lo cargado sin productos se costea con el mismo % que el resto (se marca como estimado).
  - Cada período se compara con el anterior; si está en curso, contra la misma cantidad de días.
  - Por turno: mañana (antes de la hora de corte) y tarde, según la hora en que entró la venta.
  - Subas de insumos: cada precio que sube más de X% respecto del anterior queda en el historial, con los
    productos que pierden margen y a cuánto subirlos para volver al margen que tenían. Se guarda en settings.costos_alertas.
*/
window.CajaDash = function (K) {
  const { sb, $, esc, fail, toast } = K;
  const TZ = "America/Argentina/Buenos_Aires";
  const CC = window.CostosCalc;
  const D = { ok: false, loading: null, err: "", per: "dia", off: 0, cfg: { suba: 10, piso: 50, corte: 14, alertas: {} }, verHist: false, editCfg: false };
  const AJ = { suba: [5, 10, 15, 20], piso: [40, 50, 60, 65] };

  /* ---------- formatos ---------- */
  const fmt = (n) => "$" + Math.round(Math.abs(Number(n) || 0)).toLocaleString("es-AR");
  const money = (n) => (Number(n) < 0 ? "−" : "") + fmt(n);
  const corto = (n) => { const s = n < 0 ? "−" : ""; n = Math.abs(Math.round(n || 0)); return s + (n >= 1e6 ? "$" + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n); };
  const pct = (x) => (x == null || !isFinite(x) ? "—" : Math.round(x * 100) + "%");
  const cmpPct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const keyAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const horaAR = (iso) => +new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(iso)) % 24;
  const hoyK = () => keyAR(new Date());
  const diaK = (i) => { const d = new Date(hoyK() + "T12:00:00"); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10); };
  const fechaD = (k) => new Date(k + "T12:00:00");
  const diaNom = (i) => (i === 0 ? "Hoy" : i === 1 ? "Ayer" : fechaD(diaK(i)).toLocaleDateString("es-AR", { weekday: "long" }));
  const addK = (k, n) => { const d = fechaD(k); d.setDate(d.getDate() + n); return keyAR(d); };
  const rango = (a, b) => { const r = []; for (let k = a; k <= b; k = addK(k, 1)) r.push(k); return r; };
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const finMes = (k) => { const d = fechaD(k.slice(0, 8) + "01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return keyAR(d); };
  const mesAtras = (k, n) => { const d = fechaD(k.slice(0, 8) + "01"); d.setMonth(d.getMonth() - n); return keyAR(d); };
  const MAXOFF = { dia: 59, semana: 8, mes: 2 };
  // Período elegido (día / semana de lunes a domingo / mes calendario) y el anterior para comparar.
  // Si el período está en curso, se compara contra la misma cantidad de días del anterior (ej. 1 al 21 vs. 1 al 21).
  function periodo(per, off) {
    const hoy = hoyK();
    if (per === "dia") {
      const k = diaK(off), nom = fechaD(k).toLocaleDateString("es-AR", { weekday: "long" });
      return { keys: [k], prev: [addK(k, -7)], vs: `vs. ${nom} pasado`, label: `${off === 0 ? "Hoy" : off === 1 ? "Ayer" : nom} ${fechaD(k).getDate()}`, titulo: "Resumen del día" };
    }
    if (per === "semana") {
      const dow = (fechaD(hoy).getDay() + 6) % 7, lun = addK(hoy, -dow - 7 * off), dom = addK(lun, 6), fin = dom < hoy ? dom : hoy;
      const keys = rango(lun, fin), prev = keys.map((k) => addK(k, -7));
      return { keys, prev, todos: rango(lun, dom), vs: off === 0 ? `vs. los mismos ${keys.length} días de la semana pasada` : "vs. la semana anterior",
        label: off === 0 ? "Esta semana" : off === 1 ? "Semana pasada" : `${fCorta(lun)} al ${fCorta(dom)}`, sub: `lun ${fCorta(lun)} al dom ${fCorta(dom)}`, titulo: "Resumen de la semana" };
    }
    const ini = mesAtras(hoy, off), fm = finMes(ini), fin = fm < hoy ? fm : hoy, keys = rango(ini, fin);
    const pIni = mesAtras(hoy, off + 1), pFin = finMes(pIni), prev = rango(pIni, addK(pIni, keys.length - 1)).filter((k) => k <= pFin);
    const nomM = MESES[fechaD(ini).getMonth()], nomP = MESES[fechaD(pIni).getMonth()];
    return { keys, prev, todos: rango(ini, fm), vs: fin < fm ? `vs. ${nomP} al ${fechaD(prev[prev.length - 1]).getDate()}` : `vs. ${nomP}`,
      label: nomM + (fechaD(ini).getFullYear() !== fechaD(hoy).getFullYear() ? " " + fechaD(ini).getFullYear() : ""), sub: fin < fm ? `al ${fechaD(fin).getDate()} de ${nomM}, va en curso` : "mes completo", titulo: "Resumen del mes" };
  }
  const fCorta = (k) => fechaD(k).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
  const piso = () => (Number(D.cfg.piso) || 50) / 100;
  const tono = (m) => (m == null ? "na" : m >= Math.max(0.65, piso()) ? "ok" : m >= piso() ? "mid" : "low");
  const pill = (m, txt) => `<span class="kpill kt-${tono(m)}">${txt || (m === -Infinity ? "a pérdida" : pct(m))}</span>`;
  const n = (v, a, b) => v + " " + (v === 1 ? a : b);

  /* ---------- datos ---------- */
  async function load() {
    const desde = mesAtras(hoyK(), 3), desdeIso = new Date(desde + "T00:00:00-03:00").toISOString();
    const r = await Promise.all([
      sb.from("orders").select("id, code, phone, items, total, pago, modo, status, created_at").gte("created_at", new Date(new Date(desdeIso).getTime() - 3 * 864e5).toISOString()).order("created_at").limit(5000),
      sb.from("caja_movimientos").select("id, fecha, tipo, monto, categoria_id, registro, items, legacy_id, created_at").in("tipo", ["entrada", "gasto"]).eq("estado", "activo").gte("fecha", desde).limit(10000),
      sb.from("caja_categorias").select("id, nombre"),
      sb.from("caja_stock_mov").select("item_id, delta, created_at").eq("motivo", "venta").eq("estado", "activo").gte("created_at", desdeIso).limit(10000),
      sb.from("caja_stock_items").select("id, nombre"),
      sb.from("costo_insumos").select("*").order("orden"),
      sb.from("costo_precios").select("id, insumo_id, precio, paquete, fecha, lugar, registro, created_at").order("fecha").limit(10000),
      sb.from("costo_recetas").select("*").eq("activo", true),
      sb.from("costo_receta_lineas").select("*"),
      sb.from("products").select("id,categoria,nombre,formato,img,precio,precio_12,precio_16,set_bebida,set_mochi,activo,orden").order("orden"),
      sb.from("settings").select("value").eq("key", "costos_alertas").maybeSingle(),
      sb.from("costo_fijos").select("monto, activo").eq("activo", true),
    ]);
    const [o, m, c, s, it, ins, pre, rec, lin, prods, cfg, fj] = r;
    D.orders = fail(o); D.movs = fail(m); D.cats = {}; (c.data || []).forEach((x) => (D.cats[x.id] = x.nombre));
    D.stock = s.error ? null : { movs: s.data || [], items: {} }; if (D.stock) (it.data || []).forEach((x) => (D.stock.items[x.id] = x.nombre));
    D.costos = ins.error || pre.error || rec.error || lin.error ? null : CC.crear({ ins: ins.data, precios: pre.data, rec: rec.data, lin: lin.data, prods: fail(prods) });
    D.prods = prods.data || [];
    // costos fijos (migración 072): % de cada venta, con lo facturado en los últimos 28 días
    D.fijos = fj.error ? null : CC.tasaFijos(fj.data || [], D.movs.filter((x) => x.tipo === "entrada"), hoyK());
    D.cfg = Object.assign({ suba: 10, piso: 50, corte: 14, alertas: {} }, (cfg.data || {}).value || {});
    D.maq = await maqStats().catch(() => null);
    D.ok = true; D.err = ""; D.at = new Date();
    await registrarAlertas();
  }
  async function maqStats() {
    const [t, p, u] = await Promise.all([
      sb.from("maq_tiradas").select("created_at, resultado, gratis, dev, phone").order("created_at").limit(20000),
      sb.from("maq_premios").select("id, titulo, estado, vence_at, created_at").limit(10000),
      sb.from("maq_premio_usos").select("premio_id, monto, devuelto").eq("devuelto", false).limit(10000),
    ]);
    if (t.error || p.error) return null;
    return { tiradas: t.data || [], premios: p.data || [], usos: u.error ? [] : u.data || [] };
  }
  async function guardarCfg(cambios, msg) {
    const v = Object.assign({}, D.cfg, cambios);
    const { error } = await sb.from("settings").upsert({ key: "costos_alertas", value: v, updated_at: new Date().toISOString() });
    if (error) { toast(error.message); return false; }
    D.cfg = v; if (msg) toast(msg); return true;
  }
  function cargar(force) {
    if (D.loading) return D.loading;
    if (D.ok && !force) return Promise.resolve();
    D.loading = load().catch((e) => { D.err = e.message; }).finally(() => { D.loading = null; pendientes(); if (K.view() === "dash") view(); else K.refrescar(); });
    return D.loading;
  }

  /* ---------- ventas con su costo ---------- */
  function turnoDe(iso, fecha) {
    if (!iso || keyAR(new Date(iso)) !== fecha) return "despues";
    return horaAR(iso) < (Number(D.cfg.corte) || 14) ? "manana" : "tarde";
  }
  const TURNOS = { manana: "Mañana", tarde: "Tarde", despues: "Cargadas después" };
  // suma todo lo de un conjunto de días (claves AAAA-MM-DD)
  function suma(keys) {
    const ks = new Set(keys), ordPor = {};
    D.orders.forEach((o) => (ordPor[o.id] = o));
    const A = { ent: 0, gas: 0, canales: {}, webN: 0, webTot: 0, canc: 0, prods: {}, mochis: {}, mochisN: 0, horas: {}, pagos: {}, modos: {}, tels: {}, dias: {},
      rc: 0, cost: 0, sinDet: 0, turnos: {}, gasCat: {}, horasF: {}, tkN: 0, tkV: 0, ventas: 0 };
    keys.forEach((k) => (A.dias[k] = { web: 0, otros: 0, n: 0, rc: 0, cost: 0, gas: 0 }));
    const T = (t) => A.turnos[t] || (A.turnos[t] = { ent: 0, rc: 0, cost: 0, n: 0 });
    D.orders.forEach((o) => {
      const k = keyAR(new Date(o.created_at)); if (!ks.has(k)) return;
      if (o.status === "cancelado") { A.canc++; return; }
      A.webN++; A.webTot += o.total || 0; A.dias[k].n++;
      const h = horaAR(o.created_at); A.horas[h] = (A.horas[h] || 0) + 1;
      const pg = o.pago || "Sin dato"; A.pagos[pg] = (A.pagos[pg] || 0) + (o.total || 0);
      const md = o.modo === "envio" ? "Envío" : "Retiro"; A.modos[md] = (A.modos[md] || 0) + 1;
      if (o.phone) A.tels[o.phone] = (A.tels[o.phone] || 0) + 1;
    });
    D.movs.forEach((m) => {
      if (!ks.has(m.fecha)) return; const v = +m.monto || 0;
      if (m.tipo === "gasto") { A.gas += v; A.dias[m.fecha].gas += v; const gc = D.cats[m.categoria_id] || "Sin categoría"; A.gasCat[gc] = (A.gasCat[gc] || 0) + v; return; }
      const web = m.registro === "Pedidos web", c = web ? "Pedidos web" : D.cats[m.categoria_id] || "Sin categoría";
      A.ent += v; A.ventas++; A.canales[c] = (A.canales[c] || 0) + v; A.dias[m.fecha][web ? "web" : "otros"] += v;
      // productos de la venta: los del pedido web (legacy_id pedido:<id>) o los cargados en la entrada
      const ord = /^pedido:/.test(m.legacy_id || "") ? ordPor[m.legacy_id.slice(7)] : null;
      const items = ord ? ord.items || [] : m.items || [], cuando = ord ? ord.created_at : m.created_at, t = T(turnoDe(cuando, m.fecha));
      t.ent += v; t.n++;
      if (cuando && keyAR(new Date(cuando)) === m.fecha) { const h = horaAR(cuando); A.horasF[h] = (A.horasF[h] || 0) + v; }
      // ticket promedio: solo ventas sueltas (web o cargadas con productos); las apps y cafeterías se cargan en un total por día
      if (ord || (items && items.length)) { A.tkN++; A.tkV += v; }
      let cost = 0, ok = !!D.costos && items.some((i) => !CC.NO_PROD.includes(i.id));
      const calc = D.costos && D.costos.en(m.fecha);
      items.forEach((i) => {
        if (CC.NO_PROD.includes(i.id)) return;
        const q = +i.qty || 0, nom = String(i.nombre || i.id).trim(), x = A.prods[nom] || (A.prods[nom] = { q: 0, m: 0, cost: 0, mc: 0, ok: true });
        const rev = i.subtotal != null ? +i.subtotal || 0 : q * (+i.precio || 0);
        x.q += q; x.m += rev;
        const c2 = calc ? calc.item(i) : { ok: false };
        if (c2.ok) { cost += c2.cost; x.cost += c2.cost; x.mc += rev; } else { ok = false; x.ok = false; }
      });
      if (ok) { A.rc += v; A.cost += cost; t.rc += v; t.cost += cost; A.dias[m.fecha].rc += v; A.dias[m.fecha].cost += cost; }
      else A.sinDet += v;
    });
    if (D.stock) D.stock.movs.forEach((m) => {
      const k = keyAR(new Date(m.created_at)); if (!ks.has(k)) return;
      const nm = D.stock.items[m.item_id] || "Otro"; A.mochis[nm] = (A.mochis[nm] || 0) - (m.delta || 0); A.mochisN -= m.delta || 0;
    });
    A.gan = A.rc - A.cost; A.mg = A.rc > 0 ? A.gan / A.rc : null;
    return A;
  }

  /* ---------- márgenes de la carta y subas de insumos ---------- */
  function carta() { return D.costos ? D.costos.carta() : []; }
  // una suba por insumo: la última, si supera el umbral. Las anteriores quedan en el historial.
  function alertas() {
    if (!D.costos) return [];
    const umbral = (Number(D.cfg.suba) || 10) / 100, hoyC = D.costos.en(null), filas = carta(), A = D.cfg.alertas || {};
    return D.costos.cambios().filter((c) => c.d >= umbral - 1e-9).map((c) => {
      const usa = D.costos.usaInsumo(c.iid), antes = D.costos.en(null, { [c.iid]: c.pa });
      const reg = A[c.id] || {};
      const prods = filas.filter((f) => f.ok && f.pr > 0 && usa(f.p, f.t)).map((f) => {
        const c0 = antes.prod(f.p, f.t).cost, c1 = hoyC.prod(f.p, f.t).cost, pr0 = (reg.precios || {})[f.key] || f.pr;
        const m0 = (pr0 - c0) / pr0, m1 = (f.pr - c1) / f.pr, obj = Math.max(m0, 0);
        // para ganar los mismos pesos que antes alcanza con sumar lo que subió el costo; para el mismo % hace falta más
        const sug = Math.ceil((pr0 + c1 - c0) / 100) * 100, sugPct = CC.precioPara(c1, Math.min(obj, 0.95));
        return { f, c0, c1, pr0, m0, m1, sug, sugPct, falta: c.ultimo && f.pr + 0.5 < sug && (m1 < m0 - 0.01 || (m1 < piso() && m0 >= piso())) };
      }).filter((x) => x.c1 - x.c0 > 0.005).sort((a, b) => b.falta - a.falta || (a.m1 - a.m0) - (b.m1 - b.m0));
      const flojos = prods.filter((x) => x.falta || x.m1 < piso());
      const estado = !c.ultimo ? "historial" : reg.estado === "ok" ? "dejada" : prods.some((x) => x.falta) ? "pendiente" : "resuelta";
      return { c, prods, flojos, estado, reg };
    });
  }
  // la primera vez que se ve una suba, se guarda el precio de carta de cada producto afectado (para medir si se recuperó)
  async function registrarAlertas() {
    if (!D.costos) return;
    const umbral = (Number(D.cfg.suba) || 10) / 100, A = Object.assign({}, D.cfg.alertas || {}), filas = carta();
    let nuevo = false;
    D.costos.cambios().filter((c) => c.ultimo && c.d >= umbral - 1e-9 && !A[c.id]).forEach((c) => {
      const usa = D.costos.usaInsumo(c.iid), precios = {};
      filas.filter((f) => f.pr > 0 && usa(f.p, f.t)).forEach((f) => (precios[f.key] = f.pr));
      A[c.id] = { at: new Date().toISOString(), precios }; nuevo = true;
    });
    if (nuevo) await guardarCfg({ alertas: A });
  }

  /* ---------- piezas de dibujo ---------- */
  const orden = (o, f = (v) => v) => Object.entries(o).map(([l, v]) => [l, f(v)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const tile = (lbl, val, sub, cmp, cls) => `<div class="kpi ${cls || ""}"><div class="k">${lbl}</div><div class="v num">${val}</div>${cmp != null ? `<div class="dsub ${!cmp ? "" : (cmp > 0) !== /\binv\b/.test(cls || "") ? "dsub-up" : "dsub-down"}">${cmp > 0 ? "▲ +" : cmp < 0 ? "▼ " : "= "}${cmp}% ${sub}</div>` : sub ? `<div class="dsub">${sub}</div>` : ""}</div>`;
  const barras = (rows, f, vacio) => {
    if (!rows.length) return `<p class="hintp">${vacio || "Sin datos."}</p>`;
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return `<ul class="dbars">${rows.map(([l, v, sub]) => `<li title="${esc(l)}: ${esc(f(v))}"><span class="dl">${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="dtrack"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></span><b class="num">${f(v)}</b></li>`).join("")}</ul>`;
  };
  // columnas (apiladas si hay dos series): cols = [{l, v:[a, b], tip, on, top}]
  const columnas = (cols, f, cls) => {
    const max = Math.max(...cols.map((c) => c.v.reduce((a, b) => a + b, 0)), 1);
    return `<div class="dcolch ${cls || ""}" style="--n:${cols.length}">${cols.map((c) => { const t = c.v.reduce((a, b) => a + b, 0);
      return `<div class="dcol ${c.on ? "on" : ""}" title="${esc(c.tip)}"><span class="dcv num">${c.top != null ? c.top : t ? f(t) : ""}</span><span class="dstack">${c.v.map((v, i) => v ? `<i class="s${i}" style="height:${(v / max) * 100}%"></i>` : "").join("")}</span><span class="dcl">${esc(c.l)}</span></div>`; }).join("")}</div>`;
  };
  const diaCorto = (k) => { const d = fechaD(k).getDate(); return d === 1 || d % 5 === 0 ? String(d) : "\u00a0"; };
  const colDia = (k) => { const d = fechaD(k); return d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "") + " " + d.getDate(); };
  const cobertura = (A) => {
    if (!D.costos) return `<p class="note">Falta instalar los costos (migración 070): sin eso no se puede calcular la ganancia.</p>`;
    return "";
  };

  // Dos lecturas del mismo período:
  //  · Ganancia neta = Facturado − costo de mercadería y packaging de lo vendido (recetas, precio de ese día).
  //    Las entradas sin productos se costean con el mismo % de costo que las que sí tienen productos (estimado).
  //  · Te queda = Facturado − Gastado (todo lo cargado como gasto en la Caja). Son cuentas separadas:
  //    no se restan las dos cosas juntas porque los insumos ya están en los gastos (sería contarlos dos veces).
  const merc = (A) => (A.rc > 0 ? Math.round((A.ent * A.cost) / A.rc) : A.ent ? null : 0);
  function netoHTML(A, Ap, vs) {
    const neto = A.ent - A.gas, netoP = Ap ? Ap.ent - Ap.gas : null, max = Math.max(A.ent, A.gas, 1);
    const cM = merc(A), gn = cM == null ? null : A.ent - cM, cMp = Ap ? merc(Ap) : null, gnP = cMp == null || !Ap ? null : Ap.ent - cMp;
    const cmp = (a, b) => (a != null && b > 0 ? cmpPct(a, b) : null);
    const bar = (v, cls) => `<span class="dnb"><i class="${cls}" style="width:${v == null ? 0 : Math.max(v > 0 ? 2 : 0, (Math.abs(v) / max) * 100)}%"></i></span>`;
    const cifra = (lbl, v, c, cls, bc, sub, inv) => `<div class="dnc ${cls}"><span class="k">${lbl}</span><b class="num">${v == null ? "—" : money(v)}</b>${bar(v, bc)}<span class="dns">${sub}${c != null ? ` <small class="${!c ? "" : (c > 0) !== !!inv ? "dsub-up" : "dsub-down"}">${c > 0 ? "▲ +" : c < 0 ? "▼ " : "= "}${c}%</small>` : ""}</span></div>`;
    const cats = orden(A.gasCat), est = A.rc > 0 && A.rc < A.ent * 0.995;
    // Ganancia final = ganancia neta − los costos fijos del período (lo del mes prorrateado por los días que van: alquiler, luz, gas…)
    const fdia = D.fijos && D.fijos.total > 0 ? D.fijos.total / 30 : 0, tf = fdia > 0, nd = Object.keys(A.dias).length, fA = fdia * nd;
    const gf = gn == null ? null : gn - fA, gfP = gnP == null || !Ap ? null : gnP - fdia * Object.keys(Ap.dias).length;
    return `<div class="dneto">
        <div class="dncs ${tf ? "d6" : ""}">
          ${cifra("Facturado (bruto)", A.ent, Ap ? cmp(A.ent, Ap.ent) : null, "f", "n0", "todo lo que entró")}
          ${cifra("Ganancia neta", gn, Ap ? cmp(gn, gnP) : null, gn != null && gn < 0 ? "q neg" : "q", gn != null && gn < 0 ? "n3" : "n2", cM == null ? "sin ventas con productos" : `− ${money(cM)} de mercadería${est ? "*" : ""}`)}
          ${tf ? `${cifra("Costos fijos", fA, null, "fx", "n1", nd === 1 ? "lo de un día" : `${nd} días × ${money(fdia)}`)}
          ${cifra("Ganancia final", gf, Ap ? cmp(gf, gfP) : null, gf != null && gf < 0 ? "q neg" : "q", gf != null && gf < 0 ? "n3" : "n2", "neta − fijos")}` : ""}
          ${cifra("Gastado", A.gas, Ap ? cmp(A.gas, Ap.gas) : null, "g", "n1", "gastos de la Caja", true)}
          ${cifra("Te queda en caja", neto, Ap && netoP > 0 ? cmp(neto, netoP) : null, neto < 0 ? "c neg" : "c", neto < 0 ? "n3" : "n2", "facturado − gastado")}
        </div>
        <p class="dncat">${cats.length ? `Gastado en: ${cats.map(([c, v]) => `${esc(c)} <b>${money(v)}</b>`).join(" · ")}` : "Sin gastos cargados."}${est ? `<br>* Mercadería = insumos y packaging de lo vendido, según las recetas. Estimada en parte: ${money(A.sinDet)} se cargó sin productos y se calcula con el mismo % de costo que el resto (${pct(A.cost / A.rc)}).` : ""}${tf ? `<br>Costos fijos: ${money(D.fijos.total)} por mes (Costos → Fijos), ${money(fdia)} por cada día del período, vendas lo que vendas. Si alquiler o servicios también están cargados como gasto, Te queda en caja ya los descuenta.` : D.fijos ? `<br>¿Querés ver la ganancia final con alquiler, luz y gas? <button type="button" class="linkbtn" data-go="costos" data-ktab="fijos">Cargá los costos fijos ›</button>` : ""}${Ap ? `<br>Flechas: ${vs}.` : ""}</p>
      </div>`;
  }
  // dos barras por día (facturado y gastado) con lo que quedó arriba
  function parDias(cols, dense) {
    const max = Math.max(1, ...cols.map((c) => Math.max(c.f, c.g)));
    return `<div class="dcolch dpar ${dense ? "dense" : ""}" style="--n:${cols.length}">${cols.map((c) => { const q = c.f - c.g;
      return `<div class="dcol ${c.on ? "on" : ""} ${c.fut ? "fut" : ""}" title="${esc(c.tip)}"><span class="dcv num ${q < 0 ? "dneg" : "dpos"}">${c.f || c.g ? (q < 0 ? "−" : "+") + corto(Math.abs(q)).replace("−", "") : ""}</span>
        <span class="dpb"><i class="n0" style="height:${(c.f / max) * 100}%"></i><i class="n1" style="height:${(c.g / max) * 100}%"></i></span><span class="dcl">${esc(c.l)}</span></div>`; }).join("")}</div>`;
  }

  /* ---------- vista ---------- */
  // Estructura (como los dashboards de POS: Square, Toast, Shopify, Fudo):
  // 1) selector de período + navegación · 2) cifras clave con comparación · 3) lo destacado en una línea cada cosa
  // 4) evolución en el tiempo · 5) productos · 6) canales, pagos y turnos · 7) gastos · y después carta, subas y maquinita.
  function view() {
    const el = $("#view"); if (!el) return;
    if (!D.ok) {
      el.innerHTML = `<h1 class="h1">Dashboard</h1>${D.err ? `<p class="note">No se pudo cargar: ${esc(D.err)}</p>` : `<div class="loading">Cargando números…</div>`}`;
      if (!D.err) cargar(); return;
    }
    const per = D.per, P = periodo(per, D.off), A = suma(P.keys), Ap = suma(P.prev), nd = P.keys.length, hoy = hoyK();
    const prodRows = (X) => orden(X.prods, (x) => x.q).slice(0, per === "dia" ? 6 : 8).map(([l, q]) => [l, q, money(X.prods[l].m)]);
    const unid = (v) => v + " u.";
    const cmp = (a, b) => (b > 0 ? cmpPct(a, b) : null);
    const diaLargo = (k) => fechaD(k).toLocaleDateString("es-AR", { weekday: "long", day: "numeric" });
    const fact = (k) => A.dias[k] ? A.dias[k].web + A.dias[k].otros : 0;
    const repit = Object.values(A.tels).filter((x) => x > 1).length, clientes = Object.keys(A.tels).length;
    const tk = A.tkN ? A.tkV / A.tkN : null, tkP = Ap.tkN ? Ap.tkV / Ap.tkN : null;
    const al = alertas(), pend = pendientes();

    // --- lo destacado ---
    const dest = [];
    if (per !== "dia") { const mj = P.keys.map((k) => [k, fact(k)]).sort((a, b) => b[1] - a[1])[0];
      if (mj && mj[1] > 0) dest.push(["📅", "Mejor día", `${diaLargo(mj[0])} · ${money(mj[1])}`]); }
    const hp = orden(A.horasF)[0]; if (hp) dest.push(["⏰", "Hora pico", `${hp[0]} a ${+hp[0] + 1} h · ${money(hp[1])}`]);
    const pq = orden(A.prods, (x) => x.q)[0]; if (pq) dest.push(["⭐", "Lo más vendido", `${esc(pq[0])} · ${unid(pq[1])}`]);
    const pg = Object.entries(A.prods).filter(([, x]) => x.mc > 0).map(([l, x]) => [l, x.mc - x.cost]).sort((a, b) => b[1] - a[1])[0];
    if (pg && (!pq || pg[0] !== pq[0])) dest.push(["💰", "El que más dejó", `${esc(pg[0])} · ${money(pg[1])}`]);
    const ch = orden(A.canales)[0]; if (ch && A.ent) dest.push(["🛍️", "Canal principal", `${esc(ch[0])} · ${pct(ch[1] / A.ent)} de lo facturado`]);
    const gc = orden(A.gasCat)[0]; if (gc) dest.push(["🧾", "Mayor gasto", `${esc(gc[0])} · ${money(gc[1])}${A.ent ? ` (${pct(gc[1] / A.ent)} de lo facturado)` : ""}`]);

    // --- evolución ---
    let evol = "";
    const horasCh = (X) => { const hs = Object.keys(X.horasF).map(Number); if (!hs.length) return `<p class="hintp">Sin ventas con hora.</p>`;
      const a = Math.min(...hs), b = Math.max(...hs), cols = [];
      for (let h = a; h <= b; h++) cols.push({ l: String(h), v: [X.horasF[h] || 0], tip: `${h}:00 a ${h}:59 · ${money(X.horasF[h] || 0)}` });
      return columnas(cols, corto, cols.length > 7 ? "mdense" : "") + `<p class="hintp">Hora en que se cobró cada venta (web y Local). Lo cargado después en la Caja no tiene hora.</p>`; };
    if (per === "dia") evol = `<div class="dcard wide2"><b>Ventas por hora</b>${horasCh(A)}</div>`;
    else {
      const todos = P.todos, dense = todos.length > 10;
      evol = `<div class="dcard wide2"><b>Facturado y gastado por día</b>
          <div class="dleg"><span><i class="n0"></i>Facturado</span><span><i class="n1"></i>Gastado</span>${dense ? "" : `<span>Arriba: lo que te quedó ese día</span>`}</div>
          ${parDias(todos.map((k) => { const x = A.dias[k] || { web: 0, otros: 0, gas: 0 }, f = x.web + x.otros;
            return { l: dense ? diaCorto(k) : colDia(k), on: k === hoy, fut: k > hoy, f, g: x.gas, tip: `${diaLargo(k)}: facturado ${money(f)}, gastado ${money(x.gas)}, te quedó ${money(f - x.gas)}` }; }), dense)}
          <p class="hintp">Los gastos se cargan el día que se compra (ej. insumos para toda la semana), así que un día puede dar negativo aunque ${per === "mes" ? "el mes" : "la semana"} dé bien.</p></div>`;
      if (per === "mes") {
        const DS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"], sumD = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
        P.keys.forEach((k) => { const w = (fechaD(k).getDay() + 6) % 7; sumD[w] += fact(k); cnt[w]++; });
        evol += `<div class="dcard"><b>Promedio por día de la semana</b>${columnas(DS.map((l, i) => ({ l, v: [cnt[i] ? sumD[i] / cnt[i] : 0], tip: `${l}: promedio ${money(cnt[i] ? sumD[i] / cnt[i] : 0)} en ${n(cnt[i], "día", "días")}` })), corto)}
          <p class="hintp">Sirve para decidir horarios, personal y promos de los días flojos.</p></div>`;
      }
      evol += `<div class="dcard"><b>Ventas por hora</b>${horasCh(A)}</div>`;
    }

    const kp = (lbl, val, sub, c, cls) => tile(lbl, val, c != null ? "" : sub, c, cls);
    $("#view").innerHTML = `<div class="cdash">
      <div class="dtop">
        <h1 class="h1">Dashboard</h1>
        <div class="dper" role="tablist">${[["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"]].map(([k, l]) => `<button type="button" role="tab" data-dper="${k}" aria-selected="${per === k}">${l}</button>`).join("")}</div>
        <div class="dnav"><button type="button" data-dd="1" ${D.off >= MAXOFF[per] ? "disabled" : ""} aria-label="Anterior">‹</button><span>${esc(P.label)}</span><button type="button" data-dd="-1" ${D.off <= 0 ? "disabled" : ""} aria-label="Siguiente">›</button></div>
      </div>
      ${pend.length ? `<button class="dalert" data-dsec="subas"><b>⚠ ${n(pend.length, "insumo subió", "insumos subieron")}</b><span>${pend.map((a) => esc(a.c.insumo.nombre) + " +" + pct(a.c.d)).join(" · ")} · ${n(pend.reduce((x, a) => x + a.prods.filter((p) => p.falta).length, 0), "producto quedó", "productos quedaron")} con menos margen</span><i>›</i></button>` : ""}

      <section class="dsec">
        <div class="dhead"><h2 class="dh2">${P.titulo}</h2>${P.sub ? `<span class="hintp">${esc(P.sub)}</span>` : ""}</div>
        ${netoHTML(A, Ap, P.vs)}
        <div class="kpis dk">
          ${kp("Ventas", String(A.ventas), A.ventas ? "cobros cargados" : "ninguna", cmp(A.ventas, Ap.ventas))}
          ${kp("Ticket promedio", tk ? money(tk) : "—", A.tkN ? `en ${n(A.tkN, "venta suelta", "ventas sueltas")}` : "sin ventas sueltas", tk && tkP ? cmpPct(tk, tkP) : null)}
          ${per !== "dia" ? tile("Facturado por día", money(A.ent / nd), `promedio de ${n(nd, "día", "días")}`) : kp("Pedidos web", String(A.webN), A.webN ? `ticket ${money(A.webTot / A.webN)}` : "ninguno", cmp(A.webN, Ap.webN))}
          ${tile("Clientes web", String(clientes), clientes ? (repit ? `${repit} volvieron a pedir` : "distintos") : "ninguno")}
        </div>
        ${cobertura(A)}
        ${dest.length ? `<div class="ddest"><b>Lo destacado</b><ul>${dest.map(([i, k, v]) => `<li><span class="di" aria-hidden="true">${i}</span><span class="dk2">${k}</span><span class="dv">${v}</span></li>`).join("")}</ul></div>` : ""}
      </section>

      <section class="dsec">
        <div class="dhead"><h2 class="dh2">${per === "dia" ? "Durante el día" : "Cómo fue " + (per === "mes" ? "el mes" : "la semana")}</h2></div>
        <div class="dcols">${evol}</div>
      </section>

      <section class="dsec">
        <div class="dhead"><h2 class="dh2">Productos</h2></div>
        <div class="dcols">
          <div class="dcard"><b>Lo más vendido</b>${barras(prodRows(A), unid, "Sin pedidos web ni ventas cargadas con productos.")}</div>
          <div class="dcard"><b>Lo que más dejó</b>${ganProdHTML(A)}</div>
          ${D.stock ? `<div class="dcard"><b>Mochis por sabor</b>${barras(orden(A.mochis), unid, "Sin mochis descontados del stock.")}</div>` : ""}
        </div>
      </section>

      <section class="dsec">
        <div class="dhead"><h2 class="dh2">Canales y turnos</h2></div>
        <div class="dcols">
          <div class="dcard"><b>Por canal</b>${barras(orden(A.canales).map(([l, v]) => [l, v, A.ent ? pct(v / A.ent) : ""]), money, "Sin entradas en la Caja.")}</div>
          <div class="dcard"><b>Margen por turno</b>${turnosHTML(A)}</div>
          ${A.webN ? `<div class="dcard"><b>Formas de pago (web)</b>${barras(orden(A.pagos), money)}</div>` : ""}
          ${A.webN ? `<div class="dcard"><b>Retiro o envío (web)</b>${barras(orden(A.modos), (v) => n(v, "pedido", "pedidos"))}</div>` : ""}
        </div>
      </section>

      <section class="dsec">
        <div class="dhead"><h2 class="dh2">Gastos</h2><span class="hintp">${money(A.gas)}${A.ent ? ` · ${pct(A.gas / A.ent)} de lo facturado` : ""}</span></div>
        <div class="dcols">
          <div class="dcard"><b>Por categoría</b>${barras(orden(A.gasCat).map(([l, v]) => [l, v, A.ent ? pct(v / A.ent) + " de lo facturado" : ""]), money, "Sin gastos cargados.")}</div>
          <div class="dcard"><b>Contra ${per === "dia" ? "el mismo día de la semana pasada" : per === "mes" ? "el mes anterior" : "la semana anterior"}</b>${barras(orden(Object.fromEntries([...new Set([...Object.keys(A.gasCat), ...Object.keys(Ap.gasCat)])].map((c) => [c, (A.gasCat[c] || 0) + 0.001]))).map(([c]) => { const a = A.gasCat[c] || 0, b = Ap.gasCat[c] || 0;
            return [c, a, b ? `antes ${money(b)}${a !== b ? ` · ${a > b ? "▲" : "▼"} ${Math.abs(cmpPct(a, b))}%` : ""}` : "nuevo"]; }), money, "Sin gastos en ninguno de los dos períodos.")}</div>
        </div>
      </section>
      ${cartaHTML()}
      ${subasHTML(al)}
      ${maqSec(P)}
      <p class="hintp">Actualizado ${D.at ? D.at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : ""} · <button type="button" class="linkbtn" data-dre>Actualizar</button>${A.canc ? ` · ${n(A.canc, "pedido web cancelado", "pedidos web cancelados")} en el período (no suman)` : ""}</p>
    </div>`;
  }

  function turnosHTML(A) {
    const fila = (k) => { const t = A.turnos[k]; if (!t || !t.ent) return "";
      const m = t.rc ? (t.rc - t.cost) / t.rc : null;
      return `<div class="dtr"><span class="dtn"><b>${TURNOS[k]}</b><small>${n(t.n, "venta", "ventas")}${k === "despues" ? " · se cargaron otro día" : k === "manana" ? ` · antes de las ${D.cfg.corte || 14}` : ` · desde las ${D.cfg.corte || 14}`}</small></span>
        <span class="dtc"><small>Vendido</small>${money(t.ent)}</span><span class="dtc"><small>Ganancia</small>${t.rc ? money(t.rc - t.cost) : "—"}</span>${t.rc ? pill(m) : `<span class="kpill kt-na">sin detalle</span>`}</div>`; };
    const rows = ["manana", "tarde", "despues"].map(fila).join("");
    return rows ? `<div class="dtrs">${rows}</div><p class="hintp">La ganancia y el margen salen solo de las ventas con productos. Turno según la hora en que entró la venta.</p>` : `<p class="hintp">Sin ventas.</p>`;
  }
  function ganProdHTML(A) {
    const rows = Object.entries(A.prods).filter(([, x]) => x.mc > 0).map(([l, x]) => ({ l, g: x.mc - x.cost, m: (x.mc - x.cost) / x.mc, q: x.q })).sort((a, b) => b.g - a.g).slice(0, 8);
    if (!rows.length) return `<p class="hintp">Sin productos con costo completo en la semana.</p>`;
    const max = Math.max(...rows.map((r) => r.g), 1);
    return `<ul class="dbars dgp">${rows.map((r) => `<li title="${esc(r.l)}: ganancia ${money(r.g)} (${pct(r.m)}) en ${r.q} u."><span class="dl">${esc(r.l)}<small>${r.q} u.</small></span><span class="dtrack"><i style="width:${Math.max(3, (Math.max(0, r.g) / max) * 100)}%"></i></span><b class="num">${money(r.g)}</b>${pill(r.m)}</li>`).join("")}</ul>
      <p class="hintp">Lo que dejó cada producto con el precio cobrado (sin descontar códigos ni premios del pedido).</p>`;
  }
  function cartaHTML() {
    if (!D.costos) return "";
    const fs = carta(), ok = fs.filter((f) => f.ok && f.pr > 0), prom = ok.length ? ok.reduce((a, f) => a + f.m, 0) / ok.length : null;
    const bajo = ok.filter((f) => f.m < piso()).sort((a, b) => a.m - b.m), perd = ok.filter((f) => f.m < 0);
    const nom = (f) => esc(String(f.p.nombre).trim()) + (f.t ? ` <small>${esc(f.t)}</small>` : "");
    return `<section class="dsec">
        <div class="dhead"><h2 class="dh2">Márgenes de la carta</h2><span class="hintp">Con los precios de hoy</span></div>
        <div class="kpis dk">
          ${tile("Margen promedio", pct(prom), `${ok.length} de ${fs.length} con costo completo`)}
          ${tile(`Bajo el piso (${pct(piso())})`, String(bajo.length), bajo.length ? "productos" : "ninguno", null, bajo.length ? "warn" : "")}
          ${tile("A pérdida", String(perd.length), perd.length ? "cuestan más de lo que cobrás" : "ninguno", null, perd.length ? "warn" : "")}
        </div>
        <div class="dcols">
          <div class="dcard"><b>Los de menos margen</b>${ok.length ? `<div class="items dlist">${ok.slice().sort((a, b) => a.m - b.m).slice(0, 6).map((f) => `<div class="it"><span class="t"><b>${nom(f)}</b><span>Costo ${money(f.cost)} · precio ${money(f.pr)}${f.m < piso() ? ` · para llegar al ${pct(piso())}: ${money(CC.precioPara(f.cost, piso()))}` : ""}</span></span><span class="side kside">${pill(f.m)}</span></div>`).join("")}</div>` : `<p class="hintp">Cargá recetas y precios en Costos.</p>`}</div>
          <div class="dcard"><b>Más gráficos</b><p class="hintp">Costo y lo que te queda por producto, qué insumos pesan más y el simulador "¿y si sube?".</p>
            <button class="btn" data-go="costos" data-ktab="graficos">Ver gráficos de costos ›</button></div>
        </div></section>`;
  }
  function subasHTML(al) {
    if (!D.costos) return "";
    const act = al.filter((a) => a.estado !== "historial"), hist = al.filter((a) => a.estado === "historial");
    const ord = { pendiente: 0, resuelta: 1, dejada: 2 };
    act.sort((a, b) => ord[a.estado] - ord[b.estado] || b.c.d - a.c.d);
    const unidad = (u) => (u === "u" ? "c/u" : u === "g" ? "el kg" : "el litro"), mult = (u) => (u === "u" ? 1 : 1000);
    const pp = (c, p) => `${money(p * mult(c.insumo.unidad))} ${unidad(c.insumo.unidad)}`;
    const est = { pendiente: ["Pendiente", "kt-low"], resuelta: ["Recuperado", "kt-ok"], dejada: ["Lo dejaste así", "kt-na"], historial: ["Subió después", "kt-na"] };
    const filaP = (p) => `<div class="it"><span class="t"><b>${esc(String(p.f.p.nombre).trim())}${p.f.t ? ` <small>${esc(p.f.t)}</small>` : ""}</b>
        <span>Costo ${money(p.c0)} → ${money(p.c1)} · margen ${pct(p.m0)} → ${pct(p.m1)}${p.falta && p.sugPct > p.sug ? ` · para volver al ${pct(p.m0)}: ${money(p.sugPct)}` : ""}</span></span>
        <span class="side kside">${p.falta ? `<small class="dsug">Subilo a</small><b class="num">${money(p.sug)}</b><small class="dsug">hoy ${money(p.f.pr)}</small>` : p.f.pr !== p.pr0 ? `<span class="kpill kt-ok">Ya lo subiste</span>` : `<span class="kpill kt-${tono(p.m1)}">${pct(p.m1)}</span>`}</span></div>`;
    const card = (a) => { const { c } = a, [el, ec] = est[a.estado];
      return `<article class="dsuba ${a.estado}">
        <div class="dsh"><span><b>${esc(c.insumo.nombre)}</b> <span class="dup">▲ ${pct(c.d)}</span></span><span class="kpill ${ec}">${el}</span></div>
        <p class="dsm">${pp(c, c.pa)} → <b>${pp(c, c.pb)}</b> · ${fCorta(c.ahora.fecha)}${c.ahora.lugar ? " · " + esc(c.ahora.lugar) : ""}${c.ahora.registro ? " · cargó " + esc(c.ahora.registro) : ""}</p>
        ${a.prods.length ? `<div class="items dlist">${a.prods.slice(0, 4).map(filaP).join("")}</div>
          ${a.prods.length > 4 ? `<details class="dmas"><summary>Ver ${a.prods.length - 4} más</summary><div class="items dlist">${a.prods.slice(4).map(filaP).join("")}</div></details>` : ""}`
        : `<p class="hintp">No está en ningún producto con costo completo.</p>`}
        ${a.estado === "pendiente" ? `<div class="acts"><a class="btn" href="panel.html#carta">Cambiar precios en la Carta</a><button class="linkbtn" data-dok="${esc(c.id)}">Dejarlo así</button></div>` : ""}
        ${a.estado === "dejada" ? `<p class="hintp">Marcado por ${esc(a.reg.por || "alguien")} el ${a.reg.ok_at ? fCorta(keyAR(new Date(a.reg.ok_at))) : ""}. <button class="linkbtn" data-dreab="${esc(c.id)}">Volver a avisar</button></p>` : ""}
      </article>`; };
    const todos = D.costos.cambios();
    const histRows = todos.slice(0, 40).map((c) => `<div class="it"><span class="t"><b>${esc(c.insumo.nombre)}</b><span>${fCorta(c.ahora.fecha)} · ${pp(c, c.pa)} → ${pp(c, c.pb)}${c.ahora.lugar ? " · " + esc(c.ahora.lugar) : ""}</span></span>
      <span class="side kside"><b class="num ${c.d > 0.005 ? "dup" : c.d < -0.005 ? "ddown" : ""}">${c.d > 0.005 ? "▲ " : c.d < -0.005 ? "▼ " : "= "}${pct(Math.abs(c.d))}</b></span></div>`).join("");
    return `<section class="dsec" id="dsubas">
        <div class="dhead"><h2 class="dh2">Subas de insumos</h2><button type="button" class="linkbtn" data-dcfg>Avisar desde +${D.cfg.suba}% · piso ${D.cfg.piso}%</button></div>
        ${D.editCfg ? cfgHTML() : ""}
        <p class="hintp">Cuando cargás un precio que sube ${D.cfg.suba}% o más, ves qué productos pierden margen (1 punto o más) y a cuánto subirlos para seguir ganando los mismos pesos que antes (y, si querés, el mismo %). Queda pendiente hasta que actualices el precio en la Carta o lo dejes así.</p>
        ${act.length ? `<div class="dsubas">${act.map(card).join("")}</div>` : `<p class="dnote ok">Ningún insumo subió ${D.cfg.suba}% o más.</p>`}
        <details class="dhist" ${D.verHist ? "open" : ""}><summary>Historial de precios (${todos.length} ${todos.length === 1 ? "cambio" : "cambios"})</summary>
          ${histRows ? `<div class="items dlist">${histRows}</div>` : `<p class="hintp">Todavía no hay insumos con más de un precio cargado.</p>`}
          ${hist.length ? `<p class="hintp">${n(hist.length, "suba anterior", "subas anteriores")} de ${D.cfg.suba}% o más ya tienen un precio más nuevo.</p>` : ""}</details>
      </section>`;
  }
  function cfgHTML() {
    const seg = (k, vals, suf) => `<div class="seg">${vals.map((v) => `<button type="button" data-dset="${k}" data-v="${v}" aria-pressed="${+D.cfg[k] === v}">${suf === "%" ? (k === "suba" ? "+" : "") + v + "%" : v + " h"}</button>`).join("")}</div>`;
    return `<div class="dcfg">
        <div class="fl"><span>Avisar cuando un insumo sube</span>${seg("suba", AJ.suba, "%")}</div>
        <div class="fl"><span>Piso de margen (se marca en rojo y se avisa en descuentos y premios)</span>${seg("piso", AJ.piso, "%")}</div>
        <div class="fl"><span>Corte entre turno mañana y tarde</span>${seg("corte", [13, 14, 15], "h")}</div>
        <div class="acts"><button class="btn" data-dcfgx>Listo</button></div></div>`;
  }
  // Maquinita: tiradas reales y qué pasó con cada premio (igual que en el panel)
  function maqSec(P) {
    const M = D.maq; if (!M) return "";
    const sem = P.todos || P.keys, hoy = hoyK(), ks = new Set(P.keys), ksA = new Set(P.prev), ahora = Date.now();
    const dia = (x) => keyAR(new Date(x.created_at)), quien = (x) => x.dev || x.phone;
    const T = M.tiradas, S = T.filter((x) => ks.has(dia(x))), Sa = T.filter((x) => ksA.has(dia(x))), H = T.filter((x) => dia(x) === hoy);
    const gano = (x) => x.resultado && x.resultado !== "nada", ganS = S.filter(gano).length;
    const jug = new Set(S.map(quien).filter(Boolean)).size, compra = S.filter((x) => !x.gratis).length;
    const vencido = (p) => p.vence_at && new Date(p.vence_at).getTime() <= ahora;
    const ESTADO = (p) => p.estado === "usado" ? "Usado" : p.estado === "anulado" ? "Anulado"
      : p.estado === "pendiente" ? (vencido(p) ? "Vencido sin reclamar" : "Sin reclamar") : vencido(p) ? "Vencido sin usar" : "Reclamado, sin usar";
    const est = {}, tipos = {}; M.premios.forEach((p) => { const e = ESTADO(p); est[e] = (est[e] || 0) + 1; tipos[p.titulo] = (tipos[p.titulo] || 0) + 1; });
    const usados = new Set(M.usos.map((u) => u.premio_id)).size, desc = M.usos.reduce((a, u) => a + (+u.monto || 0), 0);
    const desde = T.length ? new Date(T[0].created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "";
    return `<section class="dsec">
        <div class="dhead"><h2 class="dh2">Maquinita</h2><span class="hintp">${esc(P.label)}${desde ? ` · funciona desde el ${esc(desde)}` : ""}</span></div>
        <div class="kpis dk">
          ${tile("Tiradas hoy", String(H.length), H.length ? n(H.filter(gano).length, "premio", "premios") : "ninguna")}
          ${P.keys.length > 1 ? tile("Tiradas del período", String(S.length), P.vs, Sa.length > 0 ? cmpPct(S.length, Sa.length) : null) : ""}
          ${tile("Jugaron", String(jug), "dispositivos distintos")}
          ${tile("Premios dados", String(ganS), S.length ? `${Math.round((ganS / S.length) * 1000) / 10}% de las tiradas` : "")}
          ${compra ? tile("Con fichas de compra", String(compra), "tiradas que no eran la gratis") : ""}
        </div>
        <div class="dcols">
          <div class="dcard wide2"><b>Tiradas por día</b>
            <div class="dleg"><span><i class="s0"></i>Sin premio</span><span><i class="s1"></i>Con premio</span></div>
            ${columnas(sem.map((k) => { const x = S.filter((t) => dia(t) === k), g = x.filter(gano).length;
              return { l: sem.length > 10 ? diaCorto(k) : colDia(k), on: k === hoy, v: [x.length - g, g], tip: `${fechaD(k).toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })}: ${n(x.length, "tirada", "tiradas")}, ${n(g, "premio", "premios")}` }; }), String, sem.length > 10 ? "dense" : "")}</div>
          <div class="dcard"><b>Premios por tipo</b>${barras(orden(tipos), String, "Todavía no salió ningún premio.")}<p class="hintp">Desde que arrancó: ${n(T.length, "tirada", "tiradas")}, ${n(M.premios.length, "premio", "premios")}.</p></div>
          <div class="dcard"><b>Qué pasó con los premios</b>${barras(orden(est), String, "Todavía no salió ningún premio.")}<p class="hintp">${usados ? `${n(usados, "premio usado", "premios usados")} en pedidos web, ${money(desc)} de descuento en total.` : "Ningún premio se usó todavía en un pedido."} Reclamado = dejó su celular para guardarlo. Vencen a las 48 hs.</p></div>
        </div>
      </section>`;
  }

  /* ---------- aviso en Inicio (con lo último calculado) ---------- */
  function pendientes() { D.pend = D.ok ? alertas().filter((a) => a.estado === "pendiente") : D.pend || []; K.setDot(D.pend.length); return D.pend; }
  function avisoHTML() {
    const pend = D.pend || []; if (!pend.length) return "";
    return `<button class="dalert" data-go="dash" data-dsec="subas"><b>⚠ ${pend.length === 1 ? `Subió ${esc(pend[0].c.insumo.nombre)} ${pct(pend[0].c.d)}` : `${pend.length} insumos subieron`}</b><span>${n(pend.reduce((x, a) => x + a.prods.filter((p) => p.falta).length, 0), "producto quedó", "productos quedaron")} con menos margen. Mirá a cuánto subirlos.</span><i>›</i></button>`;
  }

  /* ---------- eventos ---------- */
  document.addEventListener("click", async (e) => {
    if (K.view() !== "dash" && !e.target.closest("[data-dsec]")) return;
    const b = e.target.closest("button, a"); if (!b) return;
    const d = b.dataset;
    if (d.dd !== undefined) { D.off = Math.max(0, Math.min(MAXOFF[D.per], D.off + +d.dd)); view(); return; }
    if (d.dper) { if (D.per !== d.dper) { D.per = d.dper; D.off = 0; view(); } return; }
    if (d.dre !== undefined) { D.ok = false; view(); return; }
    if (d.dsec) { setTimeout(() => { const s = $("#dsubas"); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60); return; }
    if (d.dcfg !== undefined) { D.editCfg = !D.editCfg; view(); return; }
    if (d.dcfgx !== undefined) { D.editCfg = false; view(); return; }
    if (d.dset) { if (await guardarCfg({ [d.dset]: +d.v }, "Guardado")) { if (d.dset === "suba") await registrarAlertas(); pendientes(); view(); } return; }
    if (d.dok || d.dreab) {
      if (!K.needMe()) return;
      const id = d.dok || d.dreab, A = Object.assign({}, D.cfg.alertas || {});
      A[id] = Object.assign({}, A[id] || {}, d.dok ? { estado: "ok", por: K.me(), ok_at: new Date().toISOString() } : { estado: null });
      if (await guardarCfg({ alertas: A }, d.dok ? "Listo: no avisa más por esta suba" : "Vuelve a avisar")) { pendientes(); view(); }
    }
  });
  document.addEventListener("toggle", (e) => { if (e.target.classList && e.target.classList.contains("dhist")) D.verHist = e.target.open; }, true);

  return {
    view,
    cargar,
    avisoHTML,
    // cuando cambian costos (precios o recetas) o entra una venta: se recalcula al volver a abrir el Dashboard
    invalidar: () => { if (D.ok && !D.loading) { D.ok = false; if (K.view() === "dash") view(); } },
  };
};
