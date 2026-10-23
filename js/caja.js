/*
  Caja del equipo de Setto.
  Regla de oro: acá solo se CARGAN movimientos. Saldos, deudas, stock y
  resúmenes los calcula la base (vistas caja_*), así nunca quedan desfasados.
*/
(function () {
  const cfg = window.SETTO_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TZ = "America/Argentina/Buenos_Aires";

  if (!cfg.supabaseUrl || !window.supabase) {
    app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Caja</h1><p>La caja necesita la base de Supabase configurada en <b>js/config.js</b>. No funciona en modo demo.</p></div></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  /* ---------- formatos ---------- */
  const fmt = (n, dec) => {
    const v = Math.abs(Number(n || 0));
    const d = dec ?? (Math.round(v) === v ? 0 : 2);
    return "$" + v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const money = (n) => (Number(n) < 0 ? "−" : "") + fmt(n);
  const signed = (n) => (Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : "") + fmt(n);
  const parseMoney = (s) => {
    let t = String(s || "").replace(/[^\d.,-]/g, "");
    if (!t) return NaN;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}(\.|$)/.test(t)) t = t.replace(/\./g, "");
    return Math.round(parseFloat(t) * 100) / 100;
  };
  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const mesDe = (d) => d.slice(0, 7);
  const mesNombre = (m) => { const [y, mm] = m.split("-").map(Number); const t = new Date(y, mm - 1, 15).toLocaleDateString("es-AR", { month: "long", year: "numeric" }).replace(" de ", " "); return t[0].toUpperCase() + t.slice(1); };
  const mesMov = (m, k) => { const [y, mm] = m.split("-").map(Number); const d = new Date(y, mm - 1 + k, 15); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const diaNombre = (d) => {
    if (d === hoy()) return "Hoy";
    const ay = new Date(Date.now() - 864e5); if (d === new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(ay)) return "Ayer";
    const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" });
  };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const cuando = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const clean = (m) => String(m || "").replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");
  const fail = (r) => { if (r.error) throw new Error(clean(r.error.message)); return r.data; };
  let toastT;
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800); };

  const TIPOS = {
    entrada: { l: "Entrada", ic: "↓", cls: "entrada" },
    gasto: { l: "Gasto", ic: "↑", cls: "gasto" },
    aporte: { l: "Aporte de socio", ic: "+", cls: "socio" },
    devolucion: { l: "Devolución a socio", ic: "↩", cls: "socio" },
    retiro: { l: "Retiro de ganancias", ic: "★", cls: "socio" },
    transferencia: { l: "Transferencia", ic: "⇄", cls: "transferencia" },
    ajuste: { l: "Ajuste por conteo", ic: "≈", cls: "ajuste" },
  };

  /* ---------- estado ---------- */
  const S = {
    me: localStorage.getItem("setto-caja-yo") || "",
    view: (location.hash.slice(1) || "inicio"),
    mes: mesDe(hoy()),
    cuentas: [], socios: [], cats: [], saldos: [], deudas: [], movs: [], stock: [], tareas: [], compras: [],
    f: { tipo: "todos", cuenta: "todas", q: "", anul: false },
    verHechas: false,
    r: { modo: "semana", socio: "todos", ref: hoy() },
  };
  const cuentaN = (id) => (S.cuentas.find((c) => c.id === id) || {}).nombre || id || "—";
  const socioN = (id) => (S.socios.find((c) => c.id === id) || {}).nombre || id || "—";
  const movPorId = (id) => S.movs.find((x) => x.id === id) || (S.retiros || []).find((x) => x.id === id);
  const catN = (id) => (S.cats.find((c) => c.id === id) || {}).nombre || "Sin categoría";

  /* efecto de un movimiento (igual que la vista caja_efectos; solo para mostrar) */
  function efectos(m) {
    const e = { cuentas: {}, socio: null, deuda: 0 };
    const add = (c, v) => { if (c) e.cuentas[c] = (e.cuentas[c] || 0) + v; };
    const v = Number(m.monto) || 0;
    if (["entrada", "aporte", "ajuste"].includes(m.tipo)) add(m.cuenta_id, v);
    if (["gasto", "devolucion", "retiro"].includes(m.tipo)) add(m.cuenta_id, -v);
    if (m.tipo === "transferencia") { add(m.cuenta_id, -v); add(m.cuenta_destino_id, v); }
    if (m.socio_id && ["gasto", "aporte"].includes(m.tipo)) { e.socio = m.socio_id; e.deuda = v; }
    if (m.socio_id && m.tipo === "devolucion") { e.socio = m.socio_id; e.deuda = -v; }
    return e;
  }
  function impacto(m) {
    if (m.tipo === "transferencia") return { txt: fmt(m.monto), cls: "", sub: `${cuentaN(m.cuenta_id)} → ${cuentaN(m.cuenta_destino_id)}` };
    if (m.tipo === "gasto" && !m.cuenta_id) return { txt: "−" + fmt(m.monto), cls: "neg", sub: `pagó ${socioN(m.socio_id)}` };
    const d = efectos(m).cuentas[m.cuenta_id] || 0;
    return { txt: signed(d), cls: d > 0 ? "pos" : d < 0 ? "neg" : "", sub: cuentaN(m.cuenta_id) };
  }

  /* ---------- datos ---------- */
  async function loadAll() {
    const r = await Promise.all([
      sb.from("caja_cuentas").select("*").order("orden"),
      sb.from("caja_socios").select("*").order("orden"),
      sb.from("caja_categorias").select("*").eq("activa", true).order("orden"),
      sb.from("caja_saldos").select("*").order("orden"),
      sb.from("caja_deudas").select("*").order("orden"),
      sb.from("caja_movimientos").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
      sb.from("caja_stock_actual").select("*").order("orden"),
      sb.from("caja_tareas").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("caja_compras").select("*").order("created_at", { ascending: false }).limit(300),
      /* los retiros van aparte para que el historial no dependa del límite de movimientos */
      sb.from("caja_movimientos").select("*").eq("tipo", "retiro").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(10000),
    ]);
    [S.cuentas, S.socios, S.cats, S.saldos, S.deudas, S.movs, S.stock, S.tareas, S.compras, S.retiros] = r.map(fail);
    // reservado en pedidos web pendientes y disponible en la web (si falla, la pestaña sigue igual)
    try { const { data } = await sb.rpc("caja_stock_reservas"); S.reservas = {}; (data || []).forEach((x) => (S.reservas[x.item_id] = x)); } catch (_) { S.reservas = {}; }
    stockApplyLocal();
    try { const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "pendiente"); S.pend = count || 0; } catch (_) { S.pend = 0; }
  }
  let reloadT;
  function softReload() {
    clearTimeout(reloadT);
    reloadT = setTimeout(async () => {
      if (stockBusy()) return softReload(); // con toques de stock sin guardar, esperar a que se guarden
      try { await loadAll(); render(); } catch (e) { console.error(e); }
    }, 250);
  }

  /* ---------- login ---------- */
  function drawLogin(msg) {
    app.innerHTML = `<div class="loginwrap"><form class="loginbox" id="login">
      <img class="l" src="img/logo.svg" alt="Setto"><h1 class="ph1">Caja del equipo</h1>
      <label class="f">Email<input id="lEmail" type="email" autocomplete="username" required></label>
      <label class="f">Contraseña<input id="lPass" type="password" autocomplete="current-password" required></label>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn solid big" type="submit">Entrar</button>
      <p class="hintp">Es el mismo usuario del panel de pedidos.</p></form></div>`;
    $("#login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
      if (r.error) return drawLogin(r.error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : r.error.message);
      start();
    });
  }
  async function start() {
    app.innerHTML = `<div class="loading">Cargando la caja…</div>`;
    const u = (await sb.auth.getSession()).data.session;
    if (!u) return drawLogin();
    const st = await sb.from("staff").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (st.error || !st.data) { app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Usuario sin permiso</h1><p>Este usuario no está habilitado como equipo de Setto.</p></div></div>`; return; }
    try { await loadAll(); }
    catch (e) {
      app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Falta instalar la caja</h1><p>La base todavía no tiene las tablas de la caja. Corré <b>supabase/migrations/006_caja.sql</b> en el SQL Editor de Supabase.</p><p class="err">${esc(e.message)}</p></div></div>`;
      return;
    }
    drawShell(); render();
    if (!S.socios.some((s) => s.nombre === S.me)) whoSheet(true);
    sb.channel("caja-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "caja_movimientos" }, softReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "caja_stock_mov" }, softReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, softReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "caja_tareas" }, softReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "caja_compras" }, softReload)
      .subscribe();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) softReload(); });
  }

  /* ---------- estructura ---------- */
  const ICONS = {
    inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    movs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
    tareas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    compras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8a3 3 0 016 0"/></svg>',
  };
  function drawShell() {
    app.innerHTML = `<header class="cbar"><div class="wrap">
        <a class="logo" href="index.html" title="Ver el sitio"><img src="img/logo.svg" alt="Setto"></a>
        <nav class="appsw" aria-label="Cambiar de app"><a href="panel.html">Pedidos<span class="n" data-pend hidden></span></a><a href="caja.html" aria-current="page">Caja</a></nav>
        <span class="sp"></span>
        <button class="mebtn" data-who><i>${esc((S.me || "?")[0])}</i>${esc(S.me || "¿Quién sos?")}</button>
      </div></header>
      <main class="cmain"><div class="wrap" id="view"></div></main>
      <button class="fab" data-new aria-label="Cargar movimiento">+</button>
      <nav class="bnav"><div class="wrap">
        ${[["inicio", "Inicio"], ["movs", "Movimientos"], ["stock", "Stock"], ["tareas", "Tareas"], ["compras", "Compras"]].map(([k, l]) => `<button data-go="${k}">${ICONS[k]}${l}<span class="dot" data-dot="${k}" hidden></span></button>`).join("")}
      </div></nav>`;
  }
  function render() {
    if (!$("#view")) return;
    document.querySelectorAll(".bnav [data-go]").forEach((b) => { if (b.dataset.go === (S.view === "retiros" ? "inicio" : S.view)) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    const pt = S.tareas.filter((t) => t.estado === "pendiente").length, pc = S.compras.filter((c) => c.estado === "pendiente").length;
    const dt = $('[data-dot="tareas"]'), dc = $('[data-dot="compras"]');
    if (dt) { dt.textContent = pt; dt.hidden = !pt; } if (dc) { dc.textContent = pc; dc.hidden = !pc; }
    const dp = $("[data-pend]"); if (dp) { dp.textContent = S.pend || ""; dp.hidden = !S.pend; dp.title = `${S.pend} pedido(s) pendiente(s)`; }
    const mb = $("[data-who]"); if (mb) mb.innerHTML = `<i>${esc((S.me || "?")[0])}</i>${esc(S.me || "¿Quién sos?")}`;
    $(".fab").hidden = !["inicio", "movs", "retiros"].includes(S.view);
    const y = window.scrollY;
    ({ inicio: vInicio, movs: vMovs, retiros: vRetiros, stock: vStock, tareas: vTareas, compras: vCompras }[S.view] || vInicio)();
    window.scrollTo(0, y);
  }
  function go(v) { S.view = v; history.replaceState(null, "", "#" + v); render(); window.scrollTo(0, 0); }

  /* ---------- INICIO ---------- */
  function mesStats(mes) {
    const ms = S.movs.filter((m) => m.estado === "activo" && mesDe(m.fecha) === mes);
    const sum = (t) => ms.filter((m) => m.tipo === t).reduce((a, m) => a + Number(m.monto), 0);
    const porCat = (t) => {
      const o = {}; ms.filter((m) => m.tipo === t).forEach((m) => { const k = m.categoria_id || "_"; o[k] = (o[k] || 0) + Number(m.monto); });
      return Object.entries(o).sort((a, b) => b[1] - a[1]);
    };
    return { ent: sum("entrada"), gas: sum("gasto"), ret: sum("retiro"), aju: sum("ajuste"), n: ms.length, gc: porCat("gasto"), ec: porCat("entrada") };
  }
  function vInicio() {
    const total = S.saldos.reduce((a, s) => a + Number(s.saldo), 0);
    const st = mesStats(S.mes), res = st.ent - st.gas;
    const deben = S.deudas.filter((d) => Math.abs(d.le_debemos) >= 1);
    const ult = S.movs.filter((m) => m.estado === "activo").slice(0, 6);
    const bars = (rows, cls) => { const mx = Math.max(1, ...rows.map((r) => r[1])); return rows.map(([k, v]) => `<div class="bar ${cls}"><span>${esc(k === "_" ? "Sin categoría" : catN(k))}</span><span class="tr"><i style="width:${Math.max(2, (v / mx) * 100)}%"></i></span><span>${fmt(v)}</span></div>`).join(""); };
    $("#view").innerHTML = `
      <h1 class="h1">Hola${S.me ? ", " + esc(S.me) : ""}</h1>
      <div class="saldos">
        ${S.saldos.map((s) => `<div class="saldo"><span class="k">${esc(s.nombre)}</span><span class="v num">${money(s.saldo)}</span>
          <span class="c">${s.ultimo_conteo ? "Contado " + cuando(s.ultimo_conteo) : "Sin conteos todavía"}</span>
          <button data-contar="${esc(s.id)}">Contar</button></div>`).join("")}
        <div class="saldo total"><span class="k">Total en caja</span><span class="v num">${money(total)}</span></div>
      </div>

      <h2 class="h2">Socios <small>${deben.length ? "Setto les debe" : "Nadie tiene plata puesta"}</small><button class="more" data-go="retiros">Ver retiros</button></h2>
      <div class="deudas">${S.deudas.map((d) => `<div class="deuda"><span class="av">${esc(d.nombre[0])}</span>
          <span class="t"><b>${esc(d.nombre)}</b>${Number(d.retirado) ? `Retiró ${fmt(d.retirado)} de ganancias` : "Sin retiros"}</span>
          <span class="m num ${d.le_debemos >= 1 ? "pend" : ""}">${d.le_debemos >= 1 ? fmt(d.le_debemos) : d.le_debemos <= -1 ? "debe " + fmt(d.le_debemos) : "al día"}</span>
          ${d.le_debemos >= 1 ? `<button data-devolver="${esc(d.id)}">Devolver</button>` : ""}</div>`).join("")}</div>

      <h2 class="h2"><span class="mesnav"><button data-mes="-1" aria-label="Mes anterior">‹</button><b>${esc(mesNombre(S.mes))}</b><button data-mes="1" aria-label="Mes siguiente">›</button></span></h2>
      <div class="kpis">
        <div class="kpi"><div class="k">Entró</div><div class="v num">${fmt(st.ent)}</div></div>
        <div class="kpi"><div class="k">Gastamos</div><div class="v num">${fmt(st.gas)}</div></div>
        <div class="kpi res ${res < 0 ? "neg" : ""}"><div class="k">Resultado</div><div class="v num">${money(res)}</div></div>
      </div>
      <p class="kpinote">Los gastos incluyen lo que pagaron los socios de su bolsillo.${st.ret ? ` Retiros de ganancias: ${fmt(st.ret)}.` : ""}${st.aju ? ` Diferencias por conteo: ${signed(st.aju)}.` : ""}</p>
      ${st.gc.length ? `<div class="bars"><b style="font-size:.85rem">¿En qué se fue?</b>${bars(st.gc, "")}</div>` : ""}
      ${st.ec.length ? `<div class="bars"><b style="font-size:.85rem">¿De dónde entró?</b>${bars(st.ec, "in")}</div>` : ""}

      <h2 class="h2">Últimos movimientos <button class="more" data-go="movs">Ver todos</button></h2>
      ${ult.length ? `<div class="movs">${ult.map(movRow).join("")}</div>` : `<div class="emptyc"><img src="img/mochito-lie.png" alt=""><span>Todavía no hay movimientos. Tocá + para cargar el primero.</span></div>`}`;
  }
  function movRow(m) {
    const t = TIPOS[m.tipo], im = impacto(m), an = m.estado === "anulado";
    const sub = [m.tipo === "entrada" || m.tipo === "gasto" ? catN(m.categoria_id) : t.l, m.socio_id && m.tipo !== "gasto" ? socioN(m.socio_id) : null, m.registro].filter(Boolean).join(" · ");
    return `<button class="mov ${an ? "anul" : ""}" data-mov="${m.id}">
      <span class="ic ${t.cls}">${t.ic}</span>
      <span class="t"><b>${esc(m.detalle || t.l)}</b><span>${esc(sub)}${an ? '<span class="tagx warn">anulado</span>' : ""}</span></span>
      <span class="a ${im.cls}">${im.txt}<small>${esc(im.sub)}</small></span></button>`;
  }

  /* ---------- MOVIMIENTOS ---------- */
  function vMovs() {
    const f = S.f, q = f.q.trim().toLowerCase();
    let list = S.movs.filter((m) => mesDe(m.fecha) === S.mes);
    if (!f.anul) list = list.filter((m) => m.estado === "activo");
    if (f.tipo === "sincat") list = list.filter((m) => ["entrada", "gasto"].includes(m.tipo) && !m.categoria_id);
    else if (f.tipo === "socios") list = list.filter((m) => ["aporte", "devolucion", "retiro"].includes(m.tipo) || (m.tipo === "gasto" && m.socio_id));
    else if (f.tipo !== "todos") list = list.filter((m) => m.tipo === f.tipo);
    if (f.cuenta !== "todas") list = list.filter((m) => m.cuenta_id === f.cuenta || m.cuenta_destino_id === f.cuenta);
    if (q) list = list.filter((m) => (m.detalle + " " + catN(m.categoria_id) + " " + m.registro + " " + socioN(m.socio_id) + " " + m.monto).toLowerCase().includes(q));
    const days = {}; list.forEach((m) => (days[m.fecha] = days[m.fecha] || []).push(m));
    const sinCat = S.movs.filter((m) => m.estado === "activo" && ["entrada", "gasto"].includes(m.tipo) && !m.categoria_id && mesDe(m.fecha) === S.mes).length;
    const chip = (k, v, l) => `<button class="chip" data-f="${k}" data-v="${v}" aria-pressed="${S.f[k] === v}">${l}</button>`;
    $("#view").innerHTML = `
      <h1 class="h1" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">Movimientos <span class="mesnav" style="margin-left:auto;font-family:var(--texto);font-size:1rem"><button data-mes="-1" aria-label="Mes anterior">‹</button><b>${esc(mesNombre(S.mes))}</b><button data-mes="1" aria-label="Mes siguiente">›</button></span></h1>
      <input class="search" id="mq" placeholder="Buscar detalle, monto, categoría o persona" value="${esc(f.q)}">
      <div class="filters">${chip("tipo", "todos", "Todos")}${chip("tipo", "entrada", "Entradas")}${chip("tipo", "gasto", "Gastos")}${chip("tipo", "socios", "Socios")}${chip("tipo", "transferencia", "Transferencias")}${chip("tipo", "ajuste", "Conteos")}${sinCat ? chip("tipo", "sincat", `Sin categoría (${sinCat})`) : ""}</div>
      <div class="filters">${chip("cuenta", "todas", "Todas las cuentas")}${S.cuentas.map((c) => chip("cuenta", c.id, esc(c.nombre))).join("")}<button class="chip" data-anul aria-pressed="${f.anul}">Ver anulados</button></div>
      ${Object.keys(days).length ? Object.entries(days).map(([d, ms]) => {
        const net = ms.filter((m) => m.estado === "activo").reduce((a, m) => a + Object.values(efectos(m).cuentas).reduce((x, y) => x + y, 0), 0);
        return `<div class="day"><div class="dayh"><span>${esc(diaNombre(d))}</span><span class="num">${net ? signed(net) : ""}</span></div><div class="movs">${ms.map(movRow).join("")}</div></div>`;
      }).join("") : `<div class="emptyc"><img src="img/mochito-lie.png" alt=""><span>No hay movimientos con esos filtros.</span></div>`}
      <div class="toolsrow"><button class="ghost" data-csv>Descargar ${esc(mesNombre(S.mes))} (CSV)</button></div>`;
  }
  function csvMes() {
    const rows = S.movs.filter((m) => mesDe(m.fecha) === S.mes).slice().reverse();
    const head = ["Fecha", "Tipo", "Detalle", "Categoría", "Monto", "Cuenta", "Cuenta destino", "Socio", "Efecto en caja", "Cargó", "Estado", "Motivo anulación"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(";")].concat(rows.map((m) => {
      const ef = Object.values(efectos(m).cuentas).reduce((a, b) => a + b, 0);
      return [m.fecha, TIPOS[m.tipo].l, m.detalle, ["entrada", "gasto"].includes(m.tipo) ? catN(m.categoria_id) : "", String(m.monto).replace(".", ","), m.cuenta_id ? cuentaN(m.cuenta_id) : "", m.cuenta_destino_id ? cuentaN(m.cuenta_destino_id) : "", m.socio_id ? socioN(m.socio_id) : "", String(ef).replace(".", ","), m.registro, m.estado, m.anulado_motivo || ""].map(q).join(";");
    }));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `setto-caja-${S.mes}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- RETIROS (por semana o mes, por socio) ---------- */
  const fd = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
  const iso = (dt) => dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  const lunes = (d) => { const t = fd(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return iso(t); };
  const masDias = (d, n) => { const t = fd(d); t.setDate(t.getDate() + n); return iso(t); };
  /* clave del período: lunes de la semana (yyyy-mm-dd) o mes (yyyy-mm) */
  const perDe = (d, modo) => (modo === "mes" ? mesDe(d) : lunes(d));
  const perMov = (k, modo, n) => (modo === "mes" ? mesMov(k, n) : masDias(k, 7 * n));
  const perNombre = (k, modo) => {
    if (modo === "mes") return mesNombre(k);
    const a = fd(k), b = fd(masDias(k, 6)), mes = (x) => x.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
    return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${mes(b)}` : `${a.getDate()} ${mes(a)} al ${b.getDate()} ${mes(b)}`;
  };
  const diaCorto = (d) => { const t = fd(d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, ""); return t[0].toUpperCase() + t.slice(1); };
  function vRetiros() {
    const R = S.r, act = perDe(hoy(), R.modo), cur = perDe(R.ref, R.modo);
    const socs = S.socios.filter((s) => s.activo || S.retiros.some((m) => m.socio_id === s.id));
    const verSocs = R.socio === "todos" ? socs : socs.filter((s) => s.id === R.socio);
    const todos = S.retiros.filter((m) => m.estado === "activo" && (R.socio === "todos" || m.socio_id === R.socio));
    const enPer = todos.filter((m) => perDe(m.fecha, R.modo) === cur).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.created_at < b.created_at ? 1 : -1));
    const suma = (ms, sid) => ms.filter((m) => !sid || m.socio_id === sid).reduce((a, m) => a + Number(m.monto), 0);
    const tot = suma(enPer), mx = Math.max(1, ...verSocs.map((s) => suma(enPer, s.id)));
    /* historial: desde el primer retiro hasta el período actual (máx. 12 filas) */
    const prim = todos.length ? todos.reduce((a, m) => (m.fecha < a ? m.fecha : a), hoy()) : hoy();
    const hist = []; for (let k = act, i = 0; k >= perDe(prim, R.modo) && i < 12; k = perMov(k, R.modo, -1), i++) hist.push(k);
    const histRow = (k) => { const ms = todos.filter((m) => perDe(m.fecha, R.modo) === k); return { k, ms, t: suma(ms), dias: new Set(ms.map((m) => m.fecha)).size }; };
    const rows = hist.map(histRow), conRet = rows.filter((r) => r.t > 0);
    const prom = rows.length ? rows.reduce((a, r) => a + r.t, 0) / rows.length : 0;
    const chip = (k, v, l) => `<button class="chip" data-rf="${k}" data-v="${esc(v)}" aria-pressed="${R[k] === v}">${esc(l)}</button>`;
    const days = {}; enPer.forEach((m) => (days[m.fecha] = days[m.fecha] || []).push(m));
    const unidad = R.modo === "mes" ? "mes" : "semana";
    $("#view").innerHTML = `
      <button class="back" data-go="inicio">‹ Inicio</button>
      <h1 class="h1">Retiros de socios</h1>
      <div class="filters">${chip("modo", "semana", "Por semana")}${chip("modo", "mes", "Por mes")}</div>
      <div class="filters">${chip("socio", "todos", "Todos")}${socs.map((s) => chip("socio", s.id, s.nombre)).join("")}</div>
      <div class="rhead"><span class="mesnav"><button data-rper="-1" aria-label="Período anterior">‹</button><b>${esc(R.modo === "semana" && cur === act ? "Esta semana" : perNombre(cur, R.modo))}</b><button data-rper="1" aria-label="Período siguiente" ${cur >= act ? "disabled" : ""}>›</button></span>
        ${cur !== act ? `<button class="more" data-rhoy>Volver a hoy</button>` : ""}</div>
      ${R.modo === "semana" ? `<p class="kpinote" style="margin-top:0">Lunes a domingo · ${esc(perNombre(cur, "semana"))}</p>` : ""}
      <div class="rsoc">${verSocs.map((s) => { const v = suma(enPer, s.id), n = enPer.filter((m) => m.socio_id === s.id).length;
        return `<div class="rs"><span class="av">${esc(s.nombre[0])}</span><span class="t"><b>${esc(s.nombre)}</b><span>${n ? `${n} retiro${n > 1 ? "s" : ""}` : "Sin retiros"}</span></span>
          <span class="tr"><i style="width:${v ? Math.max(3, (v / mx) * 100) : 0}%"></i></span><span class="m num">${fmt(v)}</span></div>`; }).join("")}
        ${verSocs.length > 1 ? `<div class="rs tot"><span class="t"><b>Total del ${unidad}</b></span><span class="m num">${fmt(tot)}</span></div>` : ""}</div>

      <h2 class="h2">Días de retiro <small>${enPer.length ? `${Object.keys(days).length} día${Object.keys(days).length > 1 ? "s" : ""}` : ""}</small><button class="more" data-rnew>+ Cargar retiro</button></h2>
      ${enPer.length ? Object.entries(days).map(([d, ms]) => `<div class="day"><div class="dayh"><span>${esc(diaNombre(d))}</span><span class="num">${fmt(suma(ms))}</span></div><div class="movs">${ms.map(movRow).join("")}</div></div>`).join("")
        : `<div class="emptyc"><img src="img/mochito-lie.png" alt=""><span>Nadie retiró ${R.socio === "todos" ? "" : "acá "}en ${R.modo === "mes" ? "este mes" : "esta semana"}.</span></div>`}

      <h2 class="h2">Historial por ${unidad} <small>${conRet.length ? `promedio ${fmt(Math.round(prom))} por ${unidad}` : ""}</small></h2>
      ${rows.length ? `<div class="rhist">${rows.map((r) => { const dias = r.ms.map((m) => m.fecha).filter((x, i, a) => a.indexOf(x) === i).sort();
        return `<button class="rh ${r.k === cur ? "on" : ""} ${r.t ? "" : "cero"}" data-rir="${r.k}"><span class="rt"><b>${esc(perNombre(r.k, R.modo))}</b><b class="num">${r.t ? fmt(r.t) : "$0"}</b></span>
          ${verSocs.length > 1 ? `<span class="rp">${verSocs.map((s) => `<span class="${suma(r.ms, s.id) ? "" : "z"}">${esc(s.nombre)} <b class="num">${fmt(suma(r.ms, s.id))}</b></span>`).join("")}</span>` : ""}
          <span class="rd">${dias.length ? `${dias.length} día${dias.length > 1 ? "s" : ""}: ${dias.map(diaCorto).join(" · ")}` : "Sin retiros"}</span></button>`; }).join("")}</div>` : ""}
      <p class="kpinote">Se cuenta por la fecha del retiro, no por cuándo se cargó. Los anulados no suman.</p>
      <div class="toolsrow"><button class="ghost" data-rcsv>Descargar retiros (CSV)</button></div>`;
  }
  function csvRetiros() {
    const R = S.r, rows = S.retiros.filter((m) => m.estado === "activo" && (R.socio === "todos" || m.socio_id === R.socio)).slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Fecha", "Semana (lunes)", "Mes", "Socio", "Monto", "Cuenta", "Detalle", "Cargó"].map(q).join(";")].concat(rows.map((m) =>
      [m.fecha, lunes(m.fecha), mesDe(m.fecha), socioN(m.socio_id), String(m.monto).replace(".", ","), cuentaN(m.cuenta_id), m.detalle, m.registro].map(q).join(";")));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `setto-retiros-${hoy()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- hoja (bottom sheet) ---------- */
  function openSheet(html, onMount) {
    const sh = $("#sheet"); sh.innerHTML = `<div class="grab"></div>${html}`; sh.hidden = false; $("#sheetBg").hidden = false;
    document.body.style.overflow = "hidden"; if (onMount) onMount(sh);
  }
  function closeSheet() { $("#sheet").hidden = true; $("#sheetBg").hidden = true; $("#sheet").innerHTML = ""; document.body.style.overflow = ""; }
  const needMe = () => { if (!S.me) { whoSheet(); toast("Primero elegí quién sos"); return false; } return true; };

  function whoSheet(first) {
    openSheet(`<div class="sh"><h3>¿Quién está usando la caja?</h3>${first ? "" : '<button class="x" data-close aria-label="Cerrar">×</button>'}</div>
      <p class="muted" style="margin-bottom:14px;font-size:.9rem">Queda guardado en este celular. Todo lo que cargues va a figurar a tu nombre.</p>
      <div class="who-grid">${S.socios.filter((s) => s.activo).map((s) => `<button data-iam="${esc(s.nombre)}" aria-pressed="${S.me === s.nombre}"><i>${esc(s.nombre[0])}</i>${esc(s.nombre)}</button>`).join("")}</div>`);
  }

  /* --- cargar / editar movimiento --- */
  function movForm(pre = {}, editId = null, onSaved = null) {
    if (!needMe()) return;
    const D = Object.assign({ tipo: "entrada", monto: "", detalle: "", cuenta_id: S.cuentas[0] && S.cuentas[0].id, cuenta_destino_id: null, socio_id: null, categoria_id: null, fecha: hoy(), pagador: "caja" }, pre);
    if (D.tipo === "gasto" && D.socio_id && !D.cuenta_id) D.pagador = D.socio_id;
    if (D.tipo === "transferencia" && !D.cuenta_destino_id) D.cuenta_destino_id = (S.cuentas.find((c) => c.id !== D.cuenta_id) || {}).id;
    const draw = (sh) => {
      const t = D.tipo, otros = ["aporte", "devolucion", "retiro", "transferencia"];
      const cats = S.cats.filter((c) => c.tipo === t);
      const cChips = (k, sel, list) => `<div class="chips">${list.map(([v, l]) => `<button type="button" class="chip" data-set="${k}" data-v="${esc(v)}" aria-pressed="${sel === v}">${esc(l)}</button>`).join("")}</div>`;
      const ctas = S.cuentas.filter((c) => c.activa).map((c) => [c.id, c.nombre]);
      const socs = S.socios.filter((s) => s.activo).map((s) => [s.id, s.nombre]);
      let campos = "";
      if (t === "entrada") campos = `<div class="fl"><span>¿A dónde entró?</span>${cChips("cuenta_id", D.cuenta_id, ctas)}</div>`;
      if (t === "gasto") campos = `<div class="fl"><span>¿Quién pagó?</span>${cChips("pagador", D.pagador === "caja" ? "caja:" + D.cuenta_id : D.pagador, ctas.map(([v, l]) => ["caja:" + v, "Caja · " + l]).concat(socs.map(([v, l]) => [v, l + " (de su bolsillo)"])))}</div>`;
      if (["aporte", "devolucion", "retiro"].includes(t)) campos = `<div class="fl"><span>Socio</span>${cChips("socio_id", D.socio_id, socs)}</div>
        <div class="fl"><span>${t === "aporte" ? "¿A qué cuenta entra?" : "¿De qué cuenta sale?"}</span>${cChips("cuenta_id", D.cuenta_id, ctas)}</div>`;
      if (t === "transferencia") campos = `<div class="fl"><span>Sale de</span>${cChips("cuenta_id", D.cuenta_id, ctas)}</div><div class="fl"><span>Entra a</span>${cChips("cuenta_destino_id", D.cuenta_destino_id, ctas)}</div>`;
      const ayuda = { aporte: "Un socio pone plata en la caja. Setto le queda debiendo ese monto.", devolucion: "Setto le devuelve a un socio lo que puso o pagó de su bolsillo.", retiro: "Un socio se lleva ganancias. No es deuda: es reparto.", transferencia: "Mover plata entre cuentas, por ejemplo depositar efectivo en Mercado Pago. No cambia el total." }[t];
      sh.innerHTML = `<div class="grab"></div><div class="sh"><h3>${editId ? "Editar movimiento" : "Cargar movimiento"}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
        <form class="form" id="mf" autocomplete="off">
          <div class="seg">${["entrada", "gasto"].map((k) => `<button type="button" data-set="tipo" data-v="${k}" aria-pressed="${t === k}">${k === "entrada" ? "Entrada" : "Gasto"}</button>`).join("")}
            <button type="button" data-set="tipo" data-v="${otros.includes(t) ? t : "transferencia"}" aria-pressed="${otros.includes(t)}">Más</button></div>
          ${otros.includes(t) ? `<div class="chips">${otros.map((k) => `<button type="button" class="chip" data-set="tipo" data-v="${k}" aria-pressed="${t === k}">${TIPOS[k].l}</button>`).join("")}</div><p class="hintp">${ayuda}</p>` : ""}
          <label class="fl monto"><input id="fMonto" inputmode="decimal" placeholder="0" value="${esc(D.monto)}" aria-label="Monto"></label>
          <label class="fl"><span>Detalle</span><input id="fDet" value="${esc(D.detalle)}" placeholder="${t === "entrada" ? "Ej: 3 mochis + 1 Strawberry Matcha" : t === "gasto" ? "Ej: 2 cremas en Makro" : "Opcional"}" maxlength="140"></label>
          ${cats.length ? `<div class="fl"><span>Categoría</span>${cChips("categoria_id", D.categoria_id, cats.map((c) => [c.id, c.nombre]))}</div>` : ""}
          ${campos}
          <label class="fl"><span>Fecha</span><input id="fFecha" type="date" value="${esc(D.fecha)}" max="${hoy()}"></label>
          <div id="fPrev"></div>
          <p class="err" id="ferr" hidden></p>
          <button class="btn solid big" type="submit">${editId ? "Guardar cambios" : "Guardar"}</button>
          <p class="hintp" style="text-align:center">${editId ? "Edita" : "Carga"}: <b>${esc(S.me)}</b></p>
        </form>`;
      preview(sh);
      const mi = sh.querySelector("#fMonto"); if (!editId && !D._touched) mi.focus({ preventScroll: true });
    };
    /* solo actualiza la vista previa (no redibuja el formulario: no se cierra el teclado) */
    const preview = (sh) => {
      const t = D.tipo, v = parseMoney(D.monto), ok = v > 0, box = sh.querySelector("#fPrev");
      sh.querySelector('button[type="submit"]').disabled = !ok;
      if (!ok) { box.innerHTML = ""; return; }
      const m = Object.assign({}, D, { monto: v });
      if (t === "gasto") { if (D.pagador === "caja") m.socio_id = null; else { m.cuenta_id = null; m.socio_id = D.pagador; } }
      if (t === "entrada" || t === "ajuste") m.socio_id = null;
      const e = efectos(m), lines = [];
      Object.entries(e.cuentas).forEach(([c, d]) => { const s = Number((S.saldos.find((x) => x.id === c) || {}).saldo || 0); lines.push(`${esc(cuentaN(c))}: <b>${money(s)}</b> → <b>${money(s + d)}</b>`); });
      if (e.socio) { const dd = Number((S.deudas.find((x) => x.id === e.socio) || {}).le_debemos || 0); lines.push(`Setto le debe a ${esc(socioN(e.socio))}: <b>${money(dd)}</b> → <b>${money(dd + e.deuda)}</b>`); }
      if (t === "retiro") lines.push(`${esc(socioN(D.socio_id))} se lleva ${fmt(v)} de ganancias`);
      if (editId) lines.unshift('<span class="muted">Vista previa sin descontar el valor original:</span>');
      box.innerHTML = lines.length ? `<div class="preview">${lines.map((l) => `<div>${l}</div>`).join("")}</div>` : "";
    };
    openSheet("", draw);
    const sh = $("#sheet");
    sh.onclick = (e) => {
      const b = e.target.closest("[data-set]"); if (!b) return;
      D._touched = true;
      const k = b.dataset.set, v = b.dataset.v;
      if (k === "tipo") { if (v !== D.tipo) D.categoria_id = null; D.tipo = v; if (v === "transferencia" && (!D.cuenta_destino_id || D.cuenta_destino_id === D.cuenta_id)) D.cuenta_destino_id = (S.cuentas.find((c) => c.id !== D.cuenta_id) || {}).id; }
      else if (k === "pagador") { if (v.startsWith("caja:")) { D.pagador = "caja"; D.cuenta_id = v.slice(5); } else D.pagador = v; }
      else D[k] = D[k] === v && k === "categoria_id" ? null : v;
      D.monto = sh.querySelector("#fMonto").value; D.detalle = sh.querySelector("#fDet").value; D.fecha = sh.querySelector("#fFecha").value;
      draw(sh);
    };
    sh.oninput = (e) => {
      if (e.target.id === "fMonto") { D.monto = e.target.value; D._touched = true; preview(sh); }
      if (e.target.id === "fDet") D.detalle = e.target.value;
      if (e.target.id === "fFecha") D.fecha = e.target.value;
    };
    sh.onsubmit = async (e) => {
      e.preventDefault();
      const btn = sh.querySelector('button[type="submit"]'), er = sh.querySelector("#ferr");
      const v = parseMoney(D.monto);
      const row = { fecha: D.fecha || hoy(), tipo: D.tipo, detalle: (D.detalle || "").trim(), monto: v, categoria_id: ["entrada", "gasto"].includes(D.tipo) ? D.categoria_id : null, cuenta_id: null, cuenta_destino_id: null, socio_id: null };
      if (D.tipo === "entrada") row.cuenta_id = D.cuenta_id;
      if (D.tipo === "gasto") { if (D.pagador === "caja") row.cuenta_id = D.cuenta_id; else row.socio_id = D.pagador; }
      if (["aporte", "devolucion", "retiro"].includes(D.tipo)) { row.cuenta_id = D.cuenta_id; row.socio_id = D.socio_id; }
      if (D.tipo === "transferencia") { row.cuenta_id = D.cuenta_id; row.cuenta_destino_id = D.cuenta_destino_id; }
      const msg = !(v > 0) ? "Poné un monto" : ["aporte", "devolucion", "retiro"].includes(D.tipo) && !row.socio_id ? "Elegí el socio" : D.tipo === "transferencia" && row.cuenta_id === row.cuenta_destino_id ? "Elegí cuentas distintas" : ["entrada", "gasto"].includes(D.tipo) && !row.detalle ? "Escribí un detalle corto" : null;
      if (msg) { er.textContent = msg; er.hidden = false; return; }
      btn.disabled = true;
      try {
        if (editId) fail(await sb.from("caja_movimientos").update(Object.assign(row, { editado_por: S.me })).eq("id", editId));
        else {
          const ins = fail(await sb.from("caja_movimientos").insert(Object.assign(row, { registro: S.me })).select("id").single());
          if (onSaved) { try { await onSaved(ins.id); } catch (e2) { toast(e2.message); } }
        }
        closeSheet(); toast(editId ? "Cambios guardados" : `Guardado: ${TIPOS[row.tipo].l.toLowerCase()} de ${fmt(v)}`);
        if (mesDe(row.fecha) !== S.mes && !editId) S.mes = mesDe(row.fecha);
        if (S.view === "retiros" && row.tipo === "retiro") S.r.ref = row.fecha;
        await loadAll(); render();
      } catch (err) { er.textContent = err.message; er.hidden = false; btn.disabled = false; }
    };
  }

  /* --- detalle de un movimiento --- */
  async function movDetail(id) {
    const m = movPorId(id); if (!m) return;
    const t = TIPOS[m.tipo], an = m.estado === "anulado", im = impacto(m);
    const rows = [["Tipo", t.l], ["Fecha", diaNombre(m.fecha) + (m.fecha !== hoy() ? "" : "")], m.cuenta_id ? ["Cuenta", cuentaN(m.cuenta_id) + (m.cuenta_destino_id ? " → " + cuentaN(m.cuenta_destino_id) : "")] : null,
      m.socio_id ? [m.tipo === "gasto" ? "Pagó" : "Socio", socioN(m.socio_id)] : null, ["entrada", "gasto"].includes(m.tipo) ? ["Categoría", catN(m.categoria_id)] : null,
      ["Cargó", `${m.registro} · ${cuando(m.created_at)}`], an ? ["Anulado", `${m.anulado_por || ""}${m.anulado_at ? " · " + cuando(m.anulado_at) : ""}${m.anulado_motivo ? " · " + m.anulado_motivo : ""}`] : null].filter(Boolean);
    openSheet(`<div class="sh"><h3>${esc(m.detalle || t.l)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px"><span class="bigamt num ${an ? "" : ""}" style="${an ? "text-decoration:line-through;color:var(--tachado)" : ""}">${im.txt}</span><span class="muted">${esc(im.sub)}</span></div>
      <dl class="dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${/^pedido:/.test(m.legacy_id || "") && /STT-\w+/.test(m.detalle || "") ? `<a class="btn" style="margin-top:12px" href="panel.html#pedidos/${an ? "cancelado" : "entregado"}/${encodeURIComponent((m.detalle.match(/STT-\w+/) || [""])[0])}">Ver el pedido en el panel →</a>` : ""}
      <div id="mlog" style="margin-top:14px"></div>
      ${an ? "" : `<div class="btnrow" style="margin-top:16px"><button class="btn" data-edit="${m.id}">Editar</button>${m.tipo !== "ajuste" ? `<button class="btn" data-dup="${m.id}">Repetir</button>` : ""}<button class="btn danger" data-anular="${m.id}">Anular</button></div>`}`);
    try {
      const lg = fail(await sb.from("caja_log").select("*").eq("tabla", "movimientos").eq("fila_id", id).order("at", { ascending: false }).limit(20));
      const box = $("#mlog"); if (!box || !lg.length) return;
      box.innerHTML = `<b style="font-size:.85rem">Historial</b><div class="logl" style="margin-top:6px">${lg.map((l) => {
        const a = l.antes || {}, d = l.despues || {}, cambios = [];
        if (l.accion === "editado") {
          if (a.monto !== d.monto) cambios.push(`monto ${fmt(a.monto)} → ${fmt(d.monto)}`);
          if (a.detalle !== d.detalle) cambios.push(`detalle "${esc(a.detalle)}" → "${esc(d.detalle)}"`);
          if (a.fecha !== d.fecha) cambios.push(`fecha ${a.fecha} → ${d.fecha}`);
          if (a.cuenta_id !== d.cuenta_id || a.socio_id !== d.socio_id || a.cuenta_destino_id !== d.cuenta_destino_id) cambios.push("cuenta o socio");
          if (a.categoria_id !== d.categoria_id) cambios.push(`categoría → ${esc(catN(d.categoria_id))}`);
          if (a.tipo !== d.tipo) cambios.push(`tipo → ${TIPOS[d.tipo].l}`);
        }
        return `<div><b>${esc(l.por || "")}</b> ${l.accion === "anulado" ? "lo anuló" : "lo editó"} · ${cuando(l.at)}${cambios.length ? "<br>" + cambios.join(" · ") : ""}</div>`;
      }).join("")}</div>`;
    } catch (_) {}
  }
  function anularSheet(id) {
    if (!needMe()) return;
    const m = movPorId(id);
    openSheet(`<div class="sh"><h3>Anular movimiento</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="af"><p class="note">Se deja de contar en saldos y resúmenes, pero queda visible tachado con tu nombre y el motivo. <b>${esc(m.detalle || TIPOS[m.tipo].l)} · ${fmt(m.monto)}</b></p>
      <label class="fl"><span>¿Por qué se anula?</span><input id="aMot" required maxlength="120" placeholder="Ej: cargado dos veces"></label>
      <div class="chips">${["Cargado dos veces", "Monto equivocado", "Era de prueba", "No se hizo"].map((x) => `<button type="button" class="chip" data-mot="${x}">${x}</button>`).join("")}</div>
      <p class="err" id="aerr" hidden></p>
      <button class="btn danger big" type="submit">Anular</button></form>`, (sh) => {
      sh.onclick = (e) => { const b = e.target.closest("[data-mot]"); if (b) sh.querySelector("#aMot").value = b.dataset.mot; };
      sh.onsubmit = async (e) => {
        e.preventDefault();
        try { fail(await sb.from("caja_movimientos").update({ estado: "anulado", anulado_por: S.me, anulado_motivo: sh.querySelector("#aMot").value.trim() }).eq("id", id)); closeSheet(); toast("Movimiento anulado"); await loadAll(); render(); }
        catch (err) { const r = sh.querySelector("#aerr"); r.textContent = err.message; r.hidden = false; }
      };
    });
  }
  function contarSheet(cuenta) {
    if (!needMe()) return;
    const s = S.saldos.find((x) => x.id === cuenta);
    const draw = (sh, val) => {
      const v = parseMoney(val), d = v >= 0 ? Math.round((v - Number(s.saldo)) * 100) / 100 : NaN;
      sh.querySelector("#cprev").innerHTML = isNaN(d) ? "" : d === 0 ? `<p class="note ok">Coincide justo. No hace falta ajustar.</p>` : `<p class="note">Diferencia: <b>${signed(d)}</b>. Se carga un ajuste para que el saldo quede en ${fmt(v)}.</p>`;
    };
    openSheet(`<div class="sh"><h3>Contar ${esc(s.nombre)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="cf"><p class="muted" style="font-size:.9rem">Según los movimientos debería haber <b>${money(s.saldo)}</b>. ${cuenta === "mp" ? "Mirá el saldo en la app de Mercado Pago" : "Contá la plata"} y poné lo que hay de verdad.</p>
      <label class="fl monto"><input id="cVal" inputmode="decimal" placeholder="0" aria-label="Lo que hay"></label>
      <div id="cprev"></div>
      <label class="fl"><span>Nota (opcional)</span><input id="cNota" maxlength="100" placeholder="Ej: faltaba cargar un vuelto"></label>
      <p class="err" id="cerr" hidden></p>
      <button class="btn solid big" type="submit">Guardar conteo</button></form>`, (sh) => {
      sh.querySelector("#cVal").focus();
      sh.oninput = (e) => { if (e.target.id === "cVal") draw(sh, e.target.value); };
      sh.onsubmit = async (e) => {
        e.preventDefault();
        const v = parseMoney(sh.querySelector("#cVal").value), er = sh.querySelector("#cerr");
        if (!(v >= 0)) { er.textContent = "Poné el monto que contaste"; er.hidden = false; return; }
        try {
          const r = fail(await sb.rpc("caja_contar", { p_cuenta: cuenta, p_contado: v, p_registro: S.me, p_nota: sh.querySelector("#cNota").value || null }));
          closeSheet(); toast(Number(r.delta) ? `Ajuste de ${signed(r.delta)} cargado` : "Coincide: no hizo falta ajustar"); await loadAll(); render();
        } catch (err) { er.textContent = err.message; er.hidden = false; }
      };
    });
  }

  /* ---------- STOCK ---------- */
  const LUG = { cafe: "Café", produ: "Produ" };
  function vStock() {
    const items = S.stock.filter((i) => i.activo);
    $("#view").innerHTML = `<h1 class="h1">Stock</h1>
      <p class="muted" style="font-size:.88rem;margin-bottom:12px"><b>+</b> suma producción y <b>−</b> descuenta una venta. Podés tocar varias veces seguidas: se guarda todo junto cuando parás. Para cantidades grandes, trasladar o corregir, tocá <b>Más</b>.</p>
      <div class="stk">${items.map((i) => {
        const low = i.minimo > 0 && i.cafe + i.produ <= i.minimo;
        return `<div class="sitem ${low ? "low" : ""}" data-item="${i.id}"><div class="top"><b>${esc(i.nombre)}</b>${low ? '<span class="pri urg">poco</span>' : ""}<button data-smas="${i.id}">Más</button></div>
          <div class="places">${["cafe", "produ"].map((l) => `<div class="place"><span class="n"><span>${LUG[l]}</span><b class="num">${i[l]}</b></span>
            <span class="stp"><button data-sq="${i.id}|${l}|-1" aria-label="Restar uno en ${LUG[l]}">−</button><button class="p" data-sq="${i.id}|${l}|1" aria-label="Sumar uno en ${LUG[l]}">+</button></span></div>`).join("")}</div>
          ${(() => { const rv = (S.reservas || {})[i.id]; return rv ? `<span class="hintp reserva">${rv.reservado > 0 ? `<b>${rv.reservado}</b> reservado${rv.reservado > 1 ? "s" : ""} en pedidos web pendientes · ` : ""}En la web: <b>${Math.max(0, rv.disponible)}</b></span>` : ""; })()}
          ${i.actualizado ? `<span class="hintp">Último cambio ${cuando(i.actualizado)}</span>` : ""}</div>`;
      }).join("") || `<div class="emptyc"><img src="img/mochito-lie.png" alt=""><span>No hay productos en el stock.</span></div>`}</div>
      <div class="toolsrow"><button class="ghost" data-snew>+ Agregar producto</button><button class="ghost" data-shist>Ver últimos cambios</button><a class="ghost" href="panel.html#ajustes/stock_web">Cómo se ve en la web →</a></div>`;
  }
  /* Los + y − se juntan: cada toque cambia el número al instante y recién
     cuando paran de tocar (STOCK_WAIT ms) se guarda un solo movimiento con el
     total. Así varios toques seguidos no se pisan ni hacen una llamada cada uno. */
  const STOCK_WAIT = 800;
  const stockPend = {};   // "item|lugar" → { delta, t } todavía sin enviar
  const stockFly = {};    // "item|lugar" → delta enviándose ahora
  const sgn = (n) => (n > 0 ? "+" : "−") + Math.abs(n);
  const stockBusy = () => Object.keys(stockPend).length > 0 || Object.keys(stockFly).length > 0;
  function stockApplyLocal() {
    // al recargar de la base, volver a sumar lo que todavía no llegó
    [stockPend, stockFly].forEach((m) => Object.keys(m).forEach((k) => {
      const [item, lugar] = k.split("|"), it = S.stock.find((x) => x.id === item);
      if (it) it[lugar] += m === stockPend ? m[k].delta : m[k];
    }));
  }
  function stockQuick(item, lugar, d) {
    if (!needMe()) return;
    const it = S.stock.find((x) => x.id === item);
    if (!it) return;
    if (d < 0 && it[lugar] + d < 0) return toast(`No hay en ${LUG[lugar]}. Usá Más → Contar si el número está mal.`);
    const k = `${item}|${lugar}`, p = stockPend[k] || (stockPend[k] = { delta: 0, t: 0 });
    p.delta += d; it[lugar] += d;
    if (S.view === "stock") vStock();
    clearTimeout(p.t);
    p.t = setTimeout(() => stockFlush(k), STOCK_WAIT);
  }
  async function stockFlush(k) {
    const p = stockPend[k];
    if (!p) return;
    clearTimeout(p.t); delete stockPend[k];
    if (!p.delta) return softReload();
    while (stockFly[k] !== undefined) await new Promise((r) => setTimeout(r, 100)); // uno por vez por producto
    const [item, lugar] = k.split("|"), d = p.delta, it = S.stock.find((x) => x.id === item);
    stockFly[k] = d;
    try {
      fail(await sb.from("caja_stock_mov").insert({ item_id: item, lugar, delta: d, motivo: d > 0 ? "produccion" : "venta", registro: S.me }));
      toast(`${it ? it.nombre : "Stock"}: ${sgn(d)} en ${LUG[lugar]}`);
    } catch (e) {
      if (it) it[lugar] -= d;
      if (S.view === "stock") vStock();
      toast(`No se guardó ${sgn(d)} de ${it ? it.nombre : "stock"}: ${e.message}`);
    } finally { delete stockFly[k]; softReload(); }
  }
  // si cierran o minimizan la app, guardar ya lo pendiente
  const stockFlushAll = () => Object.keys(stockPend).forEach(stockFlush);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stockFlushAll(); });
  window.addEventListener("pagehide", stockFlushAll);
  function stockMas(item) {
    if (!needMe()) return;
    const it = S.stock.find((x) => x.id === item);
    const A = { acc: "mover", lugar: "cafe", desde: "produ", motivo: "produccion" };
    const draw = (sh) => {
      const f = { mover: `<div class="fl"><span>Desde</span><div class="seg">${["produ", "cafe"].map((l) => `<button type="button" data-a="desde" data-v="${l}" aria-pressed="${A.desde === l}">${LUG[l]} (${it[l]})</button>`).join("")}</div></div><p class="hintp">Va a ${LUG[A.desde === "produ" ? "cafe" : "produ"]}.</p>`,
        sumar: `<div class="fl"><span>Dónde</span><div class="seg">${["cafe", "produ"].map((l) => `<button type="button" data-a="lugar" data-v="${l}" aria-pressed="${A.lugar === l}">${LUG[l]}</button>`).join("")}</div></div>`,
        sacar: `<div class="fl"><span>Dónde</span><div class="seg">${["cafe", "produ"].map((l) => `<button type="button" data-a="lugar" data-v="${l}" aria-pressed="${A.lugar === l}">${LUG[l]} (${it[l]})</button>`).join("")}</div></div><div class="fl"><span>Motivo</span><div class="chips">${[["venta", "Venta"], ["merma", "Merma / se rompió"], ["otro", "Otro"]].map(([v, l]) => `<button type="button" class="chip" data-a="motivo" data-v="${v}" aria-pressed="${A.motivo === v}">${l}</button>`).join("")}</div></div>`,
        contar: `<div class="fl"><span>Dónde</span><div class="seg">${["cafe", "produ"].map((l) => `<button type="button" data-a="lugar" data-v="${l}" aria-pressed="${A.lugar === l}">${LUG[l]} (${it[l]})</button>`).join("")}</div></div><p class="hintp">Poné cuántos hay de verdad. Se corrige la diferencia.</p>`,
      }[A.acc];
      sh.innerHTML = `<div class="grab"></div><div class="sh"><h3>${esc(it.nombre)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
        <form class="form" id="sf"><div class="seg">${[["mover", "Trasladar"], ["sumar", "Sumar"], ["sacar", "Sacar"], ["contar", "Contar"]].map(([k, l]) => `<button type="button" data-a="acc" data-v="${k}" aria-pressed="${A.acc === k}">${l}</button>`).join("")}</div>
        ${f}<label class="fl"><span>${A.acc === "contar" ? "Hay" : "Cantidad"}</span><input id="sCant" type="number" inputmode="numeric" min="0" step="1" value="${A.cant ?? ""}" placeholder="0"></label>
        <p class="err" id="serr" hidden></p><button class="btn solid big" type="submit">Guardar</button>
        <div class="toolsrow"><button type="button" class="ghost" data-sedit="${it.id}">Nombre y alerta de poco stock</button></div></form>`;
    };
    openSheet("", draw);
    const sh = $("#sheet");
    sh.onclick = (e) => { const b = e.target.closest("[data-a]"); if (!b) return; A.cant = sh.querySelector("#sCant").value; A[b.dataset.a] = b.dataset.v; if (b.dataset.a === "acc" && b.dataset.v === "sacar") A.motivo = "venta"; draw(sh); };
    sh.onsubmit = async (e) => {
      e.preventDefault();
      const n = parseInt(sh.querySelector("#sCant").value, 10), er = sh.querySelector("#serr");
      if (!(n >= 0) || (A.acc !== "contar" && n === 0)) { er.textContent = "Poné una cantidad"; er.hidden = false; return; }
      try {
        if (A.acc === "mover") { if (n > it[A.desde]) throw new Error(`En ${LUG[A.desde]} hay ${it[A.desde]}`); fail(await sb.rpc("caja_stock_traslado", { p_item: it.id, p_desde: A.desde, p_hacia: A.desde === "produ" ? "cafe" : "produ", p_cant: n, p_registro: S.me })); }
        if (A.acc === "sumar") fail(await sb.from("caja_stock_mov").insert({ item_id: it.id, lugar: A.lugar, delta: n, motivo: "produccion", registro: S.me }));
        if (A.acc === "sacar") { if (n > it[A.lugar]) throw new Error(`En ${LUG[A.lugar]} hay ${it[A.lugar]}`); fail(await sb.from("caja_stock_mov").insert({ item_id: it.id, lugar: A.lugar, delta: -n, motivo: A.motivo, registro: S.me })); }
        if (A.acc === "contar") fail(await sb.rpc("caja_stock_contar", { p_item: it.id, p_lugar: A.lugar, p_cant: n, p_registro: S.me }));
        closeSheet(); toast("Stock actualizado"); await loadAll(); render();
      } catch (err) { er.textContent = err.message; er.hidden = false; }
    };
  }
  async function stockItemSheet(id) {
    const it = id ? S.stock.find((x) => x.id === id) : { nombre: "", unidad: "unidades", minimo: 0 };
    // vínculo con la web: el stock de este ítem es el que ve la web para ese mochi (también los del Especial)
    let prods = [], links = [];
    try { [prods, links] = (await Promise.all([sb.from("products").select("id,nombre,categoria,formato,activo").in("categoria", ["mochi", "especial"]).order("orden"), sb.from("caja_stock_items").select("id,product_id").not("product_id", "is", null)])).map(fail); } catch (_) {}
    const mio = (links.find((l) => l.id === id) || {}).product_id || "", usados = links.filter((l) => l.id !== id).map((l) => l.product_id);
    const webOpts = prods.filter((p) => (p.categoria === "mochi" || (p.formato || "mochi") === "mochi") && (p.id === mio || !usados.includes(p.id)))
      .map((p) => `<option value="${esc(p.id)}" ${p.id === mio ? "selected" : ""}>${esc((p.categoria === "especial" ? "Especial · " : "Mochi ") + p.nombre)}${p.activo === false ? " (oculto)" : ""}</option>`).join("");
    openSheet(`<div class="sh"><h3>${id ? "Editar producto" : "Nuevo producto"}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="sif"><label class="fl"><span>Nombre</span><input id="siN" value="${esc(it.nombre)}" required maxlength="60" placeholder="Ej: Mochi Lemon pie"></label>
      ${prods.length ? `<label class="fl"><span>Producto de la web</span><select id="siP"><option value="">— Ninguno (solo stock interno)</option>${webOpts}</select></label>
      <p class="hintp">Si lo vinculás, la web muestra "Quedan N" / "¡Últimos!" con este stock y no deja pedir más de lo que hay.</p>` : ""}
      <label class="fl"><span>Avisar cuando queden (total) o menos</span><input id="siM" type="number" min="0" value="${it.minimo || 0}"></label>
      <p class="hintp">0 = sin aviso.</p><p class="err" id="sierr" hidden></p>
      <button class="btn solid big" type="submit">Guardar</button>
      ${id ? `<button type="button" class="btn danger" data-sarch="${id}">Ocultar del stock</button>` : ""}</form>`, (sh) => {
      sh.onsubmit = async (e) => {
        e.preventDefault();
        const row = { nombre: sh.querySelector("#siN").value.trim(), minimo: Math.max(0, parseInt(sh.querySelector("#siM").value, 10) || 0) };
        const sp = sh.querySelector("#siP"); if (sp) row.product_id = sp.value || null;
        try { if (id) fail(await sb.from("caja_stock_items").update(row).eq("id", id)); else fail(await sb.from("caja_stock_items").insert(Object.assign(row, { orden: S.stock.length + 1 }))); closeSheet(); toast("Guardado"); await loadAll(); render(); }
        catch (err) { const r = sh.querySelector("#sierr"); r.textContent = /duplicate/.test(err.message) ? "Ya existe un producto con ese nombre" : err.message; r.hidden = false; }
      };
    });
  }
  async function stockHist() {
    const r = fail(await sb.from("caja_stock_mov").select("*").order("created_at", { ascending: false }).limit(60));
    const nm = (id) => (S.stock.find((x) => x.id === id) || {}).nombre || "";
    const MOT = { produccion: "Producción", venta: "Venta", merma: "Merma", traslado: "Traslado", conteo: "Conteo", otro: "Otro" };
    openSheet(`<div class="sh"><h3>Últimos cambios de stock</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="items">${r.map((m) => `<div class="it ${m.estado === "anulado" ? "done" : ""}"><span class="t"><b>${esc(nm(m.item_id))} · ${LUG[m.lugar]}</b><span>${MOT[m.motivo]} · ${esc(m.registro)} · ${cuando(m.created_at)}</span></span>
        <span class="a ${m.delta > 0 ? "pos" : "neg"}" style="font-weight:700">${m.delta > 0 ? "+" : "−"}${Math.abs(m.delta)}</span>
        ${m.estado === "activo" && !m.lote ? `<button class="linkbtn warn" data-sanul="${m.id}">Anular</button>` : ""}</div>`).join("")}</div>`);
  }

  /* ---------- TAREAS ---------- */
  const PRI = { alta: "Alta", media: "Media", baja: "Baja" };
  const NT = { asignada: "Cualquiera", prioridad: "media" };
  function vTareas() {
    const pend = S.tareas.filter((t) => t.estado === "pendiente").sort((a, b) => ["alta", "media", "baja"].indexOf(a.prioridad) - ["alta", "media", "baja"].indexOf(b.prioridad) || (a.created_at < b.created_at ? -1 : 1));
    const hechas = S.tareas.filter((t) => t.estado === "hecha").sort((a, b) => (b.hecha_at || "").localeCompare(a.hecha_at || ""));
    const mias = S.me ? pend.filter((t) => t.asignada === S.me).length : 0;
    $("#view").innerHTML = `<h1 class="h1">Tareas</h1>
      <form class="addrow" id="tadd"><input id="tTit" placeholder="Nueva tarea…" maxlength="120"><button class="btn solid" type="submit">Agregar</button></form>
      <div class="filters"><span class="hintp" style="align-self:center;flex:none">Para:</span>${["Cualquiera", ...S.socios.filter((s) => s.activo).map((s) => s.nombre)].map((n) => `<button class="chip" data-nt="asignada" data-v="${esc(n)}" aria-pressed="${NT.asignada === n}">${esc(n)}</button>`).join("")}
        <span class="hintp" style="align-self:center;flex:none;margin-left:6px">Prioridad:</span>${Object.entries(PRI).map(([k, l]) => `<button class="chip" data-nt="prioridad" data-v="${k}" aria-pressed="${NT.prioridad === k}">${l}</button>`).join("")}</div>
      <h2 class="h2">Pendientes <small>${pend.length}${mias ? ` · ${mias} para vos` : ""}</small></h2>
      ${pend.length ? `<div class="items">${pend.map(tRow).join("")}</div>` : `<div class="emptyc"><img src="img/mochito-run.png" alt=""><span>No hay nada pendiente.</span></div>`}
      ${hechas.length ? `<button class="ghost foldbtn" data-verhechas>${S.verHechas ? "Ocultar" : "Ver"} hechas (${hechas.length})</button>${S.verHechas ? `<div class="items" style="margin-top:10px">${hechas.slice(0, 40).map(tRow).join("")}</div>` : ""}` : ""}`;
  }
  function tRow(t) {
    const done = t.estado === "hecha";
    return `<div class="it ${done ? "done" : ""}"><button class="ck ${done ? "on" : ""}" data-tck="${t.id}" aria-label="${done ? "Reabrir" : "Marcar hecha"}">${done ? "✓" : ""}</button>
      <button class="t" data-topen="${t.id}"><b>${esc(t.titulo)}</b><span>${esc(t.asignada === "Cualquiera" ? "Cualquiera" : "Para " + t.asignada)}${done ? ` · hecha por ${esc(t.hecha_por || "")} ${t.hecha_at ? cuando(t.hecha_at) : ""}` : ` · ${esc(t.creada_por)}`}</span></button>
      ${!done && t.prioridad !== "media" ? `<span class="pri ${t.prioridad}">${PRI[t.prioridad]}</span>` : ""}</div>`;
  }
  function tareaSheet(id) {
    const t = S.tareas.find((x) => x.id === id); const D = { asignada: t.asignada, prioridad: t.prioridad };
    const draw = (sh) => {
      sh.innerHTML = `<div class="grab"></div><div class="sh"><h3>Tarea</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="tf"><label class="fl"><span>Qué hay que hacer</span><input id="tfT" value="${esc(t.titulo)}" maxlength="120"></label>
      <div class="fl"><span>Para</span><div class="chips">${["Cualquiera", ...S.socios.map((s) => s.nombre)].map((n) => `<button type="button" class="chip" data-d="asignada" data-v="${esc(n)}" aria-pressed="${D.asignada === n}">${esc(n)}</button>`).join("")}</div></div>
      <div class="fl"><span>Prioridad</span><div class="seg">${Object.entries(PRI).map(([k, l]) => `<button type="button" data-d="prioridad" data-v="${k}" aria-pressed="${D.prioridad === k}">${l}</button>`).join("")}</div></div>
      <p class="hintp">Creada por ${esc(t.creada_por)} · ${cuando(t.created_at)}</p>
      <button class="btn solid big" type="submit">Guardar</button>
      <button type="button" class="btn danger" data-tarch="${t.id}">Archivar</button></form>`;
    };
    openSheet("", draw);
    const sh = $("#sheet");
    sh.onclick = (e) => { const b = e.target.closest("[data-d]"); if (!b) return; t._tit = sh.querySelector("#tfT").value; D[b.dataset.d] = b.dataset.v; draw(sh); sh.querySelector("#tfT").value = t._tit; };
    sh.onsubmit = async (e) => { e.preventDefault(); try { fail(await sb.from("caja_tareas").update({ titulo: sh.querySelector("#tfT").value.trim(), asignada: D.asignada, prioridad: D.prioridad, updated_at: new Date().toISOString() }).eq("id", id)); closeSheet(); await loadAll(); render(); } catch (err) { toast(err.message); } };
  }

  /* ---------- COMPRAS ---------- */
  function vCompras() {
    const pend = S.compras.filter((c) => c.estado === "pendiente").sort((a, b) => (b.urgente - a.urgente) || (a.created_at < b.created_at ? -1 : 1));
    const comp = S.compras.filter((c) => c.estado === "comprado").sort((a, b) => (b.comprada_at || "").localeCompare(a.comprada_at || ""));
    $("#view").innerHTML = `<h1 class="h1">Lista de compras</h1>
      <form class="addrow" id="cadd"><input id="cIt" placeholder="¿Qué falta? Ej: crema x2 · Makro" maxlength="100"><button class="btn solid" type="submit">Agregar</button></form>
      <p class="hintp" style="margin:-4px 0 10px">Tip: después de "·" podés poner dónde comprarlo. Al tildar, te ofrece cargar el gasto.</p>
      <h2 class="h2">Falta comprar <small>${pend.length}</small></h2>
      ${pend.length ? `<div class="items">${pend.map(cRow).join("")}</div>` : `<div class="emptyc"><img src="img/mochito-run.png" alt=""><span>No falta nada.</span></div>`}
      ${comp.length ? `<button class="ghost foldbtn" data-vercomp>${S.verComp ? "Ocultar" : "Ver"} comprados (${comp.length})</button>${S.verComp ? `<div class="items" style="margin-top:10px">${comp.slice(0, 40).map(cRow).join("")}</div>` : ""}` : ""}`;
  }
  function cRow(c) {
    const done = c.estado === "comprado";
    const sub = [c.cantidad, c.donde, done ? `comprado por ${c.comprada_por || ""}${c.comprada_at ? " " + cuando(c.comprada_at) : ""}` : c.creada_por, done && c.movimiento_id ? "gasto cargado" : null].filter(Boolean).join(" · ");
    return `<div class="it ${done ? "done" : ""}"><button class="ck ${done ? "on" : ""}" data-cck="${c.id}" aria-label="${done ? "Volver a la lista" : "Marcar comprado"}">${done ? "✓" : ""}</button>
      <button class="t" data-copen="${c.id}"><b>${esc(c.item)}</b><span>${esc(sub)}</span></button>${c.urgente && !done ? '<span class="pri urg">Urgente</span>' : ""}</div>`;
  }
  function compraSheet(id) {
    const c = S.compras.find((x) => x.id === id);
    openSheet(`<div class="sh"><h3>Editar</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <form class="form" id="cef"><label class="fl"><span>Qué</span><input id="ceI" value="${esc(c.item)}" maxlength="100"></label>
      <div class="row2"><label class="fl"><span>Cantidad</span><input id="ceC" value="${esc(c.cantidad || "")}" maxlength="30"></label><label class="fl"><span>Dónde</span><input id="ceD" value="${esc(c.donde || "")}" maxlength="40"></label></div>
      <label class="checks" style="font-weight:600"><input type="checkbox" id="ceU" ${c.urgente ? "checked" : ""} style="width:auto"> Urgente</label>
      <button class="btn solid big" type="submit">Guardar</button><button type="button" class="btn danger" data-cquit="${c.id}">Quitar de la lista</button></form>`, (sh) => {
      sh.onsubmit = async (e) => { e.preventDefault(); try { fail(await sb.from("caja_compras").update({ item: sh.querySelector("#ceI").value.trim(), cantidad: sh.querySelector("#ceC").value.trim() || null, donde: sh.querySelector("#ceD").value.trim() || null, urgente: sh.querySelector("#ceU").checked }).eq("id", id)); closeSheet(); await loadAll(); render(); } catch (err) { toast(err.message); } };
    });
  }
  function compradoSheet(id) {
    if (!needMe()) return;
    const c = S.compras.find((x) => x.id === id);
    const marcar = async (movId) => { fail(await sb.from("caja_compras").update({ estado: "comprado", comprada_por: S.me, comprada_at: new Date().toISOString(), movimiento_id: movId || null }).eq("id", id)); };
    openSheet(`<div class="sh"><h3>Compraste ${esc(c.item)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
      <p class="muted" style="margin-bottom:14px">¿Cargamos el gasto ahora? Así no queda colgado.</p>
      <div class="btnrow"><button class="btn solid big" data-cgasto="${id}">Sí, cargar el gasto</button></div>
      <div class="btnrow" style="margin-top:10px"><button class="btn" data-csolo="${id}">Solo tildar (el gasto ya está cargado)</button></div>`, (sh) => {
      sh.onclick = async (e) => {
        const b = e.target.closest("[data-cgasto],[data-csolo]"); if (!b) return;
        if (b.dataset.csolo) { try { await marcar(null); closeSheet(); toast("Tildado"); await loadAll(); render(); } catch (err) { toast(err.message); } return; }
        closeSheet();
        /* al guardar el gasto, la compra se tilda sola y queda enlazada a ese gasto */
        movForm({ tipo: "gasto", detalle: c.item + (c.cantidad ? " x" + c.cantidad : "") + (c.donde ? " · " + c.donde : "") }, null, (movId) => marcar(movId));
      };
    });
  }

  /* ---------- eventos ---------- */
  document.addEventListener("click", async (e) => {
    if (e.target.id === "sheetBg") { if ($("#sheet").querySelector("[data-close]")) closeSheet(); return; }
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.close !== undefined) { closeSheet(); return; }
    if (d.go) return go(d.go);
    if (d.who !== undefined) return whoSheet();
    if (d.iam) { S.me = d.iam; localStorage.setItem("setto-caja-yo", S.me); closeSheet(); render(); toast(`Hola, ${S.me}`); return; }
    if (d.new !== undefined) return movForm(S.view === "retiros" ? { tipo: "retiro", socio_id: S.r.socio === "todos" ? null : S.r.socio } : {});
    if (d.mes) { S.mes = mesMov(S.mes, +d.mes); return render(); }
    if (d.contar) return contarSheet(d.contar);
    if (d.devolver) { const dd = S.deudas.find((x) => x.id === d.devolver); return movForm({ tipo: "devolucion", socio_id: d.devolver, monto: String(Number(dd.le_debemos)).replace(".", ","), detalle: "Devolución a " + dd.nombre }); }
    if (d.mov) return movDetail(d.mov);
    if (d.edit) { const m = movPorId(d.edit); closeSheet(); return movForm({ tipo: m.tipo, monto: String(Number(m.monto)).replace(".", ","), detalle: m.detalle, cuenta_id: m.cuenta_id || (S.cuentas[0] || {}).id, cuenta_destino_id: m.cuenta_destino_id, socio_id: m.socio_id, categoria_id: m.categoria_id, fecha: m.fecha, pagador: m.tipo === "gasto" && m.socio_id ? m.socio_id : "caja", _touched: true }, m.id); }
    if (d.dup) { const m = movPorId(d.dup); closeSheet(); return movForm({ tipo: m.tipo, monto: String(Number(m.monto)).replace(".", ","), detalle: m.detalle, cuenta_id: m.cuenta_id || (S.cuentas[0] || {}).id, cuenta_destino_id: m.cuenta_destino_id, socio_id: m.socio_id, categoria_id: m.categoria_id, pagador: m.tipo === "gasto" && m.socio_id ? m.socio_id : "caja" }); }
    if (d.anular) { closeSheet(); return anularSheet(d.anular); }
    if (d.f) { S.f[d.f] = d.v; return render(); }
    if (d.rf) { S.r[d.rf] = d.v; return render(); }
    if (d.rper) { const k = perMov(perDe(S.r.ref, S.r.modo), S.r.modo, +d.rper); S.r.ref = S.r.modo === "mes" ? k + "-01" : k; return render(); }
    if (d.rir) { S.r.ref = S.r.modo === "mes" ? d.rir + "-01" : d.rir; render(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (d.rhoy !== undefined) { S.r.ref = hoy(); return render(); }
    if (d.rnew !== undefined) return movForm({ tipo: "retiro", socio_id: S.r.socio === "todos" ? null : S.r.socio });
    if (d.rcsv !== undefined) return csvRetiros();
    if (d.anul !== undefined) { S.f.anul = !S.f.anul; return render(); }
    if (d.csv !== undefined) return csvMes();
    /* stock */
    if (d.sq) { const [i, l, n] = d.sq.split("|"); return stockQuick(i, l, +n); }
    if (d.smas) return stockMas(d.smas);
    if (d.snew !== undefined) return stockItemSheet(null);
    if (d.sedit) { closeSheet(); return stockItemSheet(d.sedit); }
    if (d.sarch) { try { fail(await sb.from("caja_stock_items").update({ activo: false }).eq("id", d.sarch)); closeSheet(); await loadAll(); render(); toast("Oculto del stock"); } catch (err) { toast(err.message); } return; }
    if (d.shist !== undefined) { try { await stockHist(); } catch (err) { toast(err.message); } return; }
    if (d.sanul) { if (!needMe()) return; try { fail(await sb.from("caja_stock_mov").update({ estado: "anulado", anulado_por: S.me }).eq("id", d.sanul)); toast("Anulado"); await loadAll(); render(); await stockHist(); } catch (err) { toast(err.message); } return; }
    /* tareas */
    if (d.nt) { NT[d.nt] = d.v; return render(); }
    if (d.tck) {
      if (!needMe()) return;
      const t = S.tareas.find((x) => x.id === d.tck), done = t.estado === "hecha";
      try { fail(await sb.from("caja_tareas").update(done ? { estado: "pendiente", hecha_por: null, hecha_at: null, updated_at: new Date().toISOString() } : { estado: "hecha", hecha_por: S.me, hecha_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", t.id)); toast(done ? "Volvió a pendientes" : "¡Hecha!"); await loadAll(); render(); } catch (err) { toast(err.message); }
      return;
    }
    if (d.topen) return tareaSheet(d.topen);
    if (d.tarch) { try { fail(await sb.from("caja_tareas").update({ estado: "archivada", updated_at: new Date().toISOString() }).eq("id", d.tarch)); closeSheet(); await loadAll(); render(); toast("Archivada"); } catch (err) { toast(err.message); } return; }
    if (d.verhechas !== undefined) { S.verHechas = !S.verHechas; return render(); }
    /* compras */
    if (d.cck) {
      const c = S.compras.find((x) => x.id === d.cck);
      if (c.estado === "comprado") { try { fail(await sb.from("caja_compras").update({ estado: "pendiente", comprada_por: null, comprada_at: null }).eq("id", c.id)); await loadAll(); render(); } catch (err) { toast(err.message); } return; }
      return compradoSheet(d.cck);
    }
    if (d.copen) return compraSheet(d.copen);
    if (d.cquit) { try { fail(await sb.from("caja_compras").update({ estado: "quitada" }).eq("id", d.cquit)); closeSheet(); await loadAll(); render(); toast("Quitado de la lista"); } catch (err) { toast(err.message); } return; }
    if (d.vercomp !== undefined) { S.verComp = !S.verComp; return render(); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "mq") { S.f.q = e.target.value; const p = e.target.selectionStart; render(); const i = $("#mq"); i.focus(); i.setSelectionRange(p, p); } });
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "tadd") {
      e.preventDefault(); if (!needMe()) return;
      const v = $("#tTit").value.trim(); if (!v) return;
      try { fail(await sb.from("caja_tareas").insert({ titulo: v, asignada: NT.asignada, prioridad: NT.prioridad, creada_por: S.me })); await loadAll(); render(); $("#tTit").focus(); } catch (err) { toast(err.message); }
    }
    if (e.target.id === "cadd") {
      e.preventDefault(); if (!needMe()) return;
      const raw = $("#cIt").value.trim(); if (!raw) return;
      let [item, donde] = raw.split("·").map((s) => s.trim());
      let cantidad = null; const m = item.match(/^(.*?)\s+x\s*(\S+)$/i); if (m) { item = m[1]; cantidad = m[2]; }
      try { fail(await sb.from("caja_compras").insert({ item, cantidad, donde: donde || null, creada_por: S.me })); await loadAll(); render(); $("#cIt").focus(); } catch (err) { toast(err.message); }
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden && $("#sheet").querySelector("[data-close]")) { closeSheet(); } });

  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v && v !== S.view) { S.view = v; render(); } });
  start();
})();
