/* Panel del equipo de Setto: pedidos, Club, carta y ajustes */
(function () {
  const API = window.SettoAPI;
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const money = (n) => (Number(n) < 0 ? "−$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-AR");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pretty = API.prettyPhone;
  let toastT;
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); };
  const ago = (iso) => {
    const d = new Date(iso), m = Math.round((Date.now() - d) / 60000);
    const hh = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (m < 1) return "recién · " + hh; if (m < 60) return `hace ${m} min · ${hh}`;
    if (m < 1440) return `hace ${Math.round(m / 60)} h · ${hh}`;
    return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) + " · " + hh;
  };

  const P = { user: null, view: "pedidos", sub: "pendiente", q: "", settings: {}, products: [], orders: [], pendCount: 0, drafts: {}, confirm: {}, client: null, cancelArm: null };

  /* =================== LOGIN =================== */
  function drawLogin(msg) {
    app.innerHTML = `<div class="loginwrap"><form class="loginbox" id="login">
      <img class="l" src="img/logo.png" alt="Setto">
      <h1 class="ph1">Panel del equipo</h1>
      ${API.DEMO ? `<p class="note-demo">Modo demo: todavía no cargaste las claves de Supabase en <b>js/config.js</b>. Entrás sin usuario y los datos quedan en este navegador.</p>`
        : `<label class="f" for="lEmail">Email<input id="lEmail" type="email" autocomplete="username" required></label>
           <label class="f" for="lPass">Contraseña<input id="lPass" type="password" autocomplete="current-password" required></label>`}
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn solid big" type="submit">${API.DEMO ? "Entrar en modo demo" : "Entrar"}</button>
    </form></div>`;
    $("#login").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        P.user = await API.signIn(API.DEMO ? "" : $("#lEmail").value.trim(), API.DEMO ? "" : $("#lPass").value);
        await afterLogin();
      } catch (err) { drawLogin(err.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : err.message); }
    });
  }
  async function afterLogin() {
    if (!(await API.isStaff())) {
      app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Usuario sin permiso</h1><p>Tu usuario existe pero no está habilitado como equipo de Setto. Pedile a Isa que lo agregue (ver README, paso 4).</p><button class="btn" id="logout">Salir</button></div></div>`;
      return;
    }
    await loadBase(); drawShell(); go(P.view);
    API.onOrders(() => { refreshOrders(true); });
    setInterval(() => refreshOrders(false), 30000);
  }
  async function loadBase() { const { settings, products } = await API.loadAll(); P.settings = settings; P.products = products; }

  /* =================== ESTRUCTURA =================== */
  function drawShell() {
    app.innerHTML = `<header class="pbar"><div class="wrap">
        <a class="logo" href="index.html" title="Ver el sitio"><img src="img/logo.png" alt="Setto"></a><span class="tag">Panel</span>
        <nav class="ptabs" role="tablist">
          ${[["pedidos", "Pedidos"], ["club", "Club"], ["carta", "Carta"], ["ajustes", "Ajustes"]].map(([k, l]) => `<button class="ptab" role="tab" data-view="${k}" aria-selected="false">${l}${k === "pedidos" ? ' <span class="n" id="pendN" hidden>0</span>' : ""}</button>`).join("")}
          <a class="ptab" href="caja.html">Caja</a>
        </nav>
        <span class="who">${esc(P.user && P.user.email || "")}<button id="logout">Salir</button></span>
      </div></header>
      <main class="pmain"><div class="wrap" id="view"></div></main>`;
  }
  function go(v) {
    P.view = v;
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    ({ pedidos: viewPedidos, club: viewClub, carta: viewCarta, ajustes: viewAjustes })[v]();
  }

  /* =================== PEDIDOS =================== */
  async function refreshOrders(notify) {
    try {
      const pend = await API.listOrders("pendiente");
      const prev = P.pendCount; P.pendCount = pend.length;
      const n = $("#pendN"); if (n) { n.textContent = pend.length; n.hidden = !pend.length; }
      document.title = (pend.length ? `(${pend.length}) ` : "") + "Panel Setto";
      if (notify && pend.length > prev) toast("Entró un pedido nuevo");
      if (P.view === "pedidos") { P.orders = P.sub === "pendiente" ? pend : await API.listOrders(P.sub); drawOrders(); }
    } catch (e) { console.error(e); }
  }
  function viewPedidos() {
    $("#view").innerHTML = `<h1 class="ph1">Pedidos</h1>
      <p class="muted">Cuando llega el WhatsApp, buscá el código, revisá que el número del chat sea el mismo y tocá <b>Entregado</b> cuando lo retiran o lo reciben.</p>
      <div class="sub">
        ${[["pendiente", "Pendientes"], ["entregado", "Entregados (7 días)"], ["cancelado", "Cancelados"]].map(([k, l]) => `<button class="ptab" data-sub="${k}" aria-selected="${P.sub === k}">${l}</button>`).join("")}
        <input id="oq" placeholder="Buscar código, nombre o celular" value="${esc(P.q)}">
      </div>
      <div class="pgrid" id="olist"><p class="muted">Cargando…</p></div>`;
    refreshOrders(false);
  }
  function drawOrders() {
    const box = $("#olist"); if (!box) return;
    const q = P.q.trim().toLowerCase().replace(/\s/g, "");
    const list = P.orders.filter((o) => !q || (o.code + o.nombre + o.phone).toLowerCase().replace(/\s/g, "").includes(q.replace(/^stt-?/, "")) || o.code.toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = `<div class="empty-p" style="grid-column:1/-1"><img src="img/mochito-lie.png" alt=""><b>${P.sub === "pendiente" ? "No hay pedidos pendientes" : "Nada por acá"}</b><span>${P.sub === "pendiente" ? "Cuando alguien pida desde la web, aparece acá al instante." : ""}</span></div>`; return; }
    const club = P.settings.club || {};
    box.innerHTML = list.map((o) => {
      const prodTotal = (o.items || []).filter((i) => i.id !== "envio").reduce((a, i) => a + (i.subtotal || 0), 0);
      const c = P.confirm[o.id] || (P.confirm[o.id] = { phone: pretty(o.phone), n: club.activo === false || prodTotal < (Number(club.minimo) || 0) ? 0 : (club.sellos_por_pedido ?? 1) });
      const env = o.modo === "envio";
      return `<article class="pcard" data-oid="${o.id}">
        <div class="ohead"><span class="ocode num">${esc(o.code)}</span><span class="ago">${ago(o.created_at)}</span><span class="st ${o.status}">${o.status}</span></div>
        <div class="who2"><b>${esc(o.nombre)}</b><span class="num">${esc(pretty(o.phone))}</span><a class="chat" href="https://wa.me/${esc(o.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
        <div class="acts"><span class="modo-tag ${env ? "env" : ""}">${env ? "Envío a domicilio" : "Retiro"}</span>${o.premio && o.status === "pendiente" ? `<span class="premio-tag">🎁 Completa la tarjeta</span>` : ""}</div>
        ${env ? `<div class="dirbox"><b>${esc(o.direccion || "")}</b><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((o.direccion || "") + ", Mar del Plata")}" target="_blank" rel="noopener">Ver en Maps</a></div>` : ""}
        ${o.premio && o.status === "pendiente" ? `<div class="premiobox">Este pedido completa la tarjeta del Club. Premio elegido: <b>${esc(o.premio_txt || "a confirmar con el cliente")}</b>${/off/.test(o.premio_txt || "") ? " (ya descontado del total)" : ""}. Al tocar Entregado se canjea solo.</div>` : ""}
        <div class="meta"><span>${env ? "Entrega" : "Retiro"}: <b>${esc(o.retiro || "—")}</b></span><span>Pago: <b>${esc(o.pago || "—")}</b></span>${o.nota ? `<span>Nota: <b>${esc(o.nota)}</b></span>` : ""}</div>
        <div class="olines">${(o.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.nombre)}${i.size ? ` (${esc(i.size)})` : ""}${i.detalle ? `<small class="det">${esc(i.detalle)}</small>` : ""}</span><span class="num">${money(i.subtotal)}</span></div>`).join("")}</div>
        <div class="otot"><span>Total</span><span class="num">${money(o.total)}</span></div>
        ${o.status === "pendiente" ? `<div class="confirm">
            <label>Número del chat de WhatsApp<input class="inp" data-cphone value="${esc(c.phone)}" inputmode="tel"></label>
            <div class="acts"><span style="font-size:.85rem;font-weight:600">Sellos a sumar</span><span class="stepper"><button data-cn="-1" aria-label="Menos">−</button><span>${c.n}</span><button data-cn="1" aria-label="Más">+</button></span></div>
            <div class="acts"><button class="btn solid" data-deliver>Entregado ✓</button><button class="linkbtn warn" data-cancel>${P.cancelArm === o.id ? "¿Seguro? Tocá de nuevo para cancelar" : "Cancelar pedido"}</button></div>
          </div>` : o.status === "entregado" ? `<p class="hintp">Entregado ${o.closed_at ? ago(o.closed_at) : ""} · ${o.sellos || 0} sello(s) sumado(s) a ${esc(pretty(o.phone))}</p>` : ""}
      </article>`;
    }).join("");
  }

  /* =================== CLUB =================== */
  function viewClub() {
    const club = P.settings.club || {};
    $("#view").innerHTML = `<h1 class="ph1">Setto Club</h1>
      <p class="muted">Tarjeta de ${club.meta || 8} sellos · Premio: <b>${esc(club.premio || "a definir")}</b> · Cambialo en Ajustes.</p>
      <div class="pgrid" style="margin-top:18px">
        <form class="pcard" id="cSearch"><b>Buscar cliente</b>
          <label>Celular<input class="inp" id="csPhone" inputmode="tel" placeholder="223 347-1277"></label>
          <button class="btn solid" type="submit">Buscar</button></form>
        <form class="pcard" id="cManual"><b>Sumar sellos a mano</b>
          <span class="hintp">Para pedidos por WhatsApp directo o por apps, o para corregir.</span>
          <div class="row2"><label>Celular<input class="inp" id="cmPhone" inputmode="tel" required></label><label>Nombre (opcional)<input class="inp" id="cmName"></label></div>
          <div class="row2"><label>Sellos (usá − para restar)<input class="inp" id="cmN" type="number" value="1" min="-20" max="20"></label>
          <label>Motivo<select class="inp" id="cmWhy"><option>WhatsApp directo</option><option>PedidosYa</option><option>Rappi</option><option>Uber Eats</option><option>Corrección</option><option>Otro</option></select></label></div>
          <button class="btn" type="submit">Sumar</button></form>
      </div>
      <div id="cResult"></div>
      <section class="sec"><h2>Últimos clientes</h2><div class="clist" id="cList"><p class="muted">Cargando…</p></div></section>`;
    $("#cSearch").addEventListener("submit", (e) => { e.preventDefault(); openClient($("#csPhone").value); });
    $("#cManual").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await API.addStamps($("#cmPhone").value, $("#cmName").value, parseInt($("#cmN").value, 10), $("#cmWhy").value); toast(`Listo: ahora tiene ${r.sellos} sello(s)`); openClient(r.phone); listClients(); e.target.reset(); }
      catch (err) { toast(err.message); }
    });
    listClients();
    if (P.client) openClient(P.client);
  }
  async function listClients() {
    try {
      const l = await API.listCustomers();
      $("#cList").innerHTML = l.length ? l.map((c) => `<button class="citem" data-client="${esc(c.phone)}"><span><b>${esc(c.nombre || "Sin nombre")}</b> <span class="muted num">${esc(pretty(c.phone))}</span></span><span class="num"><b>${c.sellos}</b> sello${c.sellos === 1 ? "" : "s"}${c.canjes ? ` · ${c.canjes} canje${c.canjes === 1 ? "" : "s"}` : ""}</span></button>`).join("")
        : `<p class="muted">Todavía no hay clientes con sellos.</p>`;
    } catch (e) { $("#cList").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  async function openClient(phone) {
    const box = $("#cResult"); if (!box) return;
    try {
      const r = await API.findCustomer(phone); P.client = r.phone;
      const meta = (P.settings.club || {}).meta || 8, c = r.customer || { sellos: 0, canjes: 0 };
      const stamps = Array.from({ length: meta }, (_, i) => `<div class="stamp ${i < c.sellos ? "on" : ""} ${i === meta - 1 ? "gift" : ""}">${i < c.sellos ? '<img src="img/mochito-run.png" alt="">' : i === meta - 1 ? "★" : i + 1}</div>`).join("");
      box.innerHTML = `<section class="sec"><div class="pcard">
        <div class="who2"><b>${esc(c.nombre || "Sin nombre")}</b><span class="num">${esc(pretty(r.phone))}</span><a class="chat" href="https://wa.me/${esc(r.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
        ${r.customer ? "" : `<p class="hintp">Todavía no tiene sellos. Sumale uno a mano para crearlo.</p>`}
        <div class="stamps sm" style="grid-template-columns:repeat(${Math.min(meta, 10)},1fr)">${stamps}</div>
        <p><b class="num">${c.sellos}</b> de ${meta} sellos · ${c.canjes} canje(s)</p>
        <div class="acts"><button class="btn" data-cadd="1">+1 sello</button><button class="btn" data-cadd="-1">−1</button>
          <button class="btn solid" data-redeem ${c.sellos >= meta ? "" : "disabled style='opacity:.5'"}>Canjear premio</button></div>
        <b style="margin-top:6px">Historial</b>
        <div class="hist">${(r.events || []).map((e) => `<div><span>${esc(e.motivo || "")} <span class="muted">${ago(e.created_at)}</span></span><span class="${e.delta > 0 ? "pos" : "neg"} num">${e.delta > 0 ? "+" : ""}${e.delta}</span></div>`).join("") || '<span class="muted">Sin movimientos.</span>'}</div>
        ${(r.orders || []).length ? `<b>Pedidos</b><div class="hist">${r.orders.map((o) => `<div><span>${esc(o.code)} · ${esc(o.status)} <span class="muted">${ago(o.created_at)}</span></span><span class="num">${money(o.total)}</span></div>`).join("")}</div>` : ""}
      </div></section>`;
    } catch (e) { box.innerHTML = `<p class="err" style="margin-top:14px">${esc(e.message)}</p>`; }
  }

  /* =================== CARTA =================== */
  const CATS = [["especial", "Edición especial"], ["set", "Sets"], ["dirty", "Dirty lattes"], ["mochi", "Mochis"]];
  const byCat = (c) => P.products.filter((p) => p.categoria === c).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const draftOf = (p) => P.drafts[p.id] || p;
  function viewCarta() {
    const E = P.settings.especial || {};
    $("#view").innerHTML = `<h1 class="ph1">Carta</h1>
      <p class="muted">Cada tarjeta se guarda por separado con su botón <b>Guardar</b>. Los cambios se ven en la web al instante. Las tarjetas con borde rosa tienen cambios sin guardar.</p>
      ${CATS.map(([c, l]) => `<section class="sec"><h2>${l}</h2>
        ${c === "especial" ? `<div class="pcard" id="espCfg" style="margin-bottom:16px"><div class="row2">
            <label>Estado<select data-esp="estado"><option value="proximamente" ${E.estado !== "disponible" ? "selected" : ""}>Próximamente (no se puede pedir)</option><option value="disponible" ${E.estado === "disponible" ? "selected" : ""}>Disponible ahora (se puede pedir)</option></select></label>
            <label>Etiqueta de arriba<input data-esp="chip" value="${esc(E.chip || "")}" placeholder="Ej: Edición de noviembre · del 14 al 16"></label></div>
            <label>Texto debajo del título<textarea data-esp="intro">${esc(E.intro || "")}</textarea></label>
            <div class="savebar"><span class="hintp">Este bloque controla toda la sección.</span><button class="btn solid" data-saveesp>Guardar sección</button></div></div>` : ""}
        <div class="pgrid">${byCat(c).map(cardP).join("")}</div>
        <button class="btn" data-addp="${c}" style="margin-top:14px">+ Agregar ${l === "Sets" ? "set" : l === "Mochis" ? "mochi" : l === "Dirty lattes" ? "dirty" : "sabor especial"}</button>
      </section>`).join("")}`;
  }
  function setCalc(p) {
    const b = P.products.find((x) => x.id === p.set_bebida), m = P.products.find((x) => x.id === p.set_mochi);
    const rows = [["12 oz", "precio_12"], ["16 oz", "precio_16"]].map(([oz, f]) => {
      const sv = (b ? Number(b[f]) || 0 : 0) + (m ? Number(m.precio) || 0 : 0), pr = Number(p[f]) || 0, a = sv - pr;
      return { txt: `${oz.toUpperCase()}: por separado ${money(sv)} → set ${money(pr)} · ${a > 0 ? `ahorro ${money(a)} (${Math.round((a / sv) * 100)}%)` : "sin ahorro"}`, bad: a <= 0 };
    });
    return `<div class="calc ${rows.some((r) => r.bad) ? "bad" : ""}" data-calc>${rows.map((r) => r.txt).join("<br>")}</div>`;
  }
  function cardP(p0) {
    const p = draftOf(p0), c = p.categoria, dirty = !!P.drafts[p.id] || p._new;
    const inp = (f, label, type = "text", extra = "") => `<label>${label}<input data-f="${f}" type="${type}" value="${esc(p[f] ?? "")}" ${extra}></label>`;
    const chk = (f, label) => `<label><input type="checkbox" data-f="${f}" ${p[f] ? "checked" : ""}> ${label}</label>`;
    const money3 = 'min="0" step="100" inputmode="numeric"';
    const opts = (cat, sel) => P.products.filter((x) => x.categoria === cat).map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.nombre)}</option>`).join("");
    return `<article class="pcard ${dirty ? "dirty" : ""} ${p.activo === false ? "off" : ""}" data-pid="${esc(p.id)}">
      <div class="ptop"><img src="${esc(p.img || "img/mochito-lie.png")}" alt=""><div><b>${esc(p.nombre)}</b><br>
        <label class="up">${p.img ? "Cambiar foto" : "Subir foto"}<input type="file" accept="image/*" data-photo></label>
        ${p.img && c === "especial" ? `<button class="linkbtn" data-nophoto>Quitar foto</button>` : ""}</div></div>
      ${inp("nombre", "Nombre")}
      ${c === "set" ? `<div class="row2">${inp("codigo", "Código (ej: Set 04)")}${inp("tema", "Tema (ej: Matcha & cereza)")}</div>
        <div class="row2"><label>Bebida<select data-f="set_bebida">${opts("dirty", p.set_bebida)}</select></label><label>Mochi<select data-f="set_mochi">${opts("mochi", p.set_mochi)}</select></label></div>`
        : `<label>Descripción<textarea data-f="descripcion">${esc(p.descripcion || "")}</textarea></label>`}
      ${c === "set" || c === "dirty" ? `<div class="row3">${inp("precio_12", "Precio 12 oz", "number", money3)}${inp("precio_16", "Precio 16 oz", "number", money3)}${inp("orden", "Orden", "number")}</div>`
        : `<div class="row2">${inp("precio", c === "especial" ? "Precio (0 = a confirmar)" : "Precio por unidad", "number", money3)}${inp("orden", "Orden", "number")}</div>`}
      ${c === "set" ? setCalc(p) : ""}
      <div class="checks">${chk("activo", "Visible en la web")}${chk("agotado", "Agotado")}${c === "mochi" ? chk("rotativo", "Rotativo") : ""}</div>
      <div class="savebar"><button class="linkbtn warn" data-delp>${P.cancelArm === "del-" + p.id ? "¿Seguro? Tocá de nuevo" : "Eliminar"}</button>
        <span>${dirty ? `<button class="linkbtn" data-undo>Descartar</button> ` : ""}<button class="btn solid" data-savep>Guardar</button></span></div>
    </article>`;
  }
  function redrawCard(id) {
    const el = document.querySelector(`[data-pid="${CSS.escape(id)}"]`); if (!el) return;
    const p = P.drafts[id] || P.products.find((x) => x.id === id); if (!p) { el.remove(); return; }
    const y = window.scrollY; el.outerHTML = cardP(p); window.scrollTo(0, y);
  }
  async function squareBlob(file, size = 900) {
    let src;
    try { src = await createImageBitmap(file); }
    catch (_) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
    const w = src.width, h = src.height, side = Math.min(w, h), out = Math.min(size, side);
    const cv = document.createElement("canvas"); cv.width = cv.height = out;
    cv.getContext("2d").drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    const tryType = (t, q) => new Promise((r) => cv.toBlob((b) => r(b), t, q));
    let b = await tryType("image/webp", 0.82);
    if (!b || b.type !== "image/webp") b = await tryType("image/jpeg", 0.85);
    return b;
  }

  /* =================== AJUSTES =================== */
  function viewAjustes() {
    const S = P.settings, r = S.retiro || { dias: [], rangos: [] }, club = S.club || {};
    const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    $("#view").innerHTML = `<h1 class="ph1">Ajustes</h1>
      <div class="pgrid" style="margin-top:18px">
        <form class="pcard" data-set="contacto"><b>Contacto</b>
          <label>WhatsApp de Setto (recibe los pedidos)<input class="inp" name="whatsapp" value="${esc(pretty(S.whatsapp))}" inputmode="tel"></label>
          <label>Instagram (sin @)<input class="inp" name="instagram" value="${esc(S.instagram || "")}"></label>
          <label>Link de todos los links<input class="inp" name="links" value="${esc(S.links || "")}"></label>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="retiro"><b>Horarios de retiro</b>
          <div class="checks">${dias.map((d, i) => `<label><input type="checkbox" name="d${i}" ${r.dias.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
          <label>Franjas (separadas por coma)<input class="inp" name="rangos" value="${esc(r.rangos.map((x) => x.join("-")).join(", "))}" placeholder="10:00-13:00, 14:30-21:00"></label>
          <div class="row2"><label>Turnos cada (min)<input class="inp" name="cada" type="number" value="${r.cadaMin || 30}"></label><label>Anticipación mínima (min)<input class="inp" name="antic" type="number" value="${r.anticipacionMin || 40}"></label></div>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="club"><b>Setto Club</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${club.activo !== false ? "checked" : ""}> Mostrar el Club en la web</label></div>
          <div class="row2"><label>Sellos para el premio<input class="inp" name="meta" type="number" min="2" max="20" value="${club.meta || 8}"></label><label>Sellos por pedido (sugerido)<input class="inp" name="spp" type="number" min="0" max="10" value="${club.sellos_por_pedido ?? 1}"></label></div>
          <label>Texto del premio (solo se usa si no ofrecés set ni descuento)<input class="inp" name="premio" value="${esc(club.premio || "")}" placeholder="Ej: un set de regalo o 35% off en ese pedido"></label>
          <div class="checks"><label><input type="checkbox" name="pset" ${club.premio_set !== false ? "checked" : ""}> Opción: un set de regalo (12 oz)</label></div>
          <div class="row2"><label>Opción: % de descuento (0 = no ofrecer)<input class="inp" name="pdesc" type="number" min="0" max="100" value="${club.premio_descuento ?? 35}"></label>
          <label>Tope del descuento en $ (0 = sin tope)<input class="inp" name="ptope" type="number" min="0" step="500" value="${club.premio_tope || 0}"></label></div>
          <label>Pedido mínimo para sumar sello (0 = sin mínimo)<input class="inp" name="minimo" type="number" min="0" step="500" value="${club.minimo || 0}"></label>
          <span class="hintp">El premio se entrega en el mismo pedido que completa la tarjeta.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="personalizacion"><b>Personalización de bebidas</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.personalizacion || {}).activo !== false ? "checked" : ""}> Dejar personalizar dirty y sets</label></div>
          <label>Leches: una por línea, nombre | recargo (la primera es la de base)<textarea class="inp" name="leches" rows="5">${esc(((S.personalizacion || {}).leches || []).map((l) => l.nombre + " | " + (l.precio || 0)).join("\n"))}</textarea></label>
          <label>Opciones para sacar (una por línea)<textarea class="inp" name="sin" rows="3">${esc(((S.personalizacion || {}).sin || []).join("\n"))}</textarea></label>
          <span class="hintp">El recargo se suma al precio de la bebida o del set.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="ventajas"><b>Pedir acá te conviene</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.ventajas || {}).activo !== false ? "checked" : ""}> Mostrar en "Cómo pedir"</label></div>
          <label>Título<input class="inp" name="titulo" value="${esc((S.ventajas || {}).titulo || "Pedir acá te conviene")}"></label>
          <label>Motivos: uno por línea, título | detalle<textarea class="inp" name="items" rows="5">${esc(((S.ventajas || {}).items || []).map((x) => x.titulo + (x.detalle ? " | " + x.detalle : "")).join("\n"))}</textarea></label>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="envio"><b>Envío a domicilio</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.envio || {}).activo ? "checked" : ""}> Ofrecer envío en la web</label></div>
          <label>Costo fijo del envío (0 = a coordinar por WhatsApp)<input class="inp" name="costo" type="number" min="0" step="100" value="${(S.envio || {}).costo || 0}"></label>
          <label>Única forma de pago con envío<select class="inp" name="pago">${(S.pagos || []).map((p) => `<option ${p === ((S.envio || {}).pago || "Transferencia / Mercado Pago") ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
          <label>Aviso para el cliente<textarea class="inp" name="aviso">${esc((S.envio || {}).aviso || "")}</textarea></label>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="stock_web"><b>Stock en la web</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.stock_web || {}).activo !== false ? "checked" : ""}> Mostrar cuántos mochis quedan</label></div>
          <label>Mostrar "¡Últimos!" cuando queden (o menos)<input class="inp" name="umbral" type="number" min="1" max="50" value="${(S.stock_web || {}).umbral || 3}"></label>
          <span class="hintp">Se toma el stock del Café, el que cargan en la Caja. Los pedidos entregados lo descuentan solos.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="pagos"><b>Formas de pago</b>
          <label>Una por línea<textarea class="inp" name="pagos">${esc((S.pagos || []).join("\n"))}</textarea></label>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="apps"><b>Apps de delivery</b>
          ${[0, 1, 2, 3].map((i) => { const a = (S.apps || [])[i] || {}; return `<div class="row2"><label>Nombre<input class="inp" name="an${i}" value="${esc(a.nombre || "")}"></label><label>Link<input class="inp" name="au${i}" value="${esc(a.url || "")}"></label></div>
            <div class="applogo"><span class="lprev">${a.logo ? `<img src="${esc(a.logo)}" alt="">` : "Sin logo"}</span><input type="hidden" name="al${i}" value="${esc(a.logo || "")}"><label class="btn">Subir logo<input type="file" accept="image/*" data-applogo="${i}" hidden></label>${a.logo ? `<button type="button" class="linkbtn" data-applogo-x="${i}">Quitar</button>` : ""}</div>`; }).join("")}
          <span class="hintp">Logo: usá el ícono oficial de cada app (cuadrado). Después tocá Guardar.</span>
          <span class="hintp">Dejá vacío el nombre para ocultar una fila.</span>
          <button class="btn solid">Guardar</button></form>
        ${API.DEMO ? `<div class="pcard"><b>Modo demo</b><p class="hintp">Borra pedidos, clientes y cambios de prueba de este navegador.</p><button class="btn" id="resetDemo">Reiniciar demo</button></div>` : ""}
      </div>`;
  }
  async function saveAjuste(form) {
    const f = Object.fromEntries(new FormData(form).entries()), k = form.dataset.set;
    try {
      if (k === "contacto") {
        const ph = API.normPhone(f.whatsapp); if (!ph) throw new Error("El WhatsApp no parece válido");
        await API.saveSetting("whatsapp", ph); await API.saveSetting("whatsapp_visible", pretty(ph));
        await API.saveSetting("instagram", (f.instagram || "").replace(/^@/, "").trim()); await API.saveSetting("links", (f.links || "").trim());
      }
      if (k === "retiro") {
        const rangos = (f.rangos || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split("-").map((x) => x.trim()));
        if (!rangos.length || rangos.some((x) => x.length !== 2 || !/^\d{1,2}:\d{2}$/.test(x[0]) || !/^\d{1,2}:\d{2}$/.test(x[1]))) throw new Error("Franjas con formato 10:00-13:00, 14:30-21:00");
        const dias = [0, 1, 2, 3, 4, 5, 6].filter((i) => f["d" + i]);
        await API.saveSetting("retiro", { dias, rangos: rangos.map(([a, b]) => [a.padStart(5, "0"), b.padStart(5, "0")]), cadaMin: Math.max(5, +f.cada || 30), anticipacionMin: Math.max(0, +f.antic || 0) });
      }
      if (k === "club") await API.saveSetting("club", { activo: !!f.activo, meta: Math.max(2, Math.min(20, +f.meta || 8)), sellos_por_pedido: Math.max(0, Math.min(10, +f.spp)), premio: (f.premio || "").trim(), minimo: Math.max(0, +f.minimo || 0),
        premio_set: !!f.pset, premio_descuento: Math.max(0, Math.min(100, +f.pdesc || 0)), premio_tope: Math.max(0, +f.ptope || 0) });
      if (k === "personalizacion") {
        const leches = (f.leches || "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => { const [n, pr] = s.split("|").map((x) => x.trim()); return { nombre: n, precio: Math.max(0, Math.round(+String(pr || "0").replace(/[^0-9.,]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")) || 0) }; }).filter((l) => l.nombre);
        await API.saveSetting("personalizacion", { activo: !!f.activo, leches, sin: (f.sin || "").split("\n").map((s) => s.trim()).filter(Boolean) });
      }
      if (k === "ventajas") await API.saveSetting("ventajas", { activo: !!f.activo, titulo: (f.titulo || "").trim() || "Pedir acá te conviene",
        items: (f.items || "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => { const [t, ...d] = s.split("|"); return { titulo: t.trim(), detalle: d.join("|").trim() }; }) });
      if (k === "envio") await API.saveSetting("envio", { activo: !!f.activo, costo: Math.max(0, +f.costo || 0), aviso: (f.aviso || "").trim(), pago: f.pago || "Transferencia / Mercado Pago" });
      if (k === "stock_web") await API.saveSetting("stock_web", { activo: !!f.activo, umbral: Math.max(1, Math.min(50, +f.umbral || 3)) });
      if (k === "pagos") await API.saveSetting("pagos", (f.pagos || "").split("\n").map((s) => s.trim()).filter(Boolean));
      if (k === "apps") await API.saveSetting("apps", [0, 1, 2, 3].map((i) => ({ nombre: (f["an" + i] || "").trim(), url: (f["au" + i] || "").trim(), logo: (f["al" + i] || "").trim() })).filter((a) => a.nombre));
      await loadBase(); toast("Guardado"); viewAjustes();
    } catch (e) { toast(e.message); }
  }

  /* =================== EVENTOS =================== */
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button, a"); if (!b) return;
    if (b.id === "logout") { await API.signOut(); location.reload(); return; }
    if (b.dataset.view) go(b.dataset.view);
    if (b.dataset.sub) { P.sub = b.dataset.sub; viewPedidos(); }
    if (b.id === "resetDemo") { API.resetDemo(); location.reload(); }
    if (b.dataset.client) openClient(b.dataset.client);

    const oc = b.closest("[data-oid]");
    if (oc) {
      const id = oc.dataset.oid, c = P.confirm[id];
      if (b.dataset.cn) { c.n = Math.max(0, Math.min(10, c.n + +b.dataset.cn)); drawOrders(); }
      if (b.dataset.deliver !== undefined) {
        b.disabled = true;
        try { const r = await API.confirmOrder(id, c.phone, c.n); toast((r.canje ? `Entregado · premio canjeado · la tarjeta vuelve a ${r.sellos}` : c.n ? `Entregado · ${pretty(r.phone)} tiene ${r.sellos} sello(s)` : "Entregado") + " · cargado en la caja"); delete P.confirm[id]; refreshOrders(false); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.cancel !== undefined) {
        if (P.cancelArm !== id) { P.cancelArm = id; drawOrders(); return; }
        try { await API.cancelOrder(id); P.cancelArm = null; toast("Pedido cancelado"); refreshOrders(false); } catch (err) { toast(err.message); }
      }
    }
    if (b.dataset.cadd) { try { const r = await API.addStamps(P.client, "", +b.dataset.cadd, b.dataset.cadd > 0 ? "Manual" : "Corrección"); toast(`Ahora tiene ${r.sellos} sello(s)`); openClient(P.client); listClients(); } catch (err) { toast(err.message); } }
    if (b.dataset.redeem !== undefined) { try { await API.redeem(P.client); toast("Premio canjeado"); openClient(P.client); listClients(); } catch (err) { toast(err.message); } }

    /* carta */
    if (b.dataset.saveesp !== undefined) {
      const box = $("#espCfg"), v = (k) => box.querySelector(`[data-esp="${k}"]`).value;
      try { await API.saveSetting("especial", { estado: v("estado"), chip: v("chip").trim(), intro: v("intro").trim() }); await loadBase(); toast("Sección guardada"); } catch (err) { toast(err.message); }
    }
    if (b.dataset.addp) {
      const c = b.dataset.addp, base = { especial: "esp", set: "set", dirty: "dirty", mochi: "mochi" }[c];
      const id = base + "-" + Date.now().toString(36);
      const first = (cat) => (P.products.find((x) => x.categoria === cat) || {}).id || null;
      const p = { id, categoria: c, nombre: c === "set" ? "Nuevo set" : "Nuevo sabor", descripcion: "", img: "", precio: c === "mochi" ? 5000 : 0, precio_12: c === "set" || c === "dirty" ? 0 : null, precio_16: c === "set" || c === "dirty" ? 0 : null,
        codigo: c === "set" ? "Set 0" + (byCat("set").length + 1) : null, tema: c === "set" ? "" : null, set_bebida: c === "set" ? first("dirty") : null, set_mochi: c === "set" ? first("mochi") : null,
        rotativo: false, agotado: false, activo: false, orden: byCat(c).length + 1, _new: true };
      P.products.push(p); P.drafts[id] = { ...p }; viewCarta();
      toast("Creado oculto: completalo, marcá Visible y guardá");
      document.querySelector(`[data-pid="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const pc = b.closest("[data-pid]");
    if (pc) {
      const id = pc.dataset.pid, base = P.products.find((x) => x.id === id);
      if (b.dataset.savep !== undefined) {
        const d = { ...(P.drafts[id] || base) }; delete d._new;
        if (!String(d.nombre || "").trim()) return toast("Falta el nombre");
        ["precio", "precio_12", "precio_16", "orden"].forEach((k) => { if (d[k] !== null && d[k] !== undefined && d[k] !== "") d[k] = parseInt(d[k], 10) || 0; });
        b.disabled = true;
        try { await API.saveProduct(d); delete P.drafts[id]; await loadBase(); toast("Guardado"); redrawCard(id); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.undo !== undefined) {
        delete P.drafts[id];
        if (base && base._new) { P.products = P.products.filter((x) => x.id !== id); viewCarta(); } else redrawCard(id);
      }
      if (b.dataset.nophoto !== undefined) { P.drafts[id] = { ...(P.drafts[id] || base), img: "" }; redrawCard(id); }
      if (b.dataset.delp !== undefined) {
        const used = P.products.find((x) => x.categoria === "set" && (x.set_bebida === id || x.set_mochi === id));
        if (used) return toast(`No se puede: lo usa ${used.nombre}. Ocultalo con "Visible en la web".`);
        if (P.cancelArm !== "del-" + id) { P.cancelArm = "del-" + id; redrawCard(id); return; }
        try { if (!(base && base._new)) await API.deleteProduct(id); delete P.drafts[id]; P.cancelArm = null; await loadBase(); viewCarta(); toast("Eliminado"); } catch (err) { toast(err.message); }
      }
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "oq") { P.q = t.value; drawOrders(); return; }
    if (t.matches("[data-cphone]")) { P.confirm[t.closest("[data-oid]").dataset.oid].phone = t.value; return; }
    const pc = t.closest("[data-pid]"); if (!pc || !t.dataset.f) return;
    const id = pc.dataset.pid, base = P.products.find((x) => x.id === id);
    const d = P.drafts[id] || (P.drafts[id] = { ...base });
    d[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value;
    pc.classList.add("dirty");
    if (!pc.querySelector("[data-undo]")) { const sp = pc.querySelector("[data-savep]").parentElement; sp.insertAdjacentHTML("afterbegin", '<button class="linkbtn" data-undo>Descartar</button> '); }
    if (d.categoria === "set") { const c = pc.querySelector("[data-calc]"); if (c) c.outerHTML = setCalc(d); }
    if (t.dataset.f === "activo") pc.classList.toggle("off", !t.checked);
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-applogo]") && t.files && t.files[0]) {
      const i = t.dataset.applogo, row = t.closest(".applogo"); toast("Subiendo logo…");
      try { const blob = await squareBlob(t.files[0], 256); const url = await API.uploadPhoto(blob, "app-logo-" + i); row.querySelector(`[name=al${i}]`).value = url; row.querySelector(".lprev").innerHTML = `<img src="${url}" alt="">`; toast("Logo listo · tocá Guardar"); }
      catch (err) { toast(err.message || "No se pudo subir el logo"); }
      return;
    }
    if (t.matches("[data-photo]") && t.files && t.files[0]) {
      const id = t.closest("[data-pid]").dataset.pid, base = P.products.find((x) => x.id === id);
      toast("Subiendo foto…");
      try { const blob = await squareBlob(t.files[0]); const url = await API.uploadPhoto(blob, id); P.drafts[id] = { ...(P.drafts[id] || base), img: url }; redrawCard(id); toast("Foto lista · tocá Guardar para publicarla"); }
      catch (err) { toast(err.message || "No se pudo subir la foto"); }
    }
  });
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-applogo-x]"); if (!x) return; const row = x.closest(".applogo"); row.querySelector(`[name=al${x.dataset.applogoX}]`).value = ""; row.querySelector(".lprev").textContent = "Sin logo"; x.remove(); });
  document.addEventListener("submit", (e) => { if (e.target.matches("form[data-set]")) { e.preventDefault(); saveAjuste(e.target); } });

  /* =================== ARRANQUE =================== */
  (async () => {
    $("#demoBar").hidden = !API.DEMO;
    try { P.user = await API.session(); } catch (_) { P.user = null; }
    if (P.user) await afterLogin(); else drawLogin();
  })();
})();
