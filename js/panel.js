/* Panel del equipo de Setto: pedidos, Club, carta y ajustes */
(function () {
  const API = window.SettoAPI;
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const money = (n) => (Number(n) < 0 ? "−$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-AR");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Portada: a dónde puede llevar cada botón y los botones que tenían las slides antes de poder elegirlos (igual que en site.js)
  const HERO_LINKS = [["#sets", "Sets (armar pedido)"], ["#carta", "Carta"], ["#especial", "Edición especial"], ["#club", "Setto Club"], ["/gift-cards", "Gift cards"], ["#apps", "Pedir por apps"]];
  const heroBotones = (x) => Array.isArray(x.botones) ? x.botones.filter((b) => b && b.texto)
    : x.tipo === "media" ? (x.boton ? [{ texto: x.boton, link: x.link || "#sets", estilo: "principal" }] : [])
    : (x.img || x.titulo) ? [{ texto: "Armar mi pedido", link: "#sets", estilo: "principal" }, { texto: "Pedir por apps", link: "#apps", estilo: "secundario" }] : [];
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

  const P = { falta: {}, user: null, view: "pedidos", sub: "pendiente", q: "", settings: {}, products: [], orders: [], pendCount: 0, drafts: {}, confirm: {}, client: null, cancelArm: null };

  /* =================== LOGIN =================== */
  function drawLogin(msg) {
    app.innerHTML = `<div class="loginwrap"><form class="loginbox" id="login">
      <img class="l" src="img/logo.svg" alt="Setto">
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
    leerHash();
    await loadBase(); drawShell(); go(P.view); avisosInit();
    window.addEventListener("hashchange", () => {
      const v = P.view, a = P.ajSec, sucio = v === "ajustes" && ajSucio();
      if (!leerHash()) return;
      if (sucio && !confirm("Tenés cambios sin guardar. ¿Salir igual y perderlos?")) { P.view = v; P.ajSec = a; marcarHash(); return; }
      go(P.view, true);
    });
    API.listReviews().then((l) => { P.reviews = l; contarResenas(); }).catch(() => {});
    API.listGiftcards().then((l) => { P.gifts = l; contarGift(); }).catch(() => {});
    API.onOrders(() => { refreshOrders(true); });
    setInterval(() => refreshOrders(false), 30000);
  }
  async function loadBase() { const { settings, products } = await API.loadAll(); P.settings = settings; P.products = products; }

  /* =================== ESTRUCTURA =================== */
  const VISTAS = ["pedidos", "dashboard", "club", "campanas", "carta", "resenas", "gift", "ajustes"]; // también sirven como #hash (lo usan los avisos push)
  // #vista, #ajustes/seccion o #pedidos/estado/codigo (lo usa la caja para abrir un pedido)
  function leerHash() {
    const [v, a, b] = location.hash.slice(1).split("/").map((x) => decodeURIComponent(x || ""));
    if (!VISTAS.includes(v)) return false;
    P.view = v;
    if (v === "ajustes") P.ajSec = AJ_SEC.some((x) => x.k === a) ? a : null;
    if (v === "pedidos" && ["pendiente", "entregado", "cancelado"].includes(a)) { P.sub = a; P.q = b || ""; }
    return true;
  }
  function drawShell() {
    app.innerHTML = `<header class="pbar"><div class="wrap">
        <a class="logo" href="index.html" title="Ver el sitio"><img src="img/logo.svg" alt="Setto"></a>
        <nav class="appsw" aria-label="Cambiar de app"><a href="panel.html" aria-current="page">Pedidos</a><a href="caja.html">Caja</a></nav>
        <nav class="ptabs" role="tablist">
          ${[["pedidos", "Pedidos"], ["dashboard", "Dashboard"], ["club", "Club"], ["campanas", "Campañas"], ["carta", "Carta"], ["resenas", "Reseñas"], ["gift", "Gift cards"], ["ajustes", "Ajustes"]].map(([k, l]) => `<button class="ptab" role="tab" data-view="${k}" aria-selected="false">${l}${k === "pedidos" ? ' <span class="n" id="pendN" hidden>0</span>' : k === "resenas" ? ' <span class="n" id="resN" hidden>0</span>' : k === "gift" ? ' <span class="n" id="gcN" hidden>0</span>' : ""}</button>`).join("")}
        </nav>
        <button class="avisos-btn" id="avisosBtn" aria-expanded="false" aria-controls="avisos" title="Avisos en este dispositivo"><span>🔔</span><i hidden></i></button>
        <span class="who">${esc(P.user && P.user.email || "")}<button id="logout">Salir</button></span>
      </div></header>
      <main class="pmain"><div class="wrap"><div class="avisos" id="avisos" hidden></div><div id="view"></div></div></main>`;
  }
  function marcarHash() { history.replaceState(null, "", "#" + P.view + (P.view === "ajustes" && P.ajSec ? "/" + P.ajSec : "")); }
  function go(v, sinCheck) {
    if (!sinCheck && P.view === "ajustes" && !ajSalir()) return;
    P.view = v; marcarHash();
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    ({ pedidos: viewPedidos, dashboard: viewDashboard, club: viewClub, campanas: viewCampanas, carta: viewCarta, resenas: viewResenas, gift: viewGift, ajustes: viewAjustes })[v]();
  }

  /* =================== PEDIDOS =================== */
  const linkSeguir = (o) => (o.track ? `${location.origin}/?seguir=${o.track}` : `${location.origin}/`);
  const M = window.SettoMSG, primerNombre = (o) => (o.nombre || "").split(" ")[0];
  const linkListo = (o) => (o.track ? `${location.origin}/listo?seguir=${o.track}` : `${location.origin}/listo`);
  const faltanTxt = (c) => (c.faltan || []).map((f) => `${f.qty} ${String(f.nombre).replace(/^Mochi /, "mochi ")}${f.size ? ` (${f.size})` : ""}`).join(" y ");
  const cambioTxt = (o) => M.render("pedir_cambio", { nombre: primerNombre(o), codigo: o.code, faltan: faltanTxt(o.cambio || {}), link: linkSeguir(o) }, P.settings);
  function cambioBox(o) {
    const c = o.cambio, F = P.falta[o.id];
    if (o.status === "pendiente" && F) {
      const prods = (o.items || []).map((i, idx) => ({ i, idx })).filter(({ i }) => !["envio", "premio", "gift", "maquinita"].includes(i.id));
      return `<div class="faltabox"><b>¿Qué falta?</b><span class="hintp">Marcá lo que no tenés. Si te queda algo, bajá la cantidad que falta.</span>
        ${prods.map(({ i, idx }) => { const q = F.sel[idx]; return `<div class="frow"><label><input type="checkbox" data-fsel="${idx}" ${q ? "checked" : ""}> ${esc(i.nombre)}${i.size ? ` (${esc(i.size)})` : ""} <small>×${i.qty}</small></label>
          ${q && i.qty > 1 ? `<span class="stepper sm"><button data-fq="${idx}:-1" aria-label="Menos">−</button><span>faltan ${q}</span><button data-fq="${idx}:1" aria-label="Más">+</button></span>` : ""}</div>`; }).join("")}
        <input class="inp" data-fnota placeholder="Nota para el cliente (opcional)" maxlength="140" value="${esc(F.nota || "")}">
        <div class="acts"><button class="btn solid" data-fsend ${Object.keys(F.sel).length ? "" : "disabled"}>Pedir cambio al cliente</button><button class="linkbtn" data-fx>Cancelar</button></div></div>`;
    }
    if (!c) return o.status === "pendiente" ? `<button class="linkbtn" data-falta>¿Falta algo? Pedile un cambio al cliente</button>` : "";
    if (c.estado === "esperando") return `<div class="cambiobox wait"><b>⏳ Esperando que el cliente elija</b><span>Falta: ${esc(faltanTxt(c))}${c.nota ? ` · “${esc(c.nota)}”` : ""}</span>
        ${(o.avisos || {}).cambio && (o.avisos || {}).cambio === c.at ? `<span>✓ Le avisamos por WhatsApp</span>` : ""}
        <div class="acts"><a class="btn ${(o.avisos || {}).cambio === c.at ? "" : "solid"}" target="_blank" rel="noopener" href="https://wa.me/${esc(o.wa_phone || o.phone)}?text=${encodeURIComponent(cambioTxt(o))}">${(o.avisos || {}).cambio === c.at ? "Reenviar" : "Mandar el aviso por WhatsApp"}</a><button class="linkbtn" data-fquitar>Quitar aviso (lo arreglamos por chat)</button></div></div>`;
    if (c.resolucion === "cancelado") return `<div class="cambiobox bad"><b>El cliente canceló el pedido</b><span>Faltaba: ${esc(faltanTxt(c))}</span></div>`;
    return `<div class="cambiobox ok"><b>✓ El cliente eligió el cambio</b>${(c.cambios || []).map((x) => `<span>${x.qty}× ${esc(x.de)} → ${x.a ? `<b>${esc(x.a)}</b>` : "<b>lo sacó</b>"}</span>`).join("")}
        ${c.total_antes != null && c.total_antes !== o.total ? `<span>Total: <s>${money(c.total_antes)}</s> → <b>${money(o.total)}</b>${o.total > c.total_antes ? " (paga la diferencia)" : " (cobrás menos)"}</span>` : ""}</div>`;
  }
  function resenaTxt(o) {
    const s = Number(o.sellos) || 0;
    const club = P.settings.club || {}, regalo = o.primera_compra && club.activo !== false && club.sello_resena !== false;
    return M.render("pedir_resena", { nombre: primerNombre(o), codigo: o.code, link: linkListo(o), sellos: s > 0 ? `Sumaste ${s === 1 ? "1 sello" : s + " sellos"} al Setto Club.` : "", sello_resena: regalo ? M.SELLO_RESENA : "" }, P.settings);
  }
  function avisoTxt(o) {
    const e = o.etapa || "recibido", key = e === "listo" ? (o.modo === "envio" ? "aviso_camino" : "aviso_listo") : e === "preparando" ? "aviso_preparando" : "aviso_recibido";
    return M.render(key, { nombre: primerNombre(o), codigo: o.code, link: linkSeguir(o) }, P.settings);
  }
  const avisoBase = (o) => avisoTxt(o).split("\n")[0];
  // qué aviso de WhatsApp ya se mandó por etapa: en la base (orders.avisos, lo ven todos) o, si falta la migración, en este navegador
  const AVK = "setto-avisos";
  const avisosLocal = () => { try { return JSON.parse(localStorage.getItem(AVK) || "{}"); } catch (_) { return {}; } };
  const avisadoEn = (o, e) => (o.avisos || {})[e] || avisosLocal()[o.id + ":" + e] || null;
  const faltaAvisar = (o) => o.status === "pendiente" && !avisadoEn(o, o.etapa || "recibido");
  const etapaNom = (o, e) => (e === "listo" ? (o.modo === "envio" ? "En camino" : "Listo para retirar") : e === "preparando" ? "En preparación" : "Recibido");
  // pagado: lo marca el equipo a mano cuando llega la transferencia. Solo en pendientes por transferencia:
  // el efectivo se cobra al retirar y lo entregado ya está en la Caja. El cliente no lo ve.
  const conPago = (o) => o.status === "pendiente" && /transfer/i.test(o.pago || "");
  const pagoTag = (o) => !conPago(o) ? "" : o.pagado_at ? `<span class="pago-tag si">✓ Pagado</span>` : `<span class="pago-tag">💸 Sin pagar</span>`;
  // forma de pago editable: las opciones de Ajustes + la que trajo el pedido si ya no está en la lista
  function pagoEdit(o) {
    if (o.status === "cancelado") return `Pago: <b>${esc(o.pago || "—")}</b>`;
    if (P.editPago !== o.id) return `<span class="pagoedit">Pago: <b>${esc(o.pago || "—")}</b> <button class="linkbtn" data-pagoedit>Cambiar</button></span>`;
    const ops = [...new Set([...(P.settings.pagos || []), o.pago].filter(Boolean))];
    return `<div class="pagopick"><b>¿Cómo pagó?</b><div class="chips">${ops.map((p) => `<button data-pagoset="${esc(p)}" aria-pressed="${p === o.pago}">${esc(p)}</button>`).join("")}</div>
      ${o.status === "entregado" ? `<span class="hintp">Ya está entregado: si cambia entre efectivo y transferencia/tarjeta, el cobro pasa a esa cuenta en la Caja.</span>` : ""}
      <button class="linkbtn" data-pagoedit>Listo</button></div>`;
  }
  function pagoBox(o) {
    if (!conPago(o)) return "";
    return o.pagado_at
      ? `<div class="pagobox si"><span><b>✓ Pagado</b><small>${esc(o.pago || "")}${o.pago ? " · " : ""}marcado ${ago(o.pagado_at)}</small></span><button class="linkbtn" data-pagado="0">Desmarcar</button></div>`
      : `<div class="pagobox"><span><b>Sin pagar</b><small>${esc(o.pago || "Forma de pago a confirmar")}</small></span><button class="btn solid" data-pagado="1">Marcar pagado</button></div>`;
  }
  function estadoBox(o) {
    const et = o.etapa || "recibido", orden = ["recibido", "preparando", "listo"], idx = orden.indexOf(et), av = avisadoEn(o, et);
    const wa = `https://wa.me/${esc(o.wa_phone || o.phone)}?text=${encodeURIComponent(avisoTxt(o))}`;
    return `<div class="estado">
      <div class="estado-h"><b>Estado que ve el cliente</b><span class="hintp">Se actualiza solo en su celular y le llega por WhatsApp</span></div>
      <div class="pasos">${orden.map((k, i) => `<button class="paso ${i < idx ? "done" : i === idx ? "now" : ""}" data-etapa="${k}" aria-pressed="${i === idx}"><i>${i < idx ? "✓" : i + 1}</i><span>${etapaNom(o, k)}</span></button>`).join("")}</div>
      ${av ? `<div class="aviso ok"><span class="aviso-t"><b>✓ Ya le avisamos por WhatsApp</b><small>“${esc(etapaNom(o, et))}” · ${ago(av)}</small></span><a class="linkbtn" target="_blank" rel="noopener" data-aviso="${et}" href="${wa}">Reenviar</a></div>`
        : `<div class="aviso pend"><span class="aviso-t"><b>💬 Falta avisarle: “${esc(etapaNom(o, et))}”</b><small>Sale solo si te escribió en las últimas 24 h. Si no, mandalo vos.</small></span><a class="btn solid wa" target="_blank" rel="noopener" data-aviso="${et}" href="${wa}">Enviar WhatsApp</a></div>`}
    </div>`;
  }

  /* =================== GIFT CARDS =================== */
  const GDN = { cumple: "Cumpleaños", gracias: "Gracias", tequiero: "Te quiero", felicitaciones: "Felicitaciones", porquesi: "Porque sí", halloween: "Halloween" };
  // descripciones por defecto (las mismas que usa site.js si se deja vacío)
  const GDD = { cumple: "Regalá algo especial y único a esa persona especial y única en su cumple.", gracias: "Para agradecer con algo rico, sin vueltas.", tequiero: "Un mimo dulce para esa persona que te importa.", felicitaciones: "Para festejar sus logros como se merecen.", porquesi: "No hace falta una excusa para darse un gusto.", halloween: "Un susto dulce para regalar en Halloween." };
  const gItems = () => { const g = P.settings.giftcards || {}; return g.items && g.items.length ? g.items : (g.disenos || Object.keys(GDN)).map((id) => ({ id, nombre: GDN[id], activo: true })).concat(Object.keys(GDN).filter((id) => !(g.disenos || Object.keys(GDN)).includes(id)).map((id) => ({ id, nombre: GDN[id], activo: false }))); };
  const gName = (id) => (gItems().find((x) => x.id === id) || {}).nombre || GDN[id] || id;
  const FAQ_DEF = [
    { p: "¿Qué es un mochi?", r: "Un bocado de origen japonés: masa suave y elástica de harina de arroz glutinoso y leche, rellena de crema y un corazón de sabor (frutilla, chocolate, oreo y más)." },
    { p: "¿Cómo llega mi bebida?", r: "Llega por partes: el vaso con la bebida, el cold foam aparte y el hielo aparte. [Mirá cómo armarla](/armar)." },
    { p: "¿Cómo hago un pedido?", r: "Armalo acá en la web y se envía por WhatsApp con un código. Por ahí te confirmamos horario y pago." },
    { p: "¿Hacen envíos?", r: "Sí, en Mar del Plata. Con envío el pago es solo por transferencia y el costo te lo pasamos por WhatsApp." },
    { p: "¿Cómo funciona el Setto Club?", r: "Cada pedido desde la web suma un sello. Al completar la tarjeta elegís tu premio." },
    { p: "¿Cómo uso una gift card?", r: "Abrí el link que te mandaron y tocá “Usarla en un pedido”. Se descuenta del total y, si sobra, te queda para otro pedido. [Ver gift cards](/gift-cards)." },
  ];
  const linkRegalo = (g) => `${location.origin}/gift-cards?regalo=${g.token}`;
  const regaloTxt = (g) => M.render("gift_activa", { para: g.para, monto: money(g.monto), link: linkRegalo(g) }, P.settings);
  P.gsub = "pendiente";
  async function viewGift() {
    $("#view").innerHTML = `<h1 class="ph1">Gift cards</h1><p class="muted">Cuando te paguen, tocá <b>Pago recibido</b>: se activa, entra a la caja y el link le llega solo al comprador por WhatsApp. Si no le llega (pasaron más de 24 h desde que te escribió), mandáselo con el botón.</p>
      <div class="sub">${[["pendiente", "Por cobrar"], ["activa", "Activas"], ["usada", "Usadas"], ["anulada", "Anuladas"]].map(([k, l]) => `<button class="ptab" data-gsub="${k}" aria-selected="${P.gsub === k}">${l}</button>`).join("")}</div>
      <div class="pgrid" id="gcList" style="margin-top:14px"><p class="muted">Cargando…</p></div>`;
    try {
      const all = await API.listGiftcards(); P.gifts = all; contarGift();
      const l = all.filter((g) => g.estado === P.gsub);
      $("#gcList").innerHTML = l.length ? l.map((g) => `<article class="pcard" data-gid="${g.id}">
          <div class="ohead"><span class="ocode num">${esc(g.code)}</span><span class="ago">${ago(g.created_at)}</span><span class="st ${g.estado === "activa" ? "entregado" : g.estado === "anulada" ? "cancelado" : "pendiente"}">${g.estado}</span></div>
          <div class="meta"><span>Monto: <b>${money(g.monto)}</b></span>${g.estado !== "pendiente" ? `<span>Saldo: <b>${money(g.saldo)}</b></span>` : ""}<span>Diseño: <b>${esc(gName(g.diseno))}</b></span></div>
          <div class="meta"><span>Para: <b>${esc(g.para || "")}</b></span>${g.de ? `<span>De: <b>${esc(g.de)}</b></span>` : ""}</div>
          ${g.mensaje ? `<p class="hintp">“${esc(g.mensaje)}”</p>` : ""}
          <div class="who2"><span class="num">${esc(pretty(g.phone))}</span><a class="chat" href="https://wa.me/${esc(g.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
          ${g.estado === "pendiente" ? `<div class="acts"><select class="inp" data-gcta style="width:auto"><option value="mp">Transferencia / MP</option><option value="efectivo">Efectivo</option></select><button class="btn solid" data-gact>Pago recibido</button><button class="linkbtn warn" data-gann>Anular</button></div>`
            : g.estado === "activa" ? `${g.link_wa_at ? `<p class="hintp">✓ Link enviado solo por WhatsApp ${ago(g.link_wa_at)}</p>` : ""}<div class="acts"><a class="btn ${g.link_wa_at ? "" : "solid"}" target="_blank" rel="noopener" href="https://wa.me/${esc(g.phone)}?text=${encodeURIComponent(regaloTxt(g))}">${g.link_wa_at ? "Reenviar a mano" : "Mandar link al comprador"}</a><button class="linkbtn" data-gcopy="${esc(linkRegalo(g))}">Copiar link</button>${g.saldo === g.monto ? '<button class="linkbtn warn" data-gann>Anular</button>' : ""}</div>` : ""}
        </article>`).join("") : '<p class="muted">Nada por acá.</p>';
    } catch (e) { $("#gcList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  function contarGift() { const n = (P.gifts || []).filter((g) => g.estado === "pendiente").length, el = $("#gcN"); if (el) { el.textContent = n; el.hidden = !n; } }
  document.addEventListener("click", async (e) => {
    const s = e.target.closest("[data-gsub]"); if (s) { P.gsub = s.dataset.gsub; return viewGift(); }
    const c = e.target.closest("[data-gcopy]"); if (c) { try { await navigator.clipboard.writeText(c.dataset.gcopy); toast("Link copiado"); } catch (_) { toast(c.dataset.gcopy); } return; }
    const b = e.target.closest("[data-gact],[data-gann]"); if (!b) return;
    const card = b.closest("[data-gid]"), id = card.dataset.gid; b.disabled = true;
    try {
      if (b.dataset.gact !== undefined) { await API.activateGiftcard(id, card.querySelector("[data-gcta]").value); toast("Activada · le mandamos el link por WhatsApp"); P.gsub = "activa"; setTimeout(() => { if (P.view === "gift" && P.gsub === "activa") viewGift(); }, 5000); }
      else { if (!confirmar(b)) { b.disabled = false; return; } await API.annulGiftcard(id); toast("Anulada"); }
      viewGift();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  function confirmar(b) { if (b.dataset.armed) return true; b.dataset.armed = "1"; b.disabled = false; b.textContent = "¿Seguro? Tocá de nuevo"; return false; }

  /* =================== RESEÑAS =================== */
  async function viewResenas() {
    $("#view").innerHTML = `<h1 class="ph1">Reseñas</h1><p class="muted">Se publican solas apenas las deja quien recibió su pedido (en la lista de la web aparecen las que tienen texto o foto). Revisalas después: marcalas como revisadas u ocultá las que no correspondan.</p><p class="muted">Para elegir cuáles se ven primero en la web, poneles un número en <b>Orden</b> (1 = primera). Las que quedan vacías van después, de la más nueva a la más vieja.</p><div id="rvList" class="pgrid" style="margin-top:18px"><p class="muted">Cargando…</p></div>`;
    try {
      const l = await API.listReviews(); P.reviews = l; contarResenas();
      $("#rvList").innerHTML = l.length ? l.map((r) => `<article class="pcard rvc ${r.estado}" data-rid="${r.id}">
          <div class="ohead"><span style="color:#f8a29a;letter-spacing:2px">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span><span class="ago">${ago(r.created_at)}</span><span class="st ${r.estado === "oculta" ? "cancelado" : r.revisada ? "entregado" : "pendiente"}">${r.estado === "oculta" ? "oculta" : r.revisada ? "publicada" : "sin revisar"}</span></div>
          ${r.foto ? `<a href="${esc(r.foto)}" target="_blank" rel="noopener"><img src="${esc(r.foto)}" alt="Foto de la reseña" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-top:6px"></a>` : ""}
          <p style="margin:6px 0">${r.texto ? esc(r.texto) : '<i class="muted">Sin texto (solo puntaje)</i>'}</p>
          ${r.instagram ? `<a class="linkbtn" href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>` : ""}
          <div class="who2"><b>${esc(r.nombre)}</b><span class="num">${esc(pretty(r.phone))}</span></div>
          <div class="acts">${r.estado === "oculta" ? '<button class="btn" data-rv="aprobada">Volver a publicar</button>' : !r.revisada ? '<button class="btn solid" data-rv="aprobada">Revisada</button>' : ""}${r.estado !== "oculta" ? '<button class="linkbtn warn" data-rv="oculta">Ocultar</button>' : ""}<label class="rvord">Orden<input class="inp" type="number" inputmode="numeric" min="1" max="999" placeholder="—" value="${r.orden || ""}" data-rvord aria-label="Orden de la reseña de ${esc(r.nombre)}"></label></div></article>`).join("") : '<p class="muted">Todavía no hay reseñas.</p>';
    } catch (e) { $("#rvList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  function contarResenas() { const n = (P.reviews || []).filter((r) => !r.revisada).length, el = $("#resN"); if (el) { el.textContent = n; el.hidden = !n; } }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rv]"); if (!b) return;
    const id = b.closest("[data-rid]").dataset.rid; b.disabled = true;
    try { await API.setReviewEstado(id, b.dataset.rv); toast(b.dataset.rv === "oculta" ? "Oculta" : b.textContent === "Revisada" ? "Marcada como revisada" : "Publicada de nuevo"); viewResenas(); } catch (err) { toast(err.message); b.disabled = false; }
  });
  document.addEventListener("change", async (e) => {
    const inp = e.target.closest("[data-rvord]"); if (!inp) return;
    const id = inp.closest("[data-rid]").dataset.rid, v = Math.round(+inp.value || 0), orden = v >= 1 ? Math.min(999, v) : null;
    inp.disabled = true;
    try { await API.setReviewOrden(id, orden); toast(orden ? `Va en el lugar ${orden}` : "Sin orden: va por fecha"); viewResenas(); } catch (err) { toast(err.message); inp.disabled = false; }
  });
  async function refreshOrders(notify) {
    try {
      const pend = await API.listOrders("pendiente");
      const prev = P.pendCount; P.pendCount = pend.length;
      const n = $("#pendN"); if (n) { n.textContent = pend.length; n.hidden = !pend.length; }
      document.title = (pend.length ? `(${pend.length}) ` : "") + "Panel Setto";
      if (notify && pend.length > prev) toast("Entró un pedido nuevo");
      if (P.view === "pedidos") { P.orders = P.sub === "pendiente" ? pend : await API.listOrders(P.sub); drawOrders(); cargarOcupados(); }
      if (P.view === "dashboard" && notify) cargarDash();
    } catch (e) { console.error(e); }
  }
  function viewPedidos() {
    $("#view").innerHTML = `<h1 class="ph1">Pedidos</h1>
      <p class="muted">Cuando llega el WhatsApp, buscá el código, revisá que el número del chat sea el mismo y tocá <b>Entregado</b> cuando lo retiran o lo reciben.</p>
      <div class="sub">
        ${[["pendiente", "Pendientes"], ["entregado", "Entregados (7 días)"], ["cancelado", "Cancelados"]].map(([k, l]) => `<button class="ptab" data-sub="${k}" aria-selected="${P.sub === k}">${l}</button>`).join("")}
        <input id="oq" placeholder="Buscar código, nombre o celular" value="${esc(P.q)}">
      </div>
      <section class="horcard" id="horCard"></section>
      <div class="justdel" id="justDel" hidden></div>
      <div class="pgrid" id="olist"><p class="muted">Cargando…</p></div>`;
    drawHorarios();
    cargarOcupados();
    refreshOrders(false);
  }
  // cuántos pedidos hay en cada turno (para avisar cuáles están llenos)
  async function cargarOcupados() {
    if (!API.turnosOcupados) return;
    try { const l = await API.turnosOcupados(); if (l) { P.ocup = l; if (P.view === "pedidos") drawHorarios(); } } catch (_) {}
  }
  /* ---------- Horarios para pedir: cerrar una franja hoy o mañana sin tocar los horarios fijos, y ver o liberar los turnos en alta demanda ---------- */
  const fechaKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const diaMas = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const hoyKey = () => fechaKey(new Date());
  const cierresVigentes = (r) => (r.cierres || []).filter((c) => c.fecha >= hoyKey() && c.motivo === "cerrada"); // los de días pasados se limpian solos
  const liberadosVigentes = (r) => (r.liberados || []).filter((c) => c.fecha >= hoyKey());
  // lo que comparten las dos tarjetas: Horarios para pedir (Dashboard) y Alta demanda por turno (Pedidos)
  function horDatos() {
    const r = P.settings.retiro || {}, dia = P.horDia || 0, day = diaMas(dia), k = fechaKey(day);
    const fr = (r.rangos || []).filter((x) => !(r.apagadas || []).includes(x.join("-"))).map(([a, b]) => ({ a, b,
      st: (r.cierres || []).some((x) => x.fecha === k && x.franja === a + "-" + b && x.motivo === "cerrada") ? "cerrada" : "abierta" }));
    return { r, dia, k, fr, cupo: Math.max(0, Math.round(+(r.cupoTurno ?? 3))), atiende: (r.dias || []).includes(day.getDay()),
      nom: day.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" }) };
  }
  const horHead = (tit, H) => `<div class="hhead"><div><b>${tit}</b><span class="hintp">${H.dia ? "Mañana" : "Hoy"}, ${esc(H.nom)}</span></div>
      <div class="hdia" role="tablist">${["Hoy", "Mañana"].map((l, i) => `<button type="button" role="tab" aria-selected="${H.dia === i}" data-hdia="${i}">${l}</button>`).join("")}</div></div>`;
  const horSin = (H) => !H.atiende ? `<p class="hintp">Ese día no atienden. Cambialo en <a href="#ajustes/retiro">Ajustes → Horarios de retiro</a>.</p>`
    : !H.fr.length ? `<p class="hintp">No hay franjas activas. Prendelas en <a href="#ajustes/retiro">Ajustes → Horarios de retiro</a>.</p>` : "";
  function drawHorarios() { drawFranjas(); drawAltaDemanda(); }
  // Dashboard → Horarios para pedir: cerrar una franja hoy o mañana sin tocar los horarios fijos
  function drawFranjas() {
    const el = $("#franjaCard"); if (!el) return;
    const H = horDatos(), fr = H.fr;
    const seg = (franja, st) => `<div class="hseg" role="radiogroup" aria-label="${franja ? "Franja " + franja.replace("-", " a ") : "Todo el día"}">${[["abierta", "Abierta"], ["cerrada", "Cerrada"]].map(([v, l]) => `<button type="button" role="radio" class="h-${v}" aria-checked="${st === v}" data-hor="${v}" data-hfr="${franja}">${l}</button>`).join("")}</div>`;
    const todos = fr.length && fr.every((x) => x.st === fr[0].st) ? fr[0].st : "";
    const cerradas = fr.filter((x) => x.st === "cerrada").length;
    el.innerHTML = horHead("Horarios para pedir", H) + (horSin(H)
      || `${fr.map((x) => `<div class="hrow ${x.st}"><span class="hfr num">${x.a} a ${x.b}</span>${seg(x.a + "-" + x.b, x.st)}</div>`).join("")}
          ${fr.length > 1 ? `<div class="hrow todo"><span class="hfr">Todo el día</span>${seg("", todos)}</div>` : ""}
          ${cerradas ? `<p class="hintp">${cerradas === fr.length ? "Ese día no se puede pedir." : "Pueden pedir para las franjas abiertas."} Vuelve sola a abierta al día siguiente.</p>` : ""}
          <p class="hintp">Los turnos en alta demanda se ven y se liberan en <a href="#pedidos">Pedidos</a>.</p>`);
  }
  // Pedidos → Alta demanda por turno: ver o liberar los turnos llenos
  function drawAltaDemanda() {
    const el = $("#horCard"); if (!el) return;
    const H = horDatos(), { r, k, cupo } = H;
    // turnos de ese día con pedidos en curso (los listos y entregados ya liberaron su lugar) o liberados a mano
    const lib = (h) => (r.liberados || []).some((x) => x.fecha === k && x.hora === h);
    const turnos = [...new Set([...(P.ocup || []).filter((o) => o.f === k).map((o) => o.h), ...(r.liberados || []).filter((x) => x.fecha === k).map((x) => x.hora)])].sort()
      .map((h) => ({ h, n: ((P.ocup || []).find((o) => o.f === k && o.h === h) || {}).n || 0, lib: lib(h) }));
    const turnoRow = (t) => { const full = cupo > 0 && t.n >= cupo;
      return `<div class="tturno ${full && !t.lib ? "lleno" : ""}"><span class="num"><b>${esc(t.h)}</b> · ${t.n}${cupo ? ` de ${cupo}` : ""} ${t.n === 1 && !cupo ? "pedido" : "pedidos"}</span>
        ${t.lib ? `<span class="ttag lib">Liberado a mano</span><button type="button" class="linkbtn" data-tlib="${esc(t.h)}" data-on="0">Volver al tope</button>`
          : full ? `<span class="ttag alta">Alta demanda</span><button type="button" class="btn solid sm" data-tlib="${esc(t.h)}" data-on="1">Liberar turno</button>`
          : `<span class="ttag ok">Con lugar</span>`}</div>`; };
    const cerradas = H.fr.filter((x) => x.st === "cerrada");
    el.innerHTML = horHead("Alta demanda por turno", H) + (horSin(H)
      || `${cupo ? `<span class="hintp">Cada turno de ${r.cadaMin || 30} minutos acepta hasta ${cupo} pedidos en curso. Al marcar uno como <b>Listo</b> o <b>Entregado</b>, libera su lugar solo.</span>` : `<span class="hintp">El tope está apagado en <a href="#ajustes/retiro">Ajustes</a>: los turnos aceptan pedidos sin límite.</span>`}
          ${turnos.length ? turnos.map(turnoRow).join("") : `<span class="hintp">Ningún turno con pedidos en curso.</span>`}
          ${cerradas.length ? `<p class="hintp">${cerradas.length === H.fr.length ? "Ese día está cerrado para pedir" : `Cerrada: ${cerradas.map((x) => `${x.a} a ${x.b}`).join(", ")}`}. Abrila en <a href="#dashboard">Dashboard → Horarios para pedir</a>.</p>` : ""}`);
  }
  async function guardarRetiro(cambios, msg) {
    document.querySelectorAll(".horcard button").forEach((x) => (x.disabled = true));
    try { await API.saveSetting("retiro", { ...(P.settings.retiro || {}), ...cambios }); await loadBase(); drawHorarios(); toast(msg); }
    catch (err) { toast(err.message); drawHorarios(); }
  }
  document.addEventListener("click", async (e) => {
    const d = e.target.closest("[data-hdia]"); if (d) { P.horDia = +d.dataset.hdia; drawHorarios(); return; }
    const r = P.settings.retiro || {}, k = fechaKey(diaMas(P.horDia || 0)), cuando = P.horDia ? "mañana" : "hoy";
    const t = e.target.closest("#horCard [data-tlib]");
    if (t) { // liberar un turno lleno a mano (o devolverle el tope)
      const h = t.dataset.tlib, otros = liberadosVigentes(r).filter((x) => !(x.fecha === k && x.hora === h));
      return guardarRetiro({ liberados: t.dataset.on === "1" ? otros.concat([{ fecha: k, hora: h }]) : otros },
        t.dataset.on === "1" ? `Turno de ${h} liberado ${cuando}: acepta pedidos aunque esté lleno` : `Turno de ${h}: vuelve el tope de pedidos`);
    }
    const b = e.target.closest("#franjaCard [data-hor]"); if (!b || b.disabled) return;
    const fr = b.dataset.hfr ? [b.dataset.hfr] : (r.rangos || []).map((x) => x.join("-")).filter((x) => !(r.apagadas || []).includes(x));
    const cierres = cierresVigentes(r).filter((c) => !(c.fecha === k && fr.includes(c.franja))).concat(b.dataset.hor === "cerrada" ? fr.map((franja) => ({ fecha: k, franja, motivo: "cerrada" })) : []);
    guardarRetiro({ cierres }, `${b.dataset.hfr ? b.dataset.hfr.replace("-", " a ") : "Todo el día"}: ${b.dataset.hor} ${cuando}`);
  });
  /* =================== DASHBOARD =================== */
  // Solo datos reales: facturación y gastos = Caja (todas las ventas), productos = pedidos web + entradas de la Caja con productos, horarios = pedidos web, mochis por sabor = stock de la Caja.
  // Se traen los últimos 14 días: la semana actual se compara con la anterior y cada día con el mismo día de la semana pasada.
  const NO_PROD = ["envio", "premio", "maquinita"];
  const corto = (n) => { n = Math.round(n || 0); return n >= 1e6 ? "$" + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; };
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const diaNom = (i) => (i === 0 ? "Hoy" : i === 1 ? "Ayer" : diaMas(-i).toLocaleDateString("es-AR", { weekday: "long" }));
  function viewDashboard() {
    $("#view").innerHTML = `<h1 class="ph1">Dashboard</h1>
      <p class="muted">Facturación y gastos salen de la <a href="caja.html">Caja</a> (todas las ventas: web, directas, apps y cafeterías). Lo que más salió suma los pedidos web y las entradas cargadas con productos; los horarios, solo los pedidos web.</p>
      <section class="horcard" id="franjaCard"></section>
      <div id="dash"><p class="muted">Cargando…</p></div>`;
    drawFranjas();
    cargarDash();
  }
  async function cargarDash() {
    try { P.dash = await API.dashboard(new Date(diaMas(-13).setHours(0, 0, 0, 0))); P.dashAt = new Date(); }
    catch (err) { const el = $("#dash"); if (el && !P.dash) el.innerHTML = `<p class="err">No se pudo cargar el dashboard: ${esc(err.message)}</p>`; return; }
    drawDash();
  }
  // suma todo lo de un conjunto de días (claves AAAA-MM-DD)
  function dashSuma(keys) {
    const D = P.dash, ks = new Set(keys), cat = {}, itm = {};
    ((D.caja || {}).cats || []).forEach((c) => (cat[c.id] = c.nombre)); ((D.stock || {}).items || []).forEach((x) => (itm[x.id] = x.nombre));
    const A = { ent: 0, gas: 0, canales: {}, webN: 0, webTot: 0, canc: 0, prods: {}, mochis: {}, mochisN: 0, horas: {}, pagos: {}, modos: {}, tels: {}, dias: {} };
    keys.forEach((k) => (A.dias[k] = { web: 0, otros: 0, n: 0 }));
    D.orders.forEach((o) => {
      const k = fechaKey(new Date(o.created_at)); if (!ks.has(k)) return;
      if (o.status === "cancelado") { A.canc++; return; }
      A.webN++; A.webTot += o.total || 0; A.dias[k].n++;
      const h = new Date(o.created_at).getHours(); A.horas[h] = (A.horas[h] || 0) + 1;
      const pg = o.pago || "Sin dato"; A.pagos[pg] = (A.pagos[pg] || 0) + (o.total || 0);
      const md = o.modo === "envio" ? "Envío" : "Retiro"; A.modos[md] = (A.modos[md] || 0) + 1;
      if (o.phone) A.tels[o.phone] = (A.tels[o.phone] || 0) + 1;
      (o.items || []).filter((i) => !NO_PROD.includes(i.id)).forEach((i) => {
        const n = String(i.nombre || i.id).trim(), x = A.prods[n] || (A.prods[n] = { q: 0, m: 0 }); x.q += i.qty || 0; x.m += i.subtotal || 0;
      });
    });
    if (D.caja) D.caja.movs.forEach((m) => {
      if (!ks.has(m.fecha)) return; const v = +m.monto || 0;
      if (m.tipo === "gasto") { A.gas += v; return; }
      const web = m.registro === "Pedidos web", c = web ? "Pedidos web" : cat[m.categoria_id] || "Sin categoría";
      A.ent += v; A.canales[c] = (A.canales[c] || 0) + v; A.dias[m.fecha][web ? "web" : "otros"] += v;
      // ventas cargadas en la Caja con productos (los pedidos web ya se cuentan arriba desde orders)
      if (!web) (m.items || []).forEach((i) => { const n = String(i.nombre || i.id).trim(), x = A.prods[n] || (A.prods[n] = { q: 0, m: 0 }); x.q += +i.qty || 0; x.m += (+i.qty || 0) * (+i.precio || 0); });
    });
    if (D.stock) D.stock.movs.forEach((m) => {
      const k = fechaKey(new Date(m.created_at)); if (!ks.has(k)) return;
      const n = itm[m.item_id] || "Otro"; A.mochis[n] = (A.mochis[n] || 0) - (m.delta || 0); A.mochisN -= m.delta || 0;
    });
    return A;
  }
  const orden = (o, f = (v) => v) => Object.entries(o).map(([l, v]) => [l, f(v)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  // con comparación (cmp en %), sub es contra qué se compara; sin dato anterior (cmp === null) no se muestra
  const tile = (lbl, val, sub, cmp) => `<div class="kpi"><span class="kl">${lbl}</span><b class="kv num">${val}</b>${cmp != null ? `<span class="kc ${cmp > 0 ? "k-sube" : cmp < 0 ? "k-baja" : ""}">${cmp > 0 ? "▲ +" : cmp < 0 ? "▼ " : "= "}${cmp}% ${sub}</span>` : sub && cmp !== null ? `<span class="kc">${sub}</span>` : ""}</div>`;
  // barras horizontales: una sola serie, cada valor con su número al lado
  const barras = (rows, fmt, vacio) => {
    if (!rows.length) return `<p class="hintp">${vacio || "Sin datos."}</p>`;
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return `<ul class="dbars">${rows.map(([l, v, sub]) => `<li title="${esc(l)}: ${esc(fmt(v))}"><span class="dl">${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="dtrack"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></span><b class="num">${fmt(v)}</b></li>`).join("")}</ul>`;
  };
  // columnas (apiladas si hay dos series): cols = [{l, v:[a, b], tip, on}]
  const columnas = (cols, fmt) => {
    const max = Math.max(...cols.map((c) => c.v.reduce((a, b) => a + b, 0)), 1);
    return `<div class="dcolch" style="--n:${cols.length}">${cols.map((c) => { const t = c.v.reduce((a, b) => a + b, 0);
      return `<div class="dcol ${c.on ? "on" : ""}" title="${esc(c.tip)}"><span class="dcv num">${t ? fmt(t) : ""}</span><span class="dstack">${c.v.map((v, i) => v ? `<i class="s${i}" style="height:${(v / max) * 100}%"></i>` : "").join("")}</span><span class="dcl">${esc(c.l)}</span></div>`; }).join("")}</div>`;
  };
  function drawDash() {
    const el = $("#dash"); if (!el || !P.dash) return;
    const D = P.dash, di = P.dashDia || 0, kDia = fechaKey(diaMas(-di)), kPas = fechaKey(diaMas(-di - 7));
    const sem = Array.from({ length: 7 }, (_, i) => fechaKey(diaMas(-6 + i))), semAnt = Array.from({ length: 7 }, (_, i) => fechaKey(diaMas(-13 + i)));
    const H = dashSuma([kDia]), Hp = dashSuma([kPas]), S = dashSuma(sem), Sp = dashSuma(semAnt);
    const caja = !!D.caja, stock = !!D.stock, nomDia = diaMas(-di).toLocaleDateString("es-AR", { weekday: "long" });
    const fact = (A) => (caja ? A.ent : A.webTot);
    const prodRows = (A) => orden(A.prods, (x) => x.q).slice(0, 6).map(([l, q]) => [l, q, money(A.prods[l].m)]);
    const unid = (v) => v + " u.";
    const horasCh = (A) => { const hs = Object.keys(A.horas).map(Number); if (!hs.length) return `<p class="hintp">Sin pedidos web.</p>`;
      const a = Math.min(...hs), b = Math.max(...hs), cols = [];
      for (let h = a; h <= b; h++) cols.push({ l: String(h), v: [A.horas[h] || 0], tip: `${h}:00 a ${h}:59 · ${A.horas[h] || 0} pedidos` });
      return columnas(cols, String) + `<p class="hintp">Hora en que entró cada pedido web (no la de retiro).</p>`; };
    const sinCaja = caja ? "" : `<p class="hintp">Sin acceso a la Caja${API.DEMO ? " en modo demo" : ""}: la facturación muestra solo pedidos web.</p>`;
    const repit = Object.values(S.tels).filter((n) => n > 1).length, clientes = Object.keys(S.tels).length;
    const mejor = sem.map((k) => [k, caja ? S.dias[k].web + S.dias[k].otros : 0]).sort((a, b) => b[1] - a[1])[0];
    const mejorTxt = caja && mejor[1] > 0 ? `Mejor día: <b>${new Date(mejor[0] + "T12:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })}</b> con ${money(mejor[1])}.` : "";
    el.innerHTML = `
      <section class="dsec">
        <div class="dhead"><h2 class="dh2">Resumen del día</h2>
          <div class="dnav"><button type="button" data-dd="1" ${di >= 6 ? "disabled" : ""} aria-label="Día anterior">‹</button><span>${esc(diaNom(di))} ${esc(String(diaMas(-di).getDate()))}</span><button type="button" data-dd="-1" ${di <= 0 ? "disabled" : ""} aria-label="Día siguiente">›</button></div></div>
        ${sinCaja}
        <div class="kpis">
          ${tile("Facturado", money(fact(H)), `vs. ${nomDia} pasado`, fact(Hp) > 0 ? pct(fact(H), fact(Hp)) : null)}
          ${caja ? tile("Gastos", money(H.gas)) + tile("Resultado", money(H.ent - H.gas), "entradas − gastos") : ""}
          ${tile("Pedidos web", String(H.webN), H.webN ? `ticket promedio ${money(Math.round(H.webTot / H.webN))}` : H.canc ? "" : "ninguno")}
          ${stock ? tile("Mochis vendidos", String(H.mochisN), "todas las ventas") : ""}
          ${H.canc ? tile("Cancelados", String(H.canc), "pedidos web") : ""}
        </div>
        <div class="dcols">
          ${caja ? `<div class="dcard"><b>Por canal</b>${barras(orden(H.canales), money, "Sin entradas en la Caja.")}</div>` : ""}
          <div class="dcard"><b>Lo que más salió</b>${barras(prodRows(H), unid, "Sin pedidos web ni ventas cargadas con productos.")}<p class="hintp">Pedidos web y entradas de la Caja cargadas con productos.</p></div>
          ${stock ? `<div class="dcard"><b>Mochis por sabor</b>${barras(orden(H.mochis), unid, "Sin mochis descontados del stock.")}<p class="hintp">Lo que se descontó del stock en la Caja: web y ventas directas.</p></div>` : ""}
          <div class="dcard"><b>Pedidos web por hora</b>${horasCh(H)}</div>
          ${H.webN ? `<div class="dcard"><b>Formas de pago (web)</b>${barras(orden(H.pagos), money)}</div>` : ""}
        </div>
      </section>
      <section class="dsec">
        <div class="dhead"><h2 class="dh2">Últimos 7 días</h2><span class="hintp">${esc(new Date(sem[0] + "T12:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }))} al ${esc(new Date(sem[6] + "T12:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }))} · comparado con los 7 anteriores</span></div>
        <div class="kpis">
          ${tile("Facturado", money(fact(S)), "vs. semana anterior", fact(Sp) > 0 ? pct(fact(S), fact(Sp)) : null)}
          ${tile("Promedio por día", money(Math.round(fact(S) / 7)))}
          ${caja ? tile("Gastos", money(S.gas), "vs. semana anterior", Sp.gas > 0 ? pct(S.gas, Sp.gas) : null) + tile("Resultado", money(S.ent - S.gas), "entradas − gastos") : ""}
          ${tile("Pedidos web", String(S.webN), "vs. semana anterior", Sp.webN > 0 ? pct(S.webN, Sp.webN) : null)}
          ${S.webN ? tile("Ticket promedio web", money(Math.round(S.webTot / S.webN))) : ""}
          ${stock ? tile("Mochis vendidos", String(S.mochisN), "vs. semana anterior", Sp.mochisN > 0 ? pct(S.mochisN, Sp.mochisN) : null) : ""}
          ${clientes ? tile("Clientes web", String(clientes), repit ? `${repit} pidieron más de una vez` : "distintos") : ""}
        </div>
        <div class="dcols">
          <div class="dcard wide2"><b>${caja ? "Facturado por día" : "Pedidos web por día"}</b>
            ${caja ? `<div class="dleg"><span><i class="s0"></i>Pedidos web</span><span><i class="s1"></i>Otros canales</span></div>` : ""}
            ${columnas(sem.map((k, i) => { const d = new Date(k + "T12:00"), x = S.dias[k];
              return { l: d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "") + " " + d.getDate(), on: k === kDia,
                v: caja ? [x.web, x.otros] : [x.n], tip: caja ? `${d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })}: ${money(x.web + x.otros)} (web ${money(x.web)} · otros ${money(x.otros)})` : `${x.n} pedidos` }; }), caja ? corto : String)}
            ${mejorTxt ? `<p class="hintp">${mejorTxt}</p>` : ""}</div>
          ${caja ? `<div class="dcard"><b>Por canal</b>${barras(orden(S.canales), money, "Sin entradas en la Caja.")}</div>` : ""}
          <div class="dcard"><b>Lo que más salió</b>${barras(prodRows(S), unid, "Sin pedidos web ni ventas cargadas con productos.")}</div>
          ${stock ? `<div class="dcard"><b>Mochis por sabor</b>${barras(orden(S.mochis), unid, "Sin mochis descontados del stock.")}</div>` : ""}
          ${S.webN ? `<div class="dcard"><b>Retiro o envío (web)</b>${barras(orden(S.modos), (v) => v + (v === 1 ? " pedido" : " pedidos"))}</div>` : ""}
          ${S.webN ? `<div class="dcard"><b>Formas de pago (web)</b>${barras(orden(S.pagos), money)}</div>` : ""}
        </div>
      </section>
      <p class="hintp">Actualizado ${P.dashAt ? P.dashAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : ""} · <button type="button" class="linkbtn" data-dre>Actualizar</button>${S.canc ? ` · ${S.canc} pedido${S.canc > 1 ? "s" : ""} web cancelado${S.canc > 1 ? "s" : ""} en la semana (no suman)` : ""}</p>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#dash [data-dd]"); if (b) { P.dashDia = Math.max(0, Math.min(6, (P.dashDia || 0) + +b.dataset.dd)); drawDash(); return; }
    if (e.target.closest("#dash [data-dre]")) cargarDash();
  });
  function drawJust() {
    const el = $("#justDel"); if (!el) return; const o = P.justDelivered;
    el.hidden = !o; if (!o) return;
    el.innerHTML = `<div><b>Entregado ${esc(o.code)} · ${esc((o.nombre || "").split(" ")[0])}</b><span>Mandale el link para que deje su reseña y vea sus sellos. El cobro y los mochis ya se cargaron en la <a class="tocaja" href="caja.html#movs">Caja</a>.</span></div>
      ${((P.orders.find((x) => x.id === o.id) || o).avisos || {}).resena ? `<span class="hintp">✓ Le mandamos el link por WhatsApp</span><button class="linkbtn" data-justx>Listo</button>` : `<a class="btn solid" target="_blank" rel="noopener" data-justgo href="https://wa.me/${esc(o.wa_phone || o.phone)}?text=${encodeURIComponent(resenaTxt(o))}">Pedir reseña por WhatsApp</a><button class="linkbtn" data-justx>Ahora no</button>`}`;
  }
  function drawOrders() {
    drawJust();
    const box = $("#olist"); if (!box) return;
    const q = P.q.trim().toLowerCase().replace(/\s/g, "");
    const list = P.orders.filter((o) => !q || (o.code + o.nombre + o.phone).toLowerCase().replace(/\s/g, "").includes(q.replace(/^stt-?/, "")) || o.code.toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = `<div class="empty-p" style="grid-column:1/-1"><img src="img/mochito-lie.png" alt=""><b>${P.sub === "pendiente" ? "No hay pedidos pendientes" : "Nada por acá"}</b><span>${P.sub === "pendiente" ? "Cuando alguien pida desde la web, aparece acá al instante." : ""}</span></div>`; return; }
    const club = P.settings.club || {};
    box.innerHTML = list.map((o) => {
      const prodTotal = (o.items || []).filter((i) => i.id !== "envio").reduce((a, i) => a + (i.subtotal || 0), 0);
      // cada pedido suma 1 sello (0 si el Club está apagado o no llega al mínimo)
      const c = P.confirm[o.id] || (P.confirm[o.id] = { phone: pretty(o.phone) });
      c.n = club.activo === false || prodTotal < (Number(club.minimo) || 0) ? 0 : 1;
      const env = o.modo === "envio";
      return `<article class="pcard" data-oid="${o.id}">
        <div class="ohead"><span class="ocode num">${esc(o.code)}</span><span class="ago">${ago(o.created_at)}</span><span class="st ${o.status}">${o.status}</span></div>
        <div class="who2"><b>${esc(o.nombre)}</b><span class="num">${esc(pretty(o.phone))}</span><a class="chat" href="https://wa.me/${esc(o.wa_phone || o.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
        ${o.wa_phone && o.status === "pendiente" ? `<div class="aviso pend"><span class="aviso-t"><b>📱 Escribió desde otro número</b><small>Cargó ${esc(pretty(o.phone))} en la web pero mandó el pedido desde ${esc(pretty(o.wa_phone))}. Los avisos van a ese.</small></span><button class="btn solid" data-usarwa>Usar ese número</button></div>` : ""}
        <div class="acts"><span class="modo-tag ${env ? "env" : ""}">${env ? "Envío a domicilio" : "Retiro"}</span>${o.premio && o.status === "pendiente" ? `<span class="premio-tag">🎁 Completa la tarjeta</span>` : ""}${faltaAvisar(o) ? `<span class="falta-tag">💬 Falta avisar</span>` : ""}${pagoTag(o)}</div>
        ${env ? `<div class="dirbox"><b>${esc(o.direccion || "")}</b><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((o.direccion || "") + ", Mar del Plata")}" target="_blank" rel="noopener">Ver en Maps</a></div>` : ""}
        ${o.premio && o.status === "pendiente" ? `<div class="premiobox">Este pedido completa la tarjeta del Club. Premio elegido: <b>${esc(o.premio_txt || "a confirmar con el cliente")}</b>${/off/.test(o.premio_txt || "") ? " (ya descontado del total)" : ""}. Al tocar Entregado se canjea solo.</div>` : ""}
        <div class="meta"><span>${env ? "Entrega" : "Retiro"}: <b>${esc(o.retiro || "—")}</b></span><span>${pagoEdit(o)}</span>${o.nota ? `<span>Nota: <b>${esc(o.nota)}</b></span>` : ""}${o.last_touch_source ? `<span>Llegó por: <b>${esc(origenTxt(o.last_touch_source, o.last_touch_campaign))}</b></span>` : ""}</div>
        <div class="olines">${(o.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.nombre)}${i.size ? ` (${esc(i.size)})` : ""}${i.detalle ? `<small class="det">${esc(i.detalle)}</small>` : ""}</span><span class="num">${money(i.subtotal)}</span></div>`).join("")}</div>
        <div class="otot"><span>Total</span><span class="num">${money(o.total)}</span></div>
        ${pagoBox(o)}
        ${cambioBox(o)}
        ${o.status === "pendiente" ? estadoBox(o) : ""}
        ${o.status === "pendiente" ? `<div class="confirm">
            <label>Número del chat de WhatsApp<input class="inp" data-cphone value="${esc(c.phone)}" inputmode="tel"></label>
            ${c.n ? "" : `<span class="hintp">${club.activo === false ? "El Club está apagado: no suma sello." : "No llega al mínimo del Club: no suma sello."}</span>`}
            <div class="acts"><button class="btn solid" data-deliver>Entregado ✓</button><button class="linkbtn warn" data-cancel>${P.cancelArm === o.id ? "¿Seguro? Tocá de nuevo para cancelar" : "Cancelar pedido"}</button></div>
          </div>` : o.status === "entregado" ? `<p class="hintp">Entregado ${o.closed_at ? ago(o.closed_at) : ""} · ${o.sellos || 0} sello(s) sumado(s) a ${esc(pretty(o.phone))} · <a class="tocaja" href="caja.html#movs">Cobro en la Caja →</a></p>
            ${(o.avisos || {}).resena ? `<p class="hintp">✓ Le pedimos la reseña por WhatsApp ${ago(o.avisos.resena)}</p>` : `<a class="btn solid" style="margin-top:8px" target="_blank" rel="noopener" href="https://wa.me/${esc(o.wa_phone || o.phone)}?text=${encodeURIComponent(resenaTxt(o))}">Pedir reseña por WhatsApp</a>`}` : ""}
      </article>`;
    }).join("");
  }

  /* =================== CLUB =================== */
  function viewClub() {
    const club = P.settings.club || {};
    $("#view").innerHTML = `<h1 class="ph1">Setto Club</h1>
      <p class="muted">Tarjeta de ${club.meta || 8} sellos · Premio: <b>${esc(club.premio || "a definir")}</b> · <a class="tocaja" href="#ajustes/club">Cambialo en Ajustes</a>.</p>
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
      let crm = null; try { crm = API.crmCliente ? await API.crmCliente(r.phone) : null; } catch (_) { crm = null; } // sin migración 031: no se muestra
      let cons = null; try { cons = API.consentimientos ? await API.consentimientos(r.phone) : null; } catch (_) { cons = null; } // sin migración 030: no se muestra
      const meta = (P.settings.club || {}).meta || 8, c = r.customer || { sellos: 0, canjes: 0 };
      const stamps = Array.from({ length: meta }, (_, i) => `<div class="stamp ${i < c.sellos ? "on" : ""} ${i === meta - 1 ? "gift" : ""}">${i < c.sellos ? '<img src="img/mochito-run.png" alt="">' : i === meta - 1 ? "★" : i + 1}</div>`).join("");
      box.innerHTML = `<section class="sec"><div class="pcard">
        <div class="who2"><b>${esc(c.nombre || "Sin nombre")}</b><span class="num">${esc(pretty(r.phone))}</span><a class="chat" href="https://wa.me/${esc(r.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
        ${r.customer ? "" : `<p class="hintp">Todavía no tiene sellos. Sumale uno a mano para crearlo.</p>`}
        <div class="stamps sm" style="grid-template-columns:repeat(${Math.min(meta, 10)},1fr)">${stamps}</div>
        <p><b class="num">${c.sellos}</b> de ${meta} sellos · ${c.canjes} canje(s)</p>
        <div class="acts"><button class="btn" data-cadd="1">+1 sello</button><button class="btn" data-cadd="-1">−1</button>
          <button class="btn solid" data-redeem ${c.sellos >= meta ? "" : "disabled style='opacity:.5'"}>Canjear premio</button></div>
        ${crm ? crmHtml(crm) : ""}
        ${cons ? consentHtml(cons) : ""}
        <b style="margin-top:6px">Historial</b>
        <div class="hist">${(r.events || []).map((e) => `<div><span>${esc(e.motivo || "")} <span class="muted">${ago(e.created_at)}</span></span><span class="${e.delta > 0 ? "pos" : "neg"} num">${e.delta > 0 ? "+" : ""}${e.delta}</span></div>`).join("") || '<span class="muted">Sin movimientos.</span>'}</div>
        ${(r.orders || []).length ? `<b>Pedidos</b><div class="hist">${r.orders.map((o) => `<div><span>${esc(o.code)} · ${esc(o.status)}${o.status === "pendiente" && o.pagado_at ? " · pagado" : ""} <span class="muted">${ago(o.created_at)}</span></span><span class="num">${money(o.total)}</span></div>`).join("")}</div>` : ""}
      </div></section>`;
    } catch (e) { box.innerHTML = `<p class="err" style="margin-top:14px">${esc(e.message)}</p>`; }
  }

  const origenTxt = (src, camp) => [src, camp].filter(Boolean).join(" · ");
  function crmHtml(c) {
    const fecha = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—");
    return `<b style="margin-top:6px">Resumen</b><div class="hist">
      <div><span>Compras entregadas</span><span class="num">${c.compras || 0} · ${money(c.total_gastado || 0)}</span></div>
      <div><span>Primera / última compra</span><span class="num">${fecha(c.primera_compra)} / ${fecha(c.ultima_compra)}</span></div>
      ${(c.favoritos || []).length ? `<div><span>Lo que más pide</span><span>${c.favoritos.map((f) => `${esc(f.nombre || f.id)} ×${f.qty}`).join(", ")}</span></div>` : ""}
      <div><span>Llegó por primera vez</span><span>${esc(origenTxt(c.first_touch_source, c.first_touch_campaign) || "sin dato")}</span></div>
      ${c.last_touch_source ? `<div><span>Último origen</span><span>${esc(origenTxt(c.last_touch_source, c.last_touch_campaign))}</span></div>` : ""}
    </div>`;
  }
  // permisos de marketing: vale el último registro de cada canal. El equipo solo puede dar de baja, nunca autorizar.
  const CANALES = [["whatsapp", "Novedades por WhatsApp"], ["meta_ads", "Anuncios de Meta"]];
  const ORIGEN = { checkout_web: "al pedir en la web", preferencias_web: "desde la web", panel: "desde el panel", whatsapp: "por WhatsApp", maquinita: "desde la maquinita" };
  function consentHtml(l) {
    return `<b style="margin-top:6px">Permisos de marketing</b><div class="hist">${CANALES.map(([k, nom]) => {
      const u = l.find((x) => x.canal === k), si = u && u.estado === "otorgado";
      return `<div><span>${nom} · ${si ? "<b>Sí</b>" : u ? "Se dio de baja" : "No"} <span class="muted">${u ? `${ORIGEN[u.origen] || u.origen} · ${ago(u.created_at)}` : "nunca lo aceptó"}</span></span>${si ? `<button class="linkbtn" data-baja="${k}">Dar de baja</button>` : ""}</div>`;
    }).join("")}</div>`;
  }

  /* =================== CAMPAÑAS (WhatsApp y públicos de Meta) =================== */
  const SEGS = [["nuevos", "Clientes nuevos", "1 compra: incentivo para la segunda"], ["recurrentes", "Recurrentes", "3 compras o más: acceso anticipado a sets"],
    ["fans_mochis", "Fans de los mochis", "3+ mochis y más mochis que bebidas: lanzamientos de sabores"], ["bebidas", "Compran bebidas", "Novedades de matcha y lattes"],
    ["inactivos", "Inactivos", "Sin compras hace más de 45 días: campaña de regreso"], ["todos", "Todos", "Cualquiera con permiso"]];
  const segNom = (k) => (SEGS.find((x) => x[0] === k) || [k, k])[1];
  const EST_C = { borrador: "pendiente", enviando: "pendiente", enviada: "entregado", error: "cancelado" };
  // Machete fijo al pie de Campañas: qué hace cada herramienta, qué estrategia conviene y qué mirar cuando haya datos
  const MACHETE = `<section class="sec machete"><h2>Machete de campañas</h2>
    <p class="muted">Para tener a mano. Los números marcados con ≈ son referencias para arrancar: ajustalos con tus propios datos.</p>
    <details class="pcard" open><summary>Cómo encaja todo</summary>
      <ol>
        <li>El cliente arma el pedido en la web y lo manda por WhatsApp. Si dejó las casillas tildadas, queda con permiso para <b>novedades por WhatsApp</b> y/o <b>anuncios de Meta</b>.</li>
        <li>Al tocar <b>Entregado</b>, la compra viaja a Meta (aparece como "Compra STT-…" en Envíos a Meta). Así Meta aprende quién compra de verdad.</li>
        <li>Con cada compra entregada el cliente cae en un <b>segmento</b> (nuevos, recurrentes, fans de los mochis…). Los números de la tabla de arriba son "con permiso de WhatsApp · con permiso de anuncios".</li>
        <li>Con esos segmentos hacés dos cosas: <b>campañas de WhatsApp</b> (le escribís directo) y <b>públicos de Meta</b> (para anuncios en Instagram/Facebook).</li>
      </ol>
    </details>
    <details class="pcard"><summary>Qué hace cada herramienta</summary>
      <p><b>Campaña de WhatsApp.</b> Manda una plantilla aprobada por Meta a todo un segmento. Cada mensaje de marketing se paga (≈ US$0,06 por persona en Argentina; el valor exacto está en WhatsApp Manager → Facturación). Siempre lleva el botón "No quiero más novedades" y quien lo toca sale solo.</p>
      <p><b>Avisos del pedido.</b> "Recibido", "En preparación", "Listo" y la reseña salen solos y gratis porque el cliente te escribió hace menos de 24 h. No son campañas: no hace falta permiso de novedades.</p>
      <p><b>Público de Meta ("Setto · segmento").</b> Una lista de celulares cifrados que Meta cruza con sus cuentas. Sirve para tres cosas: mostrarle anuncios solo a ese grupo, <b>excluirlo</b> (no pagar por mostrarle "conocé Setto" a quien ya compra) o crear un <b>público similar</b> (gente parecida a tus clientes). Meta pide ≈100 personas reconocidas para usarlo: antes de eso, solo juntá.</p>
      <p><b>Envíos a Meta.</b> El registro de lo que viajó: compras y públicos. Si ves <b>error</b>, el detalle dice qué falta (permisos, condiciones, token).</p>
    </details>
    <details class="pcard"><summary>Estrategia por segmento</summary>
      <div class="hist mach-tab">
        <div><span><b>Clientes nuevos</b> · que vuelva una segunda vez</span><span>3 a 7 días después de la 1ª compra · <code>segunda_compra_v2</code> con un motivo concreto (sello doble, mochi de regalo en el próximo set)</span></div>
        <div><span><b>Recurrentes</b> · que se sientan parte</span><span>Acceso 24 h antes a cada drop o set nuevo · <code>lanzamiento_sabor_v2</code></span></div>
        <div><span><b>Fans de los mochis</b> · sabores nuevos</span><span>El día que sale un mochi nuevo · <code>lanzamiento_sabor_v2</code> con el sabor</span></div>
        <div><span><b>Compran bebidas</b> · lattes y matcha</span><span>Cuando sale un dirty nuevo o arranca el calor · <code>lanzamiento_sabor_v2</code></span></div>
        <div><span><b>Inactivos</b> · que vuelvan</span><span>A los 45 días sin comprar, una sola vez · <code>te_extranamos_v2</code> con una razón para volver (algo nuevo, no solo descuento)</span></div>
        <div><span><b>Todos</b> · lo grande</span><span>Solo para lo que le importa a cualquiera: apertura del local, drop especial. Máximo 1 por mes</span></div>
      </div>
      <p class="hintp">El aviso de drops ("Avisame por WhatsApp" de la edición especial) es aparte: le llega a los anotados y no cuenta como campaña.</p>
    </details>
    <details class="pcard"><summary>Anuncios de Meta: qué hacer según cuántos haya</summary>
      <p><b>Menos de 100 en "Todos".</b> Los públicos todavía no sirven. Anunciá por ubicación (Mar del Plata, radio chico) e intereses (café, postres, cultura japonesa), con destino a la web para que el pixel aprenda. Tocá "Actualizar públicos" una vez por semana para que se vayan llenando.</p>
      <p><b>Más de 100.</b> Creá en el Administrador de anuncios un <b>público similar al 1%</b> de "Setto · todos" y combinalo con ubicación Mar del Plata. En las campañas para conseguir clientes nuevos, <b>excluí</b> "Setto · todos".</p>
      <p><b>Recuperar carritos.</b> Público del pixel: gente que agregó al carrito en los últimos 7 días y no compró. Anuncio con el producto y un empujón ("el set te espera").</p>
    </details>
    <details class="pcard"><summary>Reglas para no quemar el número</summary>
      <ul>
        <li>Máximo <b>1 campaña por semana</b> a la misma persona (2 a 4 por mes en total).</li>
        <li>Siempre <b>Mandar prueba</b> a tu número antes de mandar al segmento.</li>
        <li>Mandá en horario de antojo: ≈ 11–12 h o 16–18 h, nunca de noche.</li>
        <li>Las casillas de permiso vienen tildadas: si las bajas suben, frená y espaciá. Mirá la <b>calidad del número</b> en WhatsApp Manager (verde = bien, amarillo = bajar el ritmo, rojo = parar).</li>
        <li>Plantillas nuevas: Meta las revisa (puede tardar de minutos a 1 día). No pongas variables al principio ni al final del texto.</li>
      </ul>
    </details>
    <details class="pcard"><summary>Cuando haya datos: qué mirar y qué hacer</summary>
      <div class="hist mach-tab">
        <div><span><b>Bajas por campaña</b> (bajas ÷ enviados, en "Respuestas y bajas")</span><span>Menos de 1%: bien · más de 2%: ese mensaje o ese segmento no va, cambiá el texto o mandá menos seguido</span></div>
        <div><span><b>Pedidos en las 48 h siguientes</b> (Pedidos y Clientes, origen whatsapp)</span><span>Compará campañas entre sí: repetí el tipo de mensaje que más pedidos trajo, dejá de mandar el que no trae</span></div>
        <div><span><b>Segunda compra</b> (de "Clientes nuevos" cuántos pasan a 2 compras en 30 días)</span><span>Menos de ≈20%: el incentivo de la 2ª compra es flojo, probá uno más tentador</span></div>
        <div><span><b>Con error</b> en una campaña</span><span>Unos pocos es normal (números sin WhatsApp o que Meta frenó por saturación). Si son muchos, revisá la plantilla</span></div>
        <div><span><b>Costo por compra</b> en Meta (Administrador de anuncios)</span><span>Si pasa ≈30% del ticket promedio, pausá ese anuncio y probá otra foto o video</span></div>
        <div><span><b>Inactivos que vuelven</b> después de <code>te_extranamos_v2</code></span><span>Si casi nadie vuelve, el problema no es el mensaje: preguntales por WhatsApp qué pasó</span></div>
      </div>
    </details>
    <details class="pcard"><summary>Glosario rápido</summary>
      <ul>
        <li><b>Plantilla:</b> texto aprobado por Meta. Es lo único que se puede mandar a alguien que no te escribió en las últimas 24 h.</li>
        <li><b>Ventana de 24 h:</b> desde el último mensaje del cliente podés escribirle libre y gratis.</li>
        <li><b>Compra a Meta (CAPI):</b> el aviso de que un pedido se entregó, con el mismo código que el pixel, para que Meta no la cuente doble.</li>
        <li><b>Público personalizado:</b> tu lista de clientes adentro de Meta. <b>Similar:</b> gente que se parece a esa lista.</li>
        <li><b>UTM:</b> la etiqueta en los links (por ejemplo utm_source=whatsapp) que te dice de dónde llegó cada pedido.</li>
      </ul>
    </details>
  </section>`;
  async function viewCampanas() {
    $("#view").innerHTML = `<h1 class="ph1">Campañas</h1>
      <p class="muted">Solo le llega a quien aceptó en la web o escribió ALTA. Quien toca "No quiero más novedades" (o escribe BAJA) sale solo de todo. Los mensajes usan plantillas aprobadas en WhatsApp Manager.</p>
      <section class="sec"><h2>Segmentos</h2><div class="pcard"><div class="hist" id="segList"><span class="muted">Cargando…</span></div>
        <div class="acts"><button class="btn" id="syncAud">Actualizar públicos de Meta</button></div><span class="hintp">Crea o actualiza un público "Setto · segmento" por cada uno, solo con quienes aceptaron anuncios.</span></div></section>
      <section class="sec"><h2>Nueva campaña de WhatsApp</h2>
        <form class="pcard" id="campForm">
          <div class="row2"><label>Nombre (para vos)<input class="inp" name="nombre" required placeholder="Ej: Lanzamiento Lemon pie"></label>
          <label>Segmento<select class="inp" name="segmento">${SEGS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label></div>
          <div class="row2"><label>Plantilla aprobada (nombre exacto)<input class="inp" name="plantilla" required placeholder="lanzamiento_sabor"></label>
          <label>Idioma de la plantilla<input class="inp" name="idioma" value="es_AR"></label></div>
          <label>Variables del texto, una por línea, en orden ({nombre} = nombre del cliente)<textarea class="inp" name="variables" rows="3" placeholder="{nombre}&#10;Lemon pie"></textarea></label>
          <button class="btn solid" type="submit">Guardar borrador</button></form></section>
      <section class="sec"><h2>Campañas</h2><div class="pgrid" id="campList"><p class="muted">Cargando…</p></div></section>
      <section class="sec"><h2>Respuestas y bajas por WhatsApp</h2><div class="pcard"><div class="hist" id="msgList"><span class="muted">Cargando…</span></div></div></section>
      <section class="sec"><h2>Envíos a Meta</h2><div class="pcard"><div class="hist" id="syncList"><span class="muted">Cargando…</span></div></div></section>${MACHETE}`;
    $("#campForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      try { await API.createCampaign({ nombre: f.nombre.trim(), segmento: f.segmento, plantilla: f.plantilla.trim(), idioma: (f.idioma || "es_AR").trim(), variables: (f.variables || "").split("\n").map((x) => x.trim()).filter(Boolean) });
        toast("Borrador guardado"); e.target.reset(); cargarCampanas(); } catch (err) { toast(err.message); }
    });
    cargarCampanas();
  }
  async function cargarCampanas() {
    try {
      const r = await API.segmentosResumen(); P.segs = r;
      $("#segList").innerHTML = `<div><span class="muted">Segmento</span><span class="muted">WhatsApp · Anuncios</span></div>` + SEGS.map(([k, n, d]) => `<div><span><b>${n}</b> <span class="muted">${d}</span></span><span class="num">${(r[k] || {}).whatsapp || 0} · ${(r[k] || {}).meta_ads || 0}</span></div>`).join("");
    } catch (e) { $("#segList").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    try {
      const l = await API.listCampaigns(); P.camps = l;
      $("#campList").innerHTML = l.length ? l.map((c) => `<article class="pcard" data-camp="${esc(c.id)}">
        <div class="ohead"><b>${esc(c.nombre)}</b><span class="ago">${ago(c.created_at)}</span><span class="st ${EST_C[c.estado] || "pendiente"}">${c.estado}</span></div>
        <p class="hintp">${esc(segNom(c.segmento))} · plantilla <b>${esc(c.plantilla)}</b> (${esc(c.idioma)})${(c.variables || []).length ? " · " + c.variables.map(esc).join(" / ") : ""}</p>
        ${c.estado === "borrador" ? `<div class="row2"><label>Probar con un número<input class="inp" data-prueba inputmode="tel" placeholder="223 347-1277"></label></div>
          <div class="acts"><button class="btn" data-cprobar>Mandar prueba</button><button class="btn solid wa" data-cenviar>Mandar a ${(P.segs && P.segs[c.segmento] || {}).whatsapp || 0}</button></div>`
          : `<p class="num">${c.enviados} enviados · ${c.fallidos} con error${c.enviada_at ? " · " + ago(c.enviada_at) : ""}</p>`}
      </article>`).join("") : '<p class="muted">Todavía no hay campañas.</p>';
    } catch (e) { $("#campList").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    try {
      const a = await API.crmActividad();
      $("#msgList").innerHTML = a.mensajes.map((m) => `<div><span>${esc(pretty(m.phone))} · ${m.estado === "baja" ? "<b>Se dio de baja</b>" : m.estado === "alta" ? "<b>Se suscribió</b>" : esc(m.texto || "")} <span class="muted">${ago(m.created_at)}</span></span><button class="linkbtn" data-client-go="${esc(m.phone)}">Ver</button></div>`).join("") || '<span class="muted">Sin mensajes todavía.</span>';
      $("#syncList").innerHTML = a.sync.map((x) => `<div><span>${x.tipo === "capi" ? "Compra " + esc(x.ref) : "Público " + esc(segNom(x.ref))} · ${x.estado === "ok" ? "ok" : x.estado === "omitido" ? "no se mandó" : "<b>error</b>"} <span class="muted">${esc(x.detalle || "")} · ${ago(x.created_at)}</span></span><span class="num">${x.registros || ""}</span></div>`).join("") || '<span class="muted">Sin envíos todavía.</span>';
    } catch (e) { $("#msgList").innerHTML = $("#syncList").innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
  }

  /* =================== CARTA =================== */
  const CATS = [["especial", "Edición especial"], ["set", "Sets"], ["promo", "Promos"], ["dirty", "Dirty lattes"], ["mochi", "Mochis"]];
  const byCat = (c) => P.products.filter((p) => p.categoria === c).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const draftOf = (p) => P.drafts[p.id] || p;
  function viewCarta() {
    const E = P.settings.especial || {};
    $("#view").innerHTML = `<h1 class="ph1">Carta</h1>
      <p class="muted">Cada tarjeta se guarda por separado con su botón <b>Guardar</b>. Los cambios se ven en la web al instante. Las tarjetas con borde rosa tienen cambios sin guardar.</p>
      ${CATS.map(([c, l]) => `<section class="sec"><h2>${l}</h2>
        ${c === "especial" ? espCfgHtml(E) : ""}
        ${c === "promo" ? `<p class="hintp" style="margin-bottom:12px">Una box de mochis a precio fijo: el cliente elige los sabores entre los mochis visibles de la carta. El cartel de ahorro se calcula solo con el precio del mochi suelto.</p>` : ""}
        <div class="pgrid">${byCat(c).map(cardP).join("")}</div>
        <button class="btn" data-addp="${c}" style="margin-top:14px">+ Agregar ${l === "Sets" ? "set" : l === "Promos" ? "promo" : l === "Mochis" ? "mochi" : l === "Dirty lattes" ? "dirty" : "sabor especial"}</button>
      </section>`).join("")}`;
    loadDropInfo();
  }
  /* ---------- Drop de la edición especial: todo lo que se ve antes, durante y después del lanzamiento ---------- */
  const aLocal = (iso) => { const d = new Date(iso || ""); if (isNaN(d)) return ""; const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  const fechaTxt = (iso) => new Date(iso).toLocaleString("es-AR", { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " hs";
  const faltaTxt = (ms) => { const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60; return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
  function dropStateTxt(E) {
    const f = API.dropEstado(E), visibles = byCat("especial").filter((x) => x.activo !== false).length;
    const sinProd = visibles ? "" : " · <b>Ojo:</b> no hay sabores especiales marcados como Visible, la sección no se ve";
    if (E.modo !== "programado") return (f === "abierto" ? "🟢 Abierta a mano: se puede pedir" : "⏸ Próximamente (a mano): no se puede pedir") + sinProd;
    if (!E.lanzamiento) return "⚠️ Falta la fecha de lanzamiento" + sinProd;
    const ini = Date.parse(E.lanzamiento);
    if (f === "antes") return `⏳ Programado: sale el ${fechaTxt(E.lanzamiento)} (faltan ${faltaTxt(ini - Date.now())})` + sinProd;
    if (f === "abierto") return `🟢 Salió el ${fechaTxt(E.lanzamiento)}: se puede pedir${E.fin ? ` hasta el ${fechaTxt(E.fin)}` : ""}` + sinProd;
    return `⏹ Terminó el ${fechaTxt(E.fin)}: ${E.al_terminar === "mostrar" ? "se muestra como terminado" : "la sección está oculta"}`;
  }
  function espCfgHtml(E) {
    const prog = E.modo === "programado", modo = prog ? "programado" : E.estado === "disponible" ? "disponible" : "proximamente";
    const t = (k, label, ph = "", max = 80) => `<label>${label}<input data-esp="${k}" value="${esc(E[k] || "")}" placeholder="${esc(ph)}" maxlength="${max}"></label>`;
    const si = (k, label, def = true) => `<label><input type="checkbox" data-esp="${k}" ${(def ? E[k] !== false : !!E[k]) ? "checked" : ""}> ${label}</label>`;
    return `<div class="pcard" id="espCfg" style="margin-bottom:16px">
      <b>Lanzamiento de la edición especial</b>
      <p class="dropst" id="dropState">${dropStateTxt(E)}</p>
      <div class="row2">${t("titulo", "Nombre del drop (título de la sección)", "Ej: Mochis Premium · Noviembre")}
        <label>¿Cómo se abre la venta?<select data-esp="modo">
          <option value="programado" ${modo === "programado" ? "selected" : ""}>Drop programado: se abre sola en la fecha</option>
          <option value="proximamente" ${modo === "proximamente" ? "selected" : ""}>A mano: próximamente (no se puede pedir)</option>
          <option value="disponible" ${modo === "disponible" ? "selected" : ""}>A mano: disponible ahora</option></select></label></div>
      <div class="dropprog" ${prog ? "" : "hidden"}>
        <div class="row2"><label>Sale el (día y hora de Argentina)<input type="datetime-local" data-esp="lanzamiento" value="${aLocal(E.lanzamiento)}"></label>
          <label>Termina el (opcional)<input type="datetime-local" data-esp="fin" value="${aLocal(E.fin)}"></label></div>
        <label>Cuando termina<select data-esp="al_terminar"><option value="ocultar" ${E.al_terminar !== "mostrar" ? "selected" : ""}>Ocultar la sección</option><option value="mostrar" ${E.al_terminar === "mostrar" ? "selected" : ""}>Mostrarla como "terminó" (sin poder pedir) para invitar al próximo</option></select></label>
        <b class="dsub">Antes del lanzamiento</b>
        <div class="checks">${si("cuenta", "Cuenta regresiva")}${si("esmerilar", "Esmerilar todas las fotos")}${si("ocultar_nombres", "Ocultar nombres (\"Sabor sorpresa\")", false)}${si("ocultar_precios", "Ocultar precios", false)}${si("tarjetas_antes", "Mostrar las tarjetas de los productos", false)}${si("barra", "Barra con cuenta regresiva arriba de toda la web")}${si("calendario", "Botón Agendar en el calendario")}${si("avisame", "Botón Avisame por WhatsApp")}</div>
        <span class="hintp">Con las tarjetas apagadas, la web muestra solo título, cuenta regresiva y Avisame. <a href="/?ver-especial#especial" target="_blank" rel="noopener">Ver cómo quedan las tarjetas ↗</a> (vista previa, solo con este link).</span>
        <span class="hintp">Al llegar la hora, la web destapa las fotos y habilita los pedidos sola, sin tocar nada. La barra de arriba muestra "¡Ya salió!" durante 48 hs.</span>
        <b class="dsub">Aviso de lanzamiento por WhatsApp</b>
        ${t("wa_nombre", "Nombre del drop en el mensaje", "Ej: la edición Halloween", 60)}
        <span class="hintp">El mensaje dice: "Hola Isa, ya salió <b>${esc(waNombreDrop(E))}</b> de Setto, como te avisamos. Pedila en la web mientras dure el stock." Con botones "Ver la edición" y "No quiero más avisos".</span>
        <details class="dsub-mas"><summary>Notificación para los anotados viejos (push)</summary>
        <div class="row2">${t("push_titulo", "Título", "¡Salió " + (E.titulo || "la edición especial") + "!", 60)}${t("push_texto", "Texto", "Ya se puede pedir. Entrá antes de que se agote.", 140)}</div></details>
        <div class="checks">${si("avisar_auto", "Mandar el aviso solo a la hora del lanzamiento")}</div>
        <div class="dropinfo" id="dropInfo"><span class="muted">Cargando avisos…</span></div>
      </div>
      <div class="row2">${t("chip", "Etiqueta de arriba (antes)", "Ej: Drop mensual · solo 3 días")}${t("chip_post", "Etiqueta de arriba (cuando sale)", "Ej: ¡Ya salió! Hasta agotar stock")}</div>
      <label>Texto debajo del título (antes)<textarea data-esp="intro">${esc(E.intro || "")}</textarea></label>
      <label>Texto debajo del título (cuando sale, opcional)<textarea data-esp="intro_post" placeholder="Si lo dejás vacío se usa el de arriba">${esc(E.intro_post || "")}</textarea></label>
      <div class="savebar"><span class="hintp">Los sabores del drop son los de abajo marcados como Visible.</span><button class="btn solid" data-saveesp>Guardar lanzamiento</button></div></div>`;
  }
  // mismo criterio que nombreDrop() en supabase/functions/_shared/crm.ts
  function waNombreDrop(E) {
    const propio = String(E.wa_nombre || "").trim(); if (propio) return propio.slice(0, 60);
    const t = String(E.titulo || "").replace(/[¡!]+/g, "").trim(); if (!t) return "la edición especial";
    return (/^(la |el |los |las )/i.test(t) ? t : /^edici[oó]n /i.test(t) ? t.replace(/^edici[oó]n /i, "la edición ") : "la edición " + t).slice(0, 60);
  }
  async function loadDropInfo() {
    const box = $("#dropInfo"); if (!box) return;
    try {
      const r = await API.dropAvisos();
      const det = r.whatsapp != null ? ` (${r.whatsapp} por WhatsApp${r.push ? `, ${r.push} por notificación` : ""})` : "";
      box.innerHTML = `<span>📲 <b>${r.suscriptos}</b> ${r.suscriptos === 1 ? "persona anotada" : "personas anotadas"} para los avisos${det}${r.avisado ? ` · ya se avisó este lanzamiento (${new Date(r.avisado).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })})` : ""}</span>
        <button class="btn" data-dropavisar ${r.suscriptos ? "" : "disabled"}>Mandar aviso ahora</button>`;
    } catch (_) { box.innerHTML = `<span class="muted">Los avisos todavía no están activos en la base.</span>`; }
  }
  function setCalc(p) {
    const b = P.products.find((x) => x.id === p.set_bebida), m = P.products.find((x) => x.id === p.set_mochi);
    const rows = [["12 oz", "precio_12"], ["16 oz", "precio_16"]].map(([oz, f]) => {
      const sv = (b ? Number(b[f]) || 0 : 0) + (m ? Number(m.precio) || 0 : 0), pr = Number(p[f]) || 0, a = sv - pr;
      return { txt: `${oz.toUpperCase()}: por separado ${money(sv)} → set ${money(pr)} · ${a > 0 ? `ahorro ${money(a)} (${Math.round((a / sv) * 100)}%)` : "sin ahorro"}`, bad: a <= 0 };
    });
    return `<div class="calc ${rows.some((r) => r.bad) ? "bad" : ""}" data-calc>${rows.map((r) => r.txt).join("<br>")}</div>`;
  }
  // promo: N mochis sueltos (al precio del más barato visible) contra el precio de la box
  function promoCalc(p) {
    const ms = P.products.filter((x) => x.categoria === "mochi" && x.activo !== false && Number(x.precio) > 0).map((x) => Number(x.precio));
    const ref = ms.length ? Math.min(...ms) : 0, n = parseInt(p.promo_cant, 10) || 0, sv = ref * n, pr = parseInt(p.precio, 10) || 0, a = sv - pr;
    const txt = !ref ? "No hay mochis visibles en la carta para armar la box." : `${n} mochis sueltos ${money(sv)} → promo ${money(pr)} · ${a > 0 ? `en la web: "Ahorrás ${money(a)}" (${Math.round((a / sv) * 100)}%)` : "sin ahorro: no se muestra cartel"}`;
    return `<div class="calc ${!ref || a <= 0 ? "bad" : ""}" data-calc>${txt}</div>`;
  }
  function cardP(p0) {
    const p = draftOf(p0), c = p.categoria, dirty = !!P.drafts[p.id] || p._new, F = c === "especial" ? p.formato || "mochi" : c;
    const inp = (f, label, type = "text", extra = "") => `<label>${label}<input data-f="${f}" type="${type}" value="${esc(p[f] ?? "")}" ${extra}></label>`;
    const chk = (f, label) => `<label><input type="checkbox" data-f="${f}" ${p[f] ? "checked" : ""}> ${label}</label>`;
    const money3 = 'min="0" step="100" inputmode="numeric"';
    const opts = (cat, sel) => P.products.filter((x) => x.categoria === cat).map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.nombre)}</option>`).join("");
    return `<article class="pcard ${dirty ? "dirty" : ""} ${p.activo === false ? "oculto" : ""}" data-pid="${esc(p.id)}">
      <div class="ptop"><img src="${esc(p.img || "img/mochito-lie.png")}" alt=""><div><b>${esc(p.nombre)}</b><br>
        <label class="up">${p.img ? "Cambiar foto" : "Subir foto"}<input type="file" accept="image/*" data-photo></label>
        ${p.img && c === "especial" ? `<button class="linkbtn" data-nophoto>Quitar foto</button>` : ""}</div>
        ${p.img ? `<div class="p2">${p.img2 ? `<img src="${esc(p.img2)}" alt="">` : ""}<label class="up">${p.img2 ? "Cambiar 2ª foto" : "+ 2ª foto (opcional)"}<input type="file" accept="image/*" data-photo2></label>${p.img2 ? `<button class="linkbtn" data-nophoto2>Quitar</button>` : ""}</div>` : ""}</div>
      ${inp("nombre", "Nombre")}
      ${c === "especial" ? `<label>Tipo<select data-f="formato">${[["mochi", "Mochi (precio por unidad)"], ["dirty", "Dirty / latte (12 y 16 oz, leche y extras)"], ["set", "Set (bebida + mochi, 12 y 16 oz)"]].map(([v, l]) => `<option value="${v}" ${F === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      ${c === "especial" && F === "set" ? `<label>Mochi que incluye (para el stock)<select data-f="set_mochi"><option value="">—</option>${opts("mochi", p.set_mochi)}${P.products.filter((x) => x.categoria === "especial" && (x.formato || "mochi") === "mochi").map((x) => `<option value="${esc(x.id)}" ${x.id === p.set_mochi ? "selected" : ""}>${esc(x.nombre)} (especial)</option>`).join("")}</select></label><span class="hintp">La bebida la elige el cliente entre las dirty visibles del Especial.</span>` : ""}
      ${c === "set" ? `<div class="row2">${inp("codigo", "Código (ej: Set 04)")}${inp("tema", "Tema (ej: Matcha & cereza)")}</div>
        <div class="row2"><label>Bebida<select data-f="set_bebida">${opts("dirty", p.set_bebida)}</select></label><label>Mochi<select data-f="set_mochi">${opts("mochi", p.set_mochi)}</select></label></div>`
        : `<label>Descripción<textarea data-f="descripcion">${esc(p.descripcion || "")}</textarea></label>`}
      ${c === "promo" ? `<div class="row3">${inp("precio", "Precio de la promo", "number", money3)}${inp("promo_cant", "Mochis que trae", "number", 'min="2" max="20" step="1" inputmode="numeric"')}${inp("orden", "Orden", "number")}</div>`
        : c === "set" || c === "dirty" || (c === "especial" && F !== "mochi") ? `<div class="row3">${inp("precio_12", "Precio 12 oz", "number", money3)}${inp("precio_16", "Precio 16 oz", "number", money3)}${inp("orden", "Orden", "number")}</div>`
        : `<div class="row2">${inp("precio", c === "especial" ? "Precio (0 = a confirmar)" : "Precio por unidad", "number", money3)}${inp("orden", "Orden", "number")}</div>`}
      ${c === "set" ? setCalc(p) : c === "promo" ? promoCalc(p) : ""}
      <div class="checks">${chk("activo", "Visible en la web")}${chk("agotado", "Agotado")}${c === "mochi" ? chk("rotativo", "Rotativo") : ""}${c === "especial" ? chk("esmerilado", "Esmerilado (tapa la foto)") : ""}</div>
      <div class="savebar"><button class="linkbtn warn" data-delp>${P.cancelArm === "del-" + p.id ? "¿Seguro? Tocá de nuevo" : "Eliminar"}</button>
        <span>${dirty ? `<button class="linkbtn" data-undo>Descartar</button> ` : ""}<button class="btn solid" data-savep>Guardar</button></span></div>
    </article>`;
  }
  function redrawCard(id) {
    const el = document.querySelector(`[data-pid="${CSS.escape(id)}"]`); if (!el) return;
    const p = P.drafts[id] || P.products.find((x) => x.id === id); if (!p) { el.remove(); return; }
    const y = window.scrollY; el.outerHTML = cardP(p); window.scrollTo(0, y);
  }
  async function fitBlob(file, max = 1600, q = 0.84) { // achica sin recortar
    let src; try { src = await createImageBitmap(file); } catch (_) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
    const k = Math.min(1, max / Math.max(src.width, src.height)), cv = document.createElement("canvas");
    cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k); cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    const as = (t, q) => new Promise((r) => cv.toBlob(r, t, q)); let b = await as("image/webp", q); if (!b || b.type !== "image/webp") b = await as("image/jpeg", q + 0.02); return b;
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
  const frRow = (i, a = "", b = "", on = true) => `<div class="frrow"><label class="frsw" title="Ofrecer esta franja"><input type="checkbox" name="fon${i}" ${on ? "checked" : ""}><span>${on ? "Activa" : "Apagada"}</span></label>
    <input class="inp" type="time" name="fa${i}" value="${esc(a)}" aria-label="Desde"><span>a</span><input class="inp" type="time" name="fb${i}" value="${esc(b)}" aria-label="Hasta">
    <button type="button" class="linkbtn warn" data-frx aria-label="Borrar franja">✕</button></div>`;
  function ajustesHTML() {
    const S = P.settings, r = S.retiro || { dias: [], rangos: [] }, club = S.club || {};
    const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return `<div>
        <form class="pcard" data-set="contacto"><b>Contacto</b>
          <label>WhatsApp de Setto (recibe los pedidos)<input class="inp" name="whatsapp" value="${esc(pretty(S.whatsapp))}" inputmode="tel"></label>
          <label>Instagram (sin @)<input class="inp" name="instagram" value="${esc(S.instagram || "")}"></label>
          <label>Link de todos los links<input class="inp" name="links" value="${esc(S.links || "")}"></label>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="retiro"><b>Horarios de retiro</b>
          <div class="checks">${dias.map((d, i) => `<label><input type="checkbox" name="d${i}" ${r.dias.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
          <div class="frlist"><small>Franjas</small>${r.rangos.map(([a, b], i) => frRow(i, a, b, !(r.apagadas || []).includes(a + "-" + b))).join("")}</div>
          <button type="button" class="linkbtn" data-fradd>+ Agregar franja</button>
          <span class="hintp">Apagá una franja para dejar de ofrecerla sin borrar el horario. Para cerrarla solo hoy o mañana (o marcar alta demanda), usá <b>Horarios para pedir</b> en el Dashboard. El tope de pedidos se ve en <b>Alta demanda por turno</b>, arriba de Pedidos.</span>
          <div class="row2"><label>Turnos cada (min)<input class="inp" name="cada" type="number" value="${r.cadaMin || 30}"></label><label>Anticipación mínima (min)<input class="inp" name="antic" type="number" value="${r.anticipacionMin || 40}"></label></div>
          <label>Pedidos por turno antes de marcar alta demanda (0 = sin tope)<input class="inp" name="cupo" type="number" min="0" max="20" value="${r.cupoTurno ?? 3}"></label>
          <span class="hintp">Al llegar a ese número, la web deja de ofrecer ese turno, avisa que hay muchos pedidos y recomienda el siguiente libre.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="club"><b>Setto Club</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${club.activo !== false ? "checked" : ""}> Mostrar el Club en la web</label></div>
          <div class="row2"><label>Sellos para el premio<input class="inp" name="meta" type="number" min="2" max="20" value="${club.meta || 8}"></label><span class="hintp" style="align-self:end">Cada pedido entregado suma 1 sello.</span></div>
          <label>Texto del premio (solo se usa si no ofrecés set ni descuento)<input class="inp" name="premio" value="${esc(club.premio || "")}" placeholder="Ej: un set de regalo o 35% off en ese pedido"></label>
          <div class="checks"><label><input type="checkbox" name="pset" ${club.premio_set !== false ? "checked" : ""}> Opción: un set de regalo (12 oz)</label></div>
          <div class="row2"><label>Opción: % de descuento (0 = no ofrecer)<input class="inp" name="pdesc" type="number" min="0" max="100" value="${club.premio_descuento ?? 35}"></label>
          <label>Tope del descuento en $ (0 = sin tope)<input class="inp" name="ptope" type="number" min="0" step="500" value="${club.premio_tope || 0}"></label></div>
          <label>Pedido mínimo para sumar sello (0 = sin mínimo)<input class="inp" name="minimo" type="number" min="0" step="500" value="${club.minimo || 0}"></label>
          <div class="checks"><label><input type="checkbox" name="regalo" ${club.regalo !== false && club.regalo !== "" ? "checked" : ""}> Avisar que cada pedido trae un regalo (en el Club y en el carrito)</label></div>
          <div class="checks"><label><input type="checkbox" name="sres" ${club.sello_resena !== false ? "checked" : ""}> Regalar 1 sello por la reseña de la primera compra (con comentario o foto, una vez por celular)</label></div>
          <span class="hintp">El premio se entrega en el mismo pedido que completa la tarjeta.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard" data-set="personalizacion"><b>Personalización de bebidas</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.personalizacion || {}).activo !== false ? "checked" : ""}> Dejar personalizar dirty y sets</label></div>
          <label>Leches: una por línea, nombre | recargo (la primera es la de base)<textarea class="inp" name="leches" rows="5">${esc(((S.personalizacion || {}).leches || []).map((l) => l.nombre + " | " + (l.precio || 0)).join("\n"))}</textarea></label>
          <label>Opciones para sacar (una por línea)<textarea class="inp" name="sin" rows="3">${esc(((S.personalizacion || {}).sin || []).join("\n"))}</textarea></label>
          <span class="hintp">El recargo se suma al precio de la bebida o del set.</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard wide" data-set="hero"><b>Portada (slides del inicio)</b>
          <span class="hintp">Dos tipos de slide. <b>Foto + texto de la web</b>: subís la foto y escribís título y texto acá (el texto va siempre abajo). <b>Diseño propio</b>: imagen o video con el texto ya diseñado adentro. Medidas: <b>compu 2000 × 1000</b> (2:1) y <b>celular 1080 × 1350</b> (4:5); si no subís la de celular, se usa la de compu recortada. Video: corto (5–15 s), sin sonido, MP4, hasta 25 MB.</span>
          <span class="hintp">En la web se ve solo el primer botón de cada slide, chico y dentro de la foto. Dejá el texto vacío para no mostrarlo. El título y el texto son opcionales: sin ellos la foto ocupa toda la slide.</span>
          <span class="hintp"><b>Orden</b>: el número dice en qué lugar sale cada slide (1 = la primera). Para cambiar el orden, cambiá los números y tocá Guardar; no hace falta volver a subir nada.</span>
          ${[0, 1, 2, 3, 4, 5].map((i) => { const x = ((S.hero || {}).slides || [])[i] || {}, tp = x.tipo === "media" ? "media" : "texto", bs = heroBotones(x);
            const prev = (n, v, vid) => `<span class="upprev ${vid ? "vid" : ""}" data-prevfor="${n}${i}">${v ? (vid ? `<video src="${esc(v)}" muted playsinline></video>` : `<img src="${esc(v)}" alt="">`) : "—"}</span>`;
            const up = (n, label, vid, max, cls = "") => `<div class="upbox ${cls}"><small>${label}</small>${prev(n, x[{ si: "img", sm: "img_m", sv: "video", sw: "video_m" }[n]], vid)}<input type="hidden" name="${n}${i}" value="${esc(x[{ si: "img", sm: "img_m", sv: "video", sw: "video_m" }[n]] || "")}">
              <span class="acts" style="gap:4px"><label class="linkbtn">${vid ? "Subir video" : "Subir"}<input type="file" accept="${vid ? "video/mp4,video/webm,video/quicktime" : "image/*"}" ${vid ? `data-upvid="${n}${i}"` : `data-upimg="${n}${i}" data-upmax="${max}"`} hidden></label><button type="button" class="linkbtn warn" data-upx="${n}${i}">✕</button></span></div>`;
            const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
            return `<div class="slrow2" data-tipo="${tp}"><div class="slhead"><b class="sln">Slide ${i + 1}</b>
              <select class="inp" name="sk${i}" data-sltipo aria-label="Tipo de slide ${i + 1}">${opt([["texto", "Foto + texto de la web"], ["media", "Diseño propio (imagen o video)"]], tp)}</select>
              <label class="slord">Orden<input class="inp" name="so${i}" type="number" inputmode="numeric" min="1" max="6" value="${i + 1}" aria-label="Orden de la slide ${i + 1}"></label></div>
              <div class="upgrid">${up("si", "Imagen compu", false, 2000)}${up("sm", "Imagen celu", false, 1350)}${up("sv", "Video compu", true, 0, "only-media")}${up("sw", "Video celu", true, 0, "only-media")}</div>
              <div class="slf3 only-texto"><label>Título<input class="inp" name="sti${i}" maxlength="40" value="${esc(x.titulo || "")}" placeholder="Ej: Mochis rellenos"></label>
                <label>Texto<input class="inp" name="stx${i}" maxlength="90" value="${esc(x.texto || "")}" placeholder="Ej: Masa suave por fuera, crema por dentro."></label>
                <label>La foto es<select class="inp" name="sa${i}">${opt([["foto", "Foto de fondo completo"], ["recorte", "Producto recortado sin fondo"]], x.ajuste === "recorte" ? "recorte" : "foto")}</select></label>
                <label>Encuadre<select class="inp" name="sp${i}">${opt([["arriba", "Arriba"], ["centro", "Centro"], ["abajo", "Abajo"]], x.pos || "centro")}</select></label></div>
              <label class="only-media">Descripción (no se muestra, ayuda a Google)<input class="inp" name="st${i}" maxlength="80" value="${esc(x.alt || x.titulo || "")}" placeholder="Ej: Set Sakura: strawberry matcha + mochi sakura"></label>
              <div class="slbtns">${[0, 1, 2].map((j) => { const b = bs[j] || {}; return `<div class="slbtn"><small>Botón ${j + 1}</small>
                <input class="inp" name="bt${i}_${j}" maxlength="24" value="${esc(b.texto || "")}" placeholder="${["Ej: Armar mi pedido", "Ej: Pedir por apps", "Sin botón"][j]}" aria-label="Texto del botón ${j + 1}">
                <select class="inp" name="bl${i}_${j}" aria-label="A dónde lleva el botón ${j + 1}">${opt(HERO_LINKS, b.link || "#sets")}</select>
                <select class="inp" name="be${i}_${j}" aria-label="Estilo del botón ${j + 1}">${opt([["principal", "Principal (lleno)"], ["secundario", "Secundario (borde)"]], b.estilo === "secundario" ? "secundario" : (j ? "secundario" : "principal"))}</select></div>`; }).join("")}</div></div>`; }).join("")}
          <label>Cambia cada (segundos)<input class="inp" name="intervalo" type="number" min="3" max="15" value="${(S.hero || {}).intervalo || 5}" style="width:120px"></label>
          <button class="btn solid">Guardar portada</button></form>
        <form class="pcard" data-set="maquinita"><b>Maquinita</b>
          ${(() => { const m = S.maquinita || {};
            const sim = MQ_SIM.map(([n, img], i) => { const c = (m.simbolos || [])[i] || {}, v = c.img || "", ver = v || img; return `<div class="slrow"><span class="upprev" data-prevfor="mi${i}">${ver ? `<img src="${esc(ver)}" alt="" style="object-fit:contain">` : "Estrella<br>(dibujada)"}</span><div class="slf"><input type="hidden" name="mi${i}" value="${esc(v)}">
              <label>${i ? `Símbolo ${i + 1}` : "Símbolo especial (5 iguales = premio mayor)"}<input class="inp" name="mn${i}" maxlength="30" value="${esc(c.nombre || n)}"></label>
              <span class="acts" style="gap:6px"><label class="btn">Subir imagen<input type="file" accept="image/*" data-upimg="mi${i}" data-upmax="400" hidden></label>${v ? `<button type="button" class="linkbtn warn" data-upx="mi${i}">Volver a la original</button>` : ""}</span></div></div>`; }).join("");
            const prem = MQ_PREM.map(([id, cuando, t, ch, tipo, valor]) => { const c = (m.premios || []).find((x) => x.id === id), tp = (c && c.tipo) || tipo, vl = c && c.valor != null ? +c.valor || 0 : valor;
              return `<div class="row2"><label>${cuando}: premio (vacío = sin premio)<input class="inp" name="pt_${id}" maxlength="40" value="${esc(c ? c.titulo || "" : t)}"></label><label>Probabilidad (%)<input class="inp" name="pc_${id}" type="number" min="0" max="100" step="0.1" value="${c ? +c.chance || 0 : ch}"></label></div>
              <div class="row2"><label>Qué se descuenta<select class="inp" name="pk_${id}">${MQ_TIPO.map(([v, l]) => `<option value="${v}" ${tp === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Valor ($ o %, no aplica al mochi)<input class="inp" name="pv_${id}" type="number" min="0" step="1" value="${vl}"></label></div>`; }).join("");
            return `<label class="chk"><input type="checkbox" name="activo" ${m.activo !== false ? "checked" : ""}> Mostrar la maquinita en la web (sección entre Sets y Carta y botón del carrito)</label>
          <div class="row2"><label>Tiradas gratis por día<input class="inp" name="fichas" type="number" min="1" max="5" value="${Math.max(1, +m.fichas_dia || 1)}"></label>
          <label>Fichas por cada compra<input class="inp" name="fcompra" type="number" min="0" max="50" value="${m.fichas_compra ?? 5}"></label></div>
          <span class="hintp">Las fichas de compra se cargan solas al celular del pedido cuando lo marcás entregado. Si lo cancelás, el premio usado vuelve al cliente.</span>
          <b style="margin-top:6px">Premios</b>
          <span class="hintp">La probabilidad es por tirada: 2 = sale 2 de cada 100 tiradas. Son reales: el cliente recibe un código MAQ- atado a su celular y se descuenta solo en su próximo pedido web. El mochi gratis descuenta el mochi más barato del pedido. Si el descuento en $ no se usa entero, le queda el saldo.</span>
          ${prem}
          <b style="margin-top:6px">Símbolos de los rodillos</b>
          <span class="hintp">Imágenes cuadradas con fondo transparente (PNG o WebP). Los primeros 3 también se ven en la tarjeta de la landing.</span>
          ${sim}`; })()}
          <button class="btn solid">Guardar maquinita</button></form>
        <form class="pcard" data-set="stickers"><b>Stickers de WhatsApp</b>
          <span class="hintp">Subí el pack a Sticker.ly desde el celu, tocá Compartir y pegá acá el link. Sin link la sección no se muestra.</span>
          <label class="chk"><input type="checkbox" name="activo" ${(S.stickers || {}).activo ? "checked" : ""}> Mostrar los stickers en la web</label>
          <label>Link del pack en Sticker.ly<input class="inp" name="link" type="url" maxlength="200" value="${esc((S.stickers || {}).link || "")}" placeholder="https://sticker.ly/s/…"></label>
          <label>Título<input class="inp" name="titulo" maxlength="40" value="${esc((S.stickers || {}).titulo || "Stickers de Mochito")}"></label>
          <label>Texto<input class="inp" name="texto" maxlength="140" value="${esc((S.stickers || {}).texto || "Llevate a Mochito a tus chats. Son gratis.")}"></label>
          <button class="btn solid">Guardar stickers</button></form>
        <form class="pcard" data-set="ubicacion"><b>Ubicación (mapa en la web)</b>
          <span class="hintp">El mapa es público. Si retiran en tu casa, poné solo una esquina o la zona (ej: “Güemes y Alberti, Mar del Plata”) y pasá la dirección exacta por WhatsApp.</span>
          <label class="chk"><input type="checkbox" name="activo" ${(S.ubicacion || {}).activo ? "checked" : ""}> Mostrar el mapa</label>
          <label>Qué buscar en el mapa<input class="inp" name="mapa" maxlength="140" value="${esc((S.ubicacion || {}).mapa || "")}" placeholder="Ej: Güemes y Alberti, Mar del Plata"></label>
          <label>Título<input class="inp" name="titulo" maxlength="40" value="${esc((S.ubicacion || {}).titulo || "Dónde estamos")}"></label>
          <label>Texto (opcional)<input class="inp" name="texto" maxlength="160" value="${esc((S.ubicacion || {}).texto || "")}" placeholder="Ej: Retirás por la zona de Güemes. Te pasamos la dirección exacta por WhatsApp."></label>
          <label>Zoom<select class="inp" name="zoom" style="width:auto">${[[13, "Barrio"], [15, "Cuadras"], [17, "Calle"]].map(([v, l]) => `<option value="${v}" ${(+(S.ubicacion || {}).zoom || 15) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          ${(() => { const c = (S.ubicacion || {}).captura || ""; return `<div class="slrow"><span class="upprev" data-prevfor="captura">${c ? `<img src="${esc(c)}" alt="">` : "Sin captura"}</span><div class="slf"><input type="hidden" name="captura" value="${esc(c)}">
            <b style="font-size:.9rem">Captura del mapa (opcional)</b><span class="hintp">Solo si el mapa se ve mal: subí una captura de Google Maps con el punto de retiro al centro (horizontal, 1600×1000) y se muestra en lugar del mapa. Al tocarla abre Google Maps.</span>
            <span class="acts" style="gap:6px"><label class="btn">Subir captura<input type="file" accept="image/*" data-upimg="captura" data-upmax="1600" hidden></label>${c ? `<button type="button" class="linkbtn warn" data-upx="captura">Quitar</button>` : ""}</span></div></div>`; })()}
          <button class="btn solid">Guardar ubicación</button></form>
        <form class="pcard wide" data-set="mensajes"><b>Mensajes de WhatsApp</b>
          <span class="hintp">Lo que va entre llaves se completa solo. Si borrás un mensaje entero, vuelve al original.</span>
          ${["Lo que manda el cliente", "Lo que mandan ustedes"].map((gr) => `<h3 class="msg-gr">${gr}</h3>` + Object.entries(M.MSG).filter(([, d]) => d.grupo === gr).map(([k, d]) => `<label class="msg-row">${esc(d.titulo)}
            <textarea class="inp" name="m_${k}" rows="${Math.min(7, d.texto.split("\n").length + 1)}">${esc(M.texto(k, S))}</textarea>
            <span class="msg-vars">${d.vars.map((v) => `<code title="${esc(M.VARS[v] || "")}">{${v}}</code>`).join(" ")}${d.vars.length ? "" : "Sin variables"} <button type="button" class="linkbtn" data-msgreset="${k}">Volver al original</button></span></label>`).join("")).join("")}
          <details class="hintp"><summary>¿Qué es cada variable?</summary>${Object.entries(M.VARS).map(([v, t]) => `<div><code>{${v}}</code> ${esc(t)}</div>`).join("")}</details>
          <button class="btn solid">Guardar mensajes</button></form>
        <form class="pcard" data-set="giftcards"><b>Gift cards</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.giftcards || {}).activo !== false ? "checked" : ""}> Vender gift cards en la web</label></div>
          <label>Montos sugeridos (separados por coma)<input class="inp" name="montos" value="${esc(((S.giftcards || {}).montos || [10000, 15000, 20000, 30000]).join(", "))}"></label>
          <div class="row2"><label>Mínimo (otro monto)<input class="inp" name="minimo" type="number" step="500" value="${(S.giftcards || {}).minimo || 5000}"></label><label>Máximo<input class="inp" name="maximo" type="number" step="1000" value="${(S.giftcards || {}).maximo || 100000}"></label></div>
          <b style="margin-top:6px">Diseños</b>
          <span class="hintp">Subí una imagen horizontal (proporción 1,6:1, ej. 1600×1000) para usar tu propio diseño. Sin imagen, se usa el diseño dibujado. Los vacíos de abajo sirven para sumar diseños nuevos.</span>
          ${(() => { const its = gItems(); while (its.length < 10) its.push({ id: "", nombre: "", activo: true }); return its.slice(0, 10).map((x, i) => `<div class="slrow"><span class="upprev">${x.img ? `<img src="${esc(x.img)}" alt="">` : GDN[x.id] ? `${esc(GDN[x.id])}<br>(dibujado)` : "Nuevo"}</span>
            <div class="slf"><input type="hidden" name="gi${i}" value="${esc(x.img || "")}"><input type="hidden" name="gid${i}" value="${esc(x.id || "")}">
              <div class="row2"><label>Nombre<input class="inp" name="gn${i}" maxlength="30" value="${esc(x.nombre || "")}" placeholder="${GDN[x.id] ? "" : "Ej: Día de la madre"}"></label><label class="checks" style="align-self:end"><span><input type="checkbox" name="ga${i}" ${x.activo !== false ? "checked" : ""}> Visible</span></label></div>
              <label>Descripción (debajo de la tarjeta)<input class="inp" name="gdsc${i}" maxlength="120" value="${esc(x.desc || "")}" placeholder="${GDD[x.id] ? esc(GDD[x.id]) : "Ej: Para esa mamá que se merece todo."}"></label>
              <div class="acts"><label class="btn">Subir imagen<input type="file" accept="image/*" data-upimg="gi${i}" data-upmax="1600" hidden></label>${x.img ? `<button type="button" class="linkbtn warn" data-gix="${i}">Quitar imagen</button>` : ""}</div></div></div>`).join(""); })()}
          <button class="btn solid">Guardar</button></form>
        <form class="pcard wide" data-set="votacion"><b>Votación</b>
          <div class="checks"><label><input type="checkbox" name="activo" ${(S.votacion || {}).activo ? "checked" : ""}> Mostrar la votación en la web</label><label><input type="checkbox" name="solo" ${(S.votacion || {}).solo_clientes ? "checked" : ""}> Solo clientes (votan números con un pedido entregado)</label></div>
          <label>Pregunta<input class="inp" name="pregunta" maxlength="70" value="${esc((S.votacion || {}).pregunta || "¿Qué sabor querés en la próxima edición?")}"></label>
          ${[0, 1, 2, 3, 4, 5].map((i) => { const o = ((S.votacion || {}).opciones || [])[i] || {}; return `<div class="slrow"><span class="upprev">${o.img ? `<img src="${esc(o.img)}" alt="">` : `Opción ${i + 1}`}</span><div class="slf"><input type="hidden" name="oi${i}" value="${esc(o.img || "")}"><input type="hidden" name="oid${i}" value="${esc(o.id || "")}">
            <label>Nombre<input class="inp" name="on${i}" maxlength="40" value="${esc(o.nombre || "")}" placeholder="${i < 2 ? "Ej: Mochi de calabaza" : "(opcional)"}"></label>
            <div class="acts"><label class="btn">Subir foto<input type="file" accept="image/*" data-upimg="oi${i}" data-upmax="900" hidden></label></div></div></div>`; }).join("")}
          <label>Cierra el (opcional)<input class="inp" name="cierre" type="datetime-local" value="${esc(((S.votacion || {}).cierre || "").slice(0, 16))}" style="width:auto"></label>
          <div id="votRes" class="hintp"></div>
          <div class="acts"><button class="btn solid">Guardar</button><button type="button" class="linkbtn warn" data-votnew>Empezar una votación nueva (borra los resultados de la web)</button></div></form>
        <form class="pcard" data-set="tema"><b>Decoración de temporada</b>
          <label>Tema<select class="inp" name="nombre"><option value="">Ninguno</option><option value="halloween" ${(S.tema || {}).nombre === "halloween" ? "selected" : ""}>Halloween 🎃</option></select></label>
          <span class="hintp">Cambia colores y suma detalles de la temporada. Se saca eligiendo "Ninguno".</span>
          <button class="btn solid">Guardar</button></form>
        <form class="pcard wide" data-set="faq"><b>Preguntas frecuentes</b>
          <span class="hintp">Aparecen al final de la web. Para un link escribí [texto](/armar) o [texto](https://…). Dejá vacía una pregunta para sacarla.</span>
          ${Array.from({ length: 10 }, (_, i) => { const x = (((S.faq || {}).items) || FAQ_DEF)[i] || {}; return `<div class="row2" style="align-items:start"><label>Pregunta ${i + 1}<input class="inp" name="fp${i}" maxlength="90" value="${esc(x.p || "")}"></label><label>Respuesta<textarea class="inp" name="fr${i}" rows="2" maxlength="500">${esc(x.r || "")}</textarea></label></div>`; }).join("")}
          <button class="btn solid">Guardar preguntas</button></form>
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
          <div class="checks"><label><input type="checkbox" name="bloquear" ${(S.stock_web || {}).bloquear !== false ? "checked" : ""}> No dejar pedir más de lo que hay</label></div>
          <span class="hintp">Se toma el stock del Café, el que cargan en la Caja, menos lo que ya está pedido y pendiente. Los pedidos entregados lo descuentan solos.</span>
          <a class="btn" href="caja.html#stock">Cargar stock en la Caja →</a>
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
      </div>`;
  }
  /* Ajustes por secciones: una lista a la izquierda (en el celu, una pantalla con la lista) y la sección abierta
     a la derecha, con una sola barra de Guardar que avisa cuando hay cambios sin guardar. */
  /* maquinita: símbolos y premios por defecto (los mismos que usa maquinita.html si no hay ajustes) */
  const MQ_SIM = [["Mochito", "img/mochito-cup.png"], ["Mochi frutilla", "img/mochi-frutilla.webp"], ["Mochi oreo", "img/mochi-oreo.webp"], ["Dirty caramel", "img/dirty-caramel.webp"], ["Strawberry matcha", "img/dirty-strawberry.webp"], ["Estrella", ""]];
  const MQ_PREM = [["gift", "5 especiales", "Gift card $10.000", 0.1, "monto", 10000], ["mochi", "5 iguales", "Mochi gratis", 0.5, "mochi", 0], ["off", "4 iguales", "10% off", 2, "porcentaje", 10]];
  const MQ_TIPO = [["monto", "Descuento en $"], ["porcentaje", "Descuento en %"], ["mochi", "Un mochi gratis"]];
  const AJ_SEC = [
    { k: "contacto", g: "Pedidos", t: "Contacto", d: "El WhatsApp que recibe los pedidos, Instagram y tu link de links.", s: (S) => pretty(S.whatsapp) || "Sin WhatsApp" },
    { k: "retiro", g: "Pedidos", t: "Horarios de retiro", d: "Qué días y en qué franjas pueden elegir retirar.", s: (S) => { const r = S.retiro || {}, off = r.apagadas || []; return (r.dias || []).length ? `${r.dias.length} días · ${(r.rangos || []).filter((x) => !off.includes(x.join("-"))).map((x) => x.join("–")).join(", ") || "sin franjas activas"}${off.length ? ` · ${off.length} apagada${off.length > 1 ? "s" : ""}` : ""}${(r.cupoTurno ?? 3) > 0 ? ` · tope ${r.cupoTurno ?? 3} por turno` : ""}` : "Sin días"; } },
    { k: "envio", g: "Pedidos", t: "Envío a domicilio", d: "Si ofrecés envío, cuánto cuesta y cómo se paga.", s: (S) => ((S.envio || {}).activo ? ((S.envio || {}).costo ? "Activo · " + money((S.envio || {}).costo) : "Activo · a coordinar") : "Apagado") },
    { k: "pagos", g: "Pedidos", t: "Formas de pago", d: "Las opciones que ve el cliente al pedir.", s: (S) => `${(S.pagos || []).length} formas` },
    { k: "personalizacion", g: "Pedidos", t: "Personalizar bebidas", d: "Leches con recargo y lo que se puede sacar.", s: (S) => ((S.personalizacion || {}).activo !== false ? `Activo · ${((S.personalizacion || {}).leches || []).length} leches` : "Apagado") },
    { k: "stock_web", g: "Pedidos", t: "Stock en la web", d: "Cuántos mochis se ven disponibles y si se frena al llegar a 0.", s: (S) => ((S.stock_web || {}).activo !== false ? ((S.stock_web || {}).bloquear !== false ? "Visible · frena en 0" : "Visible · no frena") : "Oculto") },
    { k: "mensajes", g: "Pedidos", t: "Mensajes de WhatsApp", d: "Los textos que se arman solos para el cliente y para ustedes.", s: (S) => { const n = Object.keys(S.mensajes || {}).length; return n ? `${n} cambiados` : "Los originales"; } },
    { k: "club", g: "Clientes", t: "Setto Club", d: "Sellos, premio, pedido mínimo y regalo de cada pedido.", s: (S) => ((S.club || {}).activo !== false ? `${(S.club || {}).meta || 8} sellos` : "Apagado") },
    { k: "giftcards", g: "Clientes", t: "Gift cards", d: "Montos y diseños de las tarjetas de regalo.", s: (S) => ((S.giftcards || {}).activo !== false ? "A la venta" : "Apagado") },
    { k: "maquinita", g: "Clientes", t: "Maquinita", d: "Premios, tiradas por día, imágenes de los rodillos y si se muestra en la web.", s: (S) => { const m = S.maquinita || {}, n = Math.max(1, +m.fichas_dia || 1); return (m.activo !== false ? "Visible" : "Oculta") + ` · ${n} ${n === 1 ? "tirada" : "tiradas"} por día`; } },
    { k: "votacion", g: "Clientes", t: "Votación", d: "Una pregunta con opciones para que voten en la web.", s: (S) => ((S.votacion || {}).activo ? "Abierta" : "Apagada") },
    { k: "hero", g: "Web", t: "Portada", d: "Las slides del inicio y sus botones.", s: (S) => `${((S.hero || {}).slides || []).length} slides` },
    { k: "ventajas", g: "Web", t: "Pedir acá te conviene", d: "Los motivos para pedir por la web.", s: (S) => ((S.ventajas || {}).activo !== false ? `${((S.ventajas || {}).items || []).length} motivos` : "Oculto") },
    { k: "faq", g: "Web", t: "Preguntas frecuentes", d: "Las preguntas del final de la web.", s: (S) => `${(((S.faq || {}).items) || FAQ_DEF).length} preguntas` },
    { k: "apps", g: "Web", t: "Apps de delivery", d: "Links y logos de PedidosYa, Rappi y Uber Eats.", s: (S) => `${(S.apps || []).length} apps` },
    { k: "ubicacion", g: "Web", t: "Ubicación", d: "El mapa público de la web.", s: (S) => ((S.ubicacion || {}).activo ? "Visible" : "Oculto") },
    { k: "stickers", g: "Web", t: "Stickers de WhatsApp", d: "El link al pack de Mochito.", s: (S) => ((S.stickers || {}).activo ? "Visibles" : "Ocultos") },
    { k: "tema", g: "Web", t: "Decoración de temporada", d: "Colores y detalles de temporada, por ejemplo Halloween.", s: (S) => ((S.tema || {}).nombre ? (S.tema || {}).nombre : "Ninguna") },
  ];
  const ajKey = (form) => JSON.stringify([...new FormData(form).entries()].filter(([, v]) => typeof v === "string")) + (form.dataset.newid || "");
  const ajForm = () => $(".ajbody form[data-set]");
  const ajSucio = () => { const f = ajForm(); return !!f && f.dataset.orig !== ajKey(f); };
  function ajSalir() { return !ajSucio() || confirm("Tenés cambios sin guardar. ¿Salir igual y perderlos?"); }
  function ajCheck() {
    const f = ajForm(); if (!f) return;
    const sucio = ajSucio(), bar = f.querySelector(".ajbar");
    if (!bar || bar.classList.contains("dirty") === sucio) return;
    bar.classList.toggle("dirty", sucio);
    bar.querySelector(".ajst").textContent = sucio ? "Tenés cambios sin guardar" : "Todo guardado";
    bar.querySelector("[data-ajundo]").hidden = !sucio;
  }
  function viewAjustes() {
    const S = P.settings, sec = AJ_SEC.find((x) => x.k === P.ajSec), desk = matchMedia("(min-width:861px)").matches;
    const cur = sec || (desk ? AJ_SEC[0] : null);
    const grupos = [...new Set(AJ_SEC.map((x) => x.g))];
    $("#view").innerHTML = `<div class="aj ${cur && sec ? "abierta" : ""}">
      <aside class="ajnav">
        <h1 class="ph1">Ajustes</h1>
        <input class="inp ajq" type="search" placeholder="Buscar ajuste…" aria-label="Buscar ajuste">
        ${grupos.map((g) => `<div class="ajg"><small>${g}</small>${AJ_SEC.filter((x) => x.g === g).map((x) => `<a href="#ajustes/${x.k}" class="ajit" data-q="${esc((x.t + " " + x.d).toLowerCase())}" ${cur && cur.k === x.k ? 'aria-current="page"' : ""}><b>${esc(x.t)}</b><span>${esc(x.s(S))}</span></a>`).join("")}</div>`).join("")}
        ${API.DEMO ? `<div class="ajg"><small>Demo</small><button class="btn" id="resetDemo">Reiniciar demo</button></div>` : ""}
      </aside>
      <section class="ajbody">${cur ? "" : ""}</section></div>`;
    if (!cur) return;
    const tpl = document.createElement("template"); tpl.innerHTML = ajustesHTML();
    const form = tpl.content.querySelector(`form[data-set="${cur.k}"]`);
    form.className = "pcard ajform";
    form.querySelector(":scope > b").remove();
    [...form.querySelectorAll(":scope button.btn.solid:not([type=button])")].forEach((b) => b.remove());
    const acts = form.querySelector(":scope > .acts"); if (acts && !acts.children.length) acts.remove();
    form.insertAdjacentHTML("afterbegin", `<header class="ajhead"><a href="#ajustes" class="ajback">← Ajustes</a><h2>${esc(cur.t)}</h2><p class="hintp">${esc(cur.d)}</p></header>`);
    form.insertAdjacentHTML("beforeend", `<div class="ajbar"><span class="ajst">Todo guardado</span><button type="button" class="linkbtn" data-ajundo hidden>Descartar</button><button class="btn solid">Guardar</button></div>`);
    $(".ajbody").append(form);
    form.dataset.orig = ajKey(form);
    if (cur.k === "votacion") setTimeout(votResultados, 0);
  }
  async function votResultados() {
    const v = P.settings.votacion || {}, el = $("#votRes"); if (!el || !v.id) return;
    try { const r = await API.pollResults(v.id), ops = v.opciones || [];
      el.innerHTML = r.total ? `<b>Resultados (${r.total} votos):</b> ` + ops.map((o) => `${esc(o.nombre)} ${Math.round(((r.conteo[o.id] || 0) / r.total) * 100)}% (${r.conteo[o.id] || 0})`).join(" · ") : "Todavía no hay votos.";
    } catch (_) {}
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
        const fr = [...form.querySelectorAll(".frrow")].map((row) => { const v = (n) => (row.querySelector(`[name^=${n}]`).value || "").trim();
          return [v("fa").padStart(5, "0"), v("fb").padStart(5, "0"), row.querySelector("[name^=fon]").checked, v("fa") || v("fb")]; }).filter((x) => x[3]);
        if (!fr.length) throw new Error("Agregá al menos una franja");
        if (fr.some(([a, b]) => !/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b) || a >= b)) throw new Error("Revisá las franjas: cada una necesita desde y hasta, y el hasta va después");
        const dias = [0, 1, 2, 3, 4, 5, 6].filter((i) => f["d" + i]), prev = P.settings.retiro || {};
        await API.saveSetting("retiro", { dias, rangos: fr.map(([a, b]) => [a, b]), apagadas: fr.filter((x) => !x[2]).map(([a, b]) => a + "-" + b),
          cierres: cierresVigentes(prev), liberados: liberadosVigentes(prev), cadaMin: Math.max(5, +f.cada || 30), anticipacionMin: Math.max(0, +f.antic || 0),
          cupoTurno: Math.max(0, Math.min(20, Math.round(+f.cupo || 0))) });
      }
      if (k === "club") await API.saveSetting("club", { activo: !!f.activo, meta: Math.max(2, Math.min(20, +f.meta || 8)), sellos_por_pedido: 1, premio: (f.premio || "").trim(), minimo: Math.max(0, +f.minimo || 0),
        premio_set: !!f.pset, premio_descuento: Math.max(0, Math.min(100, +f.pdesc || 0)), premio_tope: Math.max(0, +f.ptope || 0), regalo: !!f.regalo, sello_resena: !!f.sres });
      if (k === "maquinita") {
        const premios = MQ_PREM.map(([id, , , , tipo]) => { const tp = MQ_TIPO.some(([k]) => k === f["pk_" + id]) ? f["pk_" + id] : tipo;
          return { id, titulo: (f["pt_" + id] || "").trim(), chance: Math.max(0, Math.min(100, +String(f["pc_" + id] || "0").replace(",", ".") || 0)), tipo: tp, valor: tp === "mochi" ? 0 : Math.max(0, Math.round(+f["pv_" + id] || 0)) }; });
        if (premios.reduce((a, p) => a + (p.titulo ? p.chance : 0), 0) > 100) throw new Error("Las probabilidades suman más de 100%");
        const malo = premios.find((p) => p.titulo && p.tipo !== "mochi" && (!p.valor || (p.tipo === "porcentaje" && p.valor > 100)));
        if (malo) throw new Error(`Revisá el valor de “${malo.titulo}”`);
        await API.saveSetting("maquinita", { activo: !!f.activo, fichas_dia: Math.max(1, Math.min(5, Math.round(+f.fichas || 1))), fichas_compra: Math.max(0, Math.min(50, Math.round(+f.fcompra || 0))), premios,
          simbolos: MQ_SIM.map(([n], i) => ({ nombre: (f["mn" + i] || "").trim() || n, img: (f["mi" + i] || "").trim() })) });
      }
      if (k === "personalizacion") {
        const leches = (f.leches || "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => { const [n, pr] = s.split("|").map((x) => x.trim()); return { nombre: n, precio: Math.max(0, Math.round(+String(pr || "0").replace(/[^0-9.,]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")) || 0) }; }).filter((l) => l.nombre);
        await API.saveSetting("personalizacion", { activo: !!f.activo, leches, sin: (f.sin || "").split("\n").map((s) => s.trim()).filter(Boolean) });
      }
      if (k === "hero") {
        const slides = [0, 1, 2, 3, 4, 5].map((i) => {
          const tipo = f["sk" + i] === "media" ? "media" : "texto", g = (n) => (f[n + i] || "").trim();
          const botones = [0, 1, 2].map((j) => ({ texto: (f[`bt${i}_${j}`] || "").trim(), link: f[`bl${i}_${j}`] || "#sets", estilo: f[`be${i}_${j}`] === "secundario" ? "secundario" : "principal" })).filter((b) => b.texto);
          const x = { tipo, img: g("si"), img_m: g("sm"), botones };
          if (tipo === "media") Object.assign(x, { video: g("sv"), video_m: g("sw"), alt: g("st") });
          else Object.assign(x, { titulo: g("sti"), texto: g("stx"), ajuste: f["sa" + i] === "recorte" ? "recorte" : "foto", pos: f["sp" + i] || "centro", alt: g("sti") });
          return { x, o: Math.round(+f["so" + i]) || i + 1, i };
        }).filter(({ x }) => x.img || x.img_m || x.video || x.video_m)
          // el número de "Orden" decide el lugar; si dos tienen el mismo número, queda primero la que estaba más arriba
          .sort((a, b) => a.o - b.o || a.i - b.i).map(({ x }) => x);
        if (!slides.length) throw new Error("Subí al menos una imagen o video");
        await API.saveSetting("hero", { slides, intervalo: Math.max(3, Math.min(15, +f.intervalo || 5)) });
      }
      if (k === "mensajes") { const out = {}; Object.keys(M.MSG).forEach((key) => { const v = (f["m_" + key] || "").replace(/\r/g, "").trim(); if (v && v !== M.MSG[key].texto) out[key] = v; }); await API.saveSetting("mensajes", out); }
      if (k === "giftcards") await API.saveSetting("giftcards", { activo: !!f.activo, montos: (f.montos || "").split(",").map((x) => Math.round(+x.replace(/[^\d]/g, ""))).filter((x) => x > 0).slice(0, 6),
        minimo: Math.max(1000, +f.minimo || 5000), maximo: Math.max(+f.minimo || 5000, +f.maximo || 100000),
        items: Array.from({ length: 10 }, (_, i) => ({ id: (f["gid" + i] || "").trim() || ((f["gn" + i] || "").trim() || f["gi" + i] ? "d" + Date.now().toString(36) + i : ""), nombre: (f["gn" + i] || "").trim(), desc: (f["gdsc" + i] || "").trim(), img: (f["gi" + i] || "").trim(), activo: !!f["ga" + i] }))
          .filter((x) => x.id && (x.img || GDN[x.id]) && (x.nombre || GDN[x.id])).map((x) => ({ ...x, nombre: x.nombre || GDN[x.id] })),
        disenos: Object.keys(GDN) });
      if (k === "votacion") {
        const ops = [0, 1, 2, 3, 4, 5].map((i) => ({ id: (f["oid" + i] || "").trim() || "o" + Date.now().toString(36) + i, nombre: (f["on" + i] || "").trim(), img: (f["oi" + i] || "").trim() })).filter((o) => o.nombre);
        if (f.activo && ops.length < 2) throw new Error("Cargá al menos 2 opciones");
        const prev = P.settings.votacion || {};
        await API.saveSetting("votacion", { activo: !!f.activo, id: form.dataset.newid || prev.id || "v1", pregunta: (f.pregunta || "").trim(), opciones: ops, solo_clientes: !!f.solo, cierre: f.cierre ? new Date(f.cierre).toISOString() : "" });
      }
      if (k === "stickers") {
        const link = (f.link || "").trim();
        if (link && !/^https:\/\/([a-z0-9-]+\.)*sticker\.ly\//i.test(link)) throw new Error("Pegá el link que te da Sticker.ly (empieza con https://sticker.ly/)");
        if (f.activo && !link) throw new Error("Para mostrar los stickers falta el link del pack");
        await API.saveSetting("stickers", { activo: !!f.activo, link, titulo: (f.titulo || "").trim() || "Stickers de Mochito", texto: (f.texto || "").trim() });
      }
      if (k === "ubicacion") await API.saveSetting("ubicacion", { activo: !!f.activo, mapa: (f.mapa || "").trim(), titulo: (f.titulo || "").trim() || "Dónde estamos", texto: (f.texto || "").trim(), zoom: +f.zoom || 15, captura: (f.captura || "").trim() });
      if (k === "tema") await API.saveSetting("tema", { nombre: f.nombre || "" });
      if (k === "faq") await API.saveSetting("faq", { items: Array.from({ length: 10 }, (_, i) => ({ p: (f["fp" + i] || "").trim(), r: (f["fr" + i] || "").trim() })).filter((x) => x.p && x.r) });
      if (false) await API.saveSetting("mochi_info", { activo: !!f.activo, titulo: (f.titulo || "").trim() || "¿Qué es un mochi?", texto: (f.texto || "").trim(),
        puntos: (f.puntos || "").split("\n").map((s) => s.trim()).filter(Boolean), img: (f.img || "").trim(), ajuste: f.ajuste === "foto" ? "foto" : "recorte" });
      if (k === "ventajas") await API.saveSetting("ventajas", { activo: !!f.activo, titulo: (f.titulo || "").trim() || "Pedir acá te conviene",
        items: (f.items || "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => { const [t, ...d] = s.split("|"); return { titulo: t.trim(), detalle: d.join("|").trim() }; }) });
      if (k === "envio") await API.saveSetting("envio", { activo: !!f.activo, costo: Math.max(0, +f.costo || 0), aviso: (f.aviso || "").trim(), pago: f.pago || "Transferencia / Mercado Pago" });
      if (k === "stock_web") await API.saveSetting("stock_web", { activo: !!f.activo, bloquear: !!f.bloquear, umbral: Math.max(1, Math.min(50, +f.umbral || 3)) });
      if (k === "pagos") await API.saveSetting("pagos", (f.pagos || "").split("\n").map((s) => s.trim()).filter(Boolean));
      if (k === "apps") await API.saveSetting("apps", [0, 1, 2, 3].map((i) => ({ nombre: (f["an" + i] || "").trim(), url: (f["au" + i] || "").trim(), logo: (f["al" + i] || "").trim() })).filter((a) => a.nombre));
      await loadBase(); toast("Guardado"); viewAjustes();
      const ok = $(".ajbar .ajst"); if (ok) { ok.textContent = "✓ Guardado"; }
    } catch (e) { toast(e.message); }
  }

  /* =================== AVISOS PUSH AL EQUIPO =================== */
  // Este dispositivo recibe una notificación cuando entra un pedido, una gift card, un cambio resuelto o una reseña (migración 027).
  const AV = { open: false, estado: "cargando", busy: false };
  const AVX = "setto-avisos-equipo-visto";
  const vapidKey = (window.SETTO_CONFIG || {}).vapidPublicKey;
  const avSoporte = () => !!vapidKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const claveVapid = (k) => { const b = atob((k + "=".repeat((4 - (k.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  const avSub = async () => { const reg = await navigator.serviceWorker.getRegistration("/sw.js"); return reg ? reg.pushManager.getSubscription() : null; };
  async function avEstado() {
    if (API.DEMO) return "demo";
    if (!avSoporte()) return esIOS && !instalada ? "ios" : "nosoporta";
    if (Notification.permission === "denied") return "bloqueado";
    if (Notification.permission !== "granted") return "apagado";
    try { const sub = await avSub(); return sub && (await API.equipoPushActivo(sub.endpoint)) ? "activo" : "apagado"; } catch (_) { return "apagado"; }
  }
  async function avisosInit() {
    AV.estado = await avEstado();
    let visto = false; try { visto = !!localStorage.getItem(AVX); } catch (_) {}
    if (AV.estado === "apagado" && !visto) AV.open = true; // la primera vez se muestra solo, después queda en la campanita
    drawAvisos();
  }
  function drawAvisos() {
    const box = $("#avisos"), btn = $("#avisosBtn"); if (!box || !btn) return;
    btn.setAttribute("aria-expanded", String(AV.open)); btn.classList.toggle("on", AV.estado === "activo");
    btn.querySelector("i").hidden = !["apagado", "ios"].includes(AV.estado);
    box.hidden = !AV.open; if (!AV.open) return;
    const qué = "pedido nuevo, gift card, cliente que responde un cambio, reseña para aprobar y tarea nueva en la caja";
    const x = `<button class="linkbtn" data-avx>Cerrar</button>`;
    const body = {
      cargando: `<p>Revisando los avisos…</p>`,
      demo: `<p>En modo demo no hay avisos.</p>${x}`,
      nosoporta: `<p><b>Este navegador no recibe notificaciones.</b> Probá desde Chrome en Android o en la compu.</p>${x}`,
      ios: `<p><b>En iPhone los avisos llegan solo con el panel en tu pantalla de inicio</b> (iOS 16.4 o más).</p>
        <ol><li>Tocá <b>Compartir</b> en Safari.</li><li>Elegí <b>Agregar a inicio</b>.</li><li>Abrí el panel desde ese ícono y activá los avisos acá.</li></ol>${x}`,
      bloqueado: `<p><b>Las notificaciones del panel están bloqueadas</b> en este navegador. Si las querés, activalas en los ajustes del sitio y volvé a entrar.</p>${x}`,
      apagado: `<p><b>Avisos en este dispositivo</b><br>Te llega una notificación con cada ${qué}, aunque tengas el panel cerrado.</p>
        ${esIOS ? `<span class="hintp">En iPhone funciona solo con el panel agregado a inicio (iOS 16.4 o más).</span>` : ""}
        <div class="acts"><button class="btn solid" data-avon ${AV.busy ? "disabled" : ""}>${AV.busy ? "Activando…" : "Activar avisos"}</button>${x}</div>`,
      activo: `<p><b>✓ Este dispositivo recibe avisos</b><br>Con cada ${qué}.</p>
        <div class="acts"><button class="btn" data-avtest>Probar</button><button class="linkbtn" data-avoff ${AV.busy ? "disabled" : ""}>Apagar en este dispositivo</button>${x}</div>`,
    }[AV.estado];
    box.innerHTML = body;
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("#avisosBtn,[data-avx],[data-avon],[data-avoff],[data-avtest]"); if (!b) return;
    if (b.id === "avisosBtn" || b.dataset.avx !== undefined) {
      AV.open = b.id === "avisosBtn" ? !AV.open : false;
      if (!AV.open) { try { localStorage.setItem(AVX, "1"); } catch (_) {} }
      if (AV.open && AV.estado !== "activo") AV.estado = await avEstado();
      return drawAvisos();
    }
    if (b.dataset.avtest !== undefined) {
      try { const reg = await navigator.serviceWorker.ready; await reg.showNotification("🛎️ Prueba de Setto", { body: "Así te van a llegar los avisos del panel.", icon: "/img/icon-192.png", badge: "/img/icon-192.png", tag: "setto-prueba", data: { url: "/panel" } }); }
      catch (err) { toast("No se pudo mostrar la prueba"); }
      return;
    }
    AV.busy = true; drawAvisos();
    try {
      if (b.dataset.avon !== undefined) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { AV.estado = perm === "denied" ? "bloqueado" : "apagado"; return; }
        const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(vapidKey) }));
        await API.equipoPushSuscribir(sub);
        AV.estado = "activo"; toast("Listo: este dispositivo recibe avisos");
      } else {
        const sub = await avSub();
        if (sub) await API.equipoPushDesuscribir(sub.endpoint); // la suscripción del navegador queda: la puede usar el seguimiento o los drops
        AV.estado = "apagado"; toast("Avisos apagados en este dispositivo");
      }
    } catch (err) { toast(err.message || "No se pudieron cambiar los avisos"); }
    finally { AV.busy = false; drawAvisos(); }
  });

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
      if (b.dataset.etapa) {
        const o = P.orders.find((x) => x.id === id); b.disabled = true;
        if (o && (o.etapa || "recibido") === b.dataset.etapa) return;
        try { await API.setEtapa(id, b.dataset.etapa); if (o) o.etapa = b.dataset.etapa; drawOrders(); cargarOcupados(); toast("Estado actualizado · el WhatsApp le sale solo"); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.pagado) {
        const o = P.orders.find((x) => x.id === id), si = b.dataset.pagado === "1"; b.disabled = true;
        try { const at = await API.marcarPagado(id, si); if (o) o.pagado_at = si ? at || new Date().toISOString() : null; drawOrders(); toast(si ? `${o ? o.code : "Pedido"} marcado como pagado` : "Marcado como sin pagar"); }
        catch (err) { toast(err.message); b.disabled = false; }
        return;
      }
      if (b.dataset.pagoedit !== undefined) { P.editPago = P.editPago === id ? null : id; drawOrders(); return; }
      if (b.dataset.pagoset !== undefined) {
        const o = P.orders.find((x) => x.id === id), nuevo = b.dataset.pagoset;
        if (!o || nuevo === o.pago) { P.editPago = null; drawOrders(); return; }
        b.disabled = true;
        try { const r = await API.setPago(id, nuevo); o.pago = r.pago; P.editPago = null; drawOrders(); toast(`Pago: ${r.pago}${r.caja ? ` · en la Caja pasó a ${r.cuenta === "efectivo" ? "Efectivo" : "MP"}` : ""}`); }
        catch (err) { toast(err.message); b.disabled = false; }
        return;
      }
      if (b.dataset.usarwa !== undefined) { // tipeó mal su número: pasamos el pedido (y los sellos) al número desde el que escribió
        b.disabled = true;
        try { const ph = await API.usarNumeroWa(id), o = P.orders.find((x) => x.id === id); if (o) { o.phone = ph; o.wa_phone = null; } delete P.confirm[id]; drawOrders(); toast(`Listo · el pedido y los sellos van a ${pretty(ph)}`); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.aviso) { // el link abre WhatsApp; acá solo lo marcamos como avisado
        const o = P.orders.find((x) => x.id === id), et = b.dataset.aviso, at = new Date().toISOString();
        if (o) o.avisos = { ...(o.avisos || {}), [et]: at };
        API.marcarAviso(id, et).catch(() => { try { localStorage.setItem(AVK, JSON.stringify({ ...avisosLocal(), [id + ":" + et]: at })); } catch (_) {} });
        setTimeout(drawOrders, 400); return;
      }
      if (b.dataset.falta !== undefined) { P.falta[id] = { sel: {}, nota: "" }; drawOrders(); return; }
      if (b.dataset.fx !== undefined) { delete P.falta[id]; drawOrders(); return; }
      if (b.dataset.fq) { const [ix, d] = b.dataset.fq.split(":").map(Number), o = P.orders.find((x) => x.id === id), F = P.falta[id]; F.sel[ix] = Math.max(1, Math.min(o.items[ix].qty, (F.sel[ix] || 1) + d)); drawOrders(); return; }
      if (b.dataset.fsend !== undefined) {
        const F = P.falta[id]; b.disabled = true;
        try { const cam = await API.pedirCambio(id, Object.entries(F.sel).map(([idx, qty]) => ({ idx: +idx, qty })), F.nota); const o = P.orders.find((x) => x.id === id); if (o) o.cambio = cam; delete P.falta[id]; drawOrders(); toast("Listo · mandale el aviso por WhatsApp"); }
        catch (err) { toast(err.message); b.disabled = false; }
        return;
      }
      if (b.dataset.fquitar !== undefined) { try { await API.quitarCambio(id); const o = P.orders.find((x) => x.id === id); if (o) o.cambio = null; drawOrders(); toast("Aviso quitado"); } catch (err) { toast(err.message); } return; }
      if (b.dataset.deliver !== undefined) {
        b.disabled = true;
        const od = P.orders.find((x) => x.id === id);
        try { const r = await API.confirmOrder(id, c.phone, c.n); if (od) P.justDelivered = { ...od, phone: r.phone || od.phone, sellos: c.n }; toast((r.canje ? `Entregado · premio canjeado · la tarjeta vuelve a ${r.sellos}` : c.n ? `Entregado · ${pretty(r.phone)} tiene ${r.sellos} sello(s)` : "Entregado") + " · cargado en la caja"); delete P.confirm[id]; refreshOrders(false); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.cancel !== undefined) {
        if (P.cancelArm !== id) { P.cancelArm = id; drawOrders(); return; }
        try { await API.cancelOrder(id); P.cancelArm = null; toast("Pedido cancelado"); refreshOrders(false); } catch (err) { toast(err.message); }
      }
    }
    if (b.dataset.cadd) { try { const r = await API.addStamps(P.client, "", +b.dataset.cadd, b.dataset.cadd > 0 ? "Manual" : "Corrección"); toast(`Ahora tiene ${r.sellos} sello(s)`); openClient(P.client); listClients(); } catch (err) { toast(err.message); } }
    if (b.id === "syncAud") { b.disabled = true; toast("Actualizando públicos…"); try { const r = await API.syncAudiencias(); const t = Object.entries(r.segmentos || {}).map(([k, v]) => v.error ? `${segNom(k)}: error` : `${segNom(k)} +${v.sumados} −${v.sacados}`).join(" · "); toast(t || "Listo"); cargarCampanas(); } catch (err) { toast(err.message); } b.disabled = false; }
    if (b.dataset.cprobar !== undefined || b.dataset.cenviar !== undefined) {
      const card = b.closest("[data-camp]"), id = card.dataset.camp, c = (P.camps || []).find((x) => x.id === id);
      const prueba = b.dataset.cprobar !== undefined ? card.querySelector("[data-prueba]").value.trim() : null;
      if (prueba === "") { toast("Poné el número para la prueba"); return; }
      if (!prueba && !confirm(`¿Mandar "${c.nombre}" a ${(P.segs && P.segs[c.segmento] || {}).whatsapp || 0} cliente(s) con permiso? No se puede deshacer.`)) return;
      b.disabled = true;
      try { const r = await API.sendCampaign(id, prueba); toast(prueba ? "Prueba enviada" : `Listo: ${r.enviados} enviados, ${r.fallidos} con error`); cargarCampanas(); } catch (err) { toast(err.message); b.disabled = false; }
    }
    if (b.dataset.clientGo) { P.client = b.dataset.clientGo; go("club"); }
    if (b.dataset.baja) { if (!confirm("¿Dar de baja este permiso? Las automatizaciones dejan de usar este número para eso.")) return; try { await API.bajaMarketing(P.client, b.dataset.baja); toast("Listo, quedó dado de baja"); openClient(P.client); } catch (err) { toast(err.message); } }
    if (b.dataset.redeem !== undefined) { try { await API.redeem(P.client); toast("Premio canjeado"); openClient(P.client); listClients(); } catch (err) { toast(err.message); } }

    /* carta */
    if (b.dataset.saveesp !== undefined) {
      const box = $("#espCfg"), el = (k) => box.querySelector(`[data-esp="${k}"]`), v = (k) => el(k).value.trim(), on = (k) => el(k).checked;
      const modo = v("modo"), prog = modo === "programado", iso = (k) => (v(k) ? new Date(v(k)).toISOString() : "");
      const lan = iso("lanzamiento"), fin = iso("fin");
      if (prog && !lan) return toast("Poné el día y la hora del lanzamiento");
      if (prog && fin && fin <= lan) return toast("La fecha de fin tiene que ser después del lanzamiento");
      const E = { titulo: v("titulo"), modo: prog ? "programado" : "manual", estado: modo === "disponible" ? "disponible" : "proximamente",
        lanzamiento: lan, fin, al_terminar: v("al_terminar"),
        cuenta: on("cuenta"), esmerilar: on("esmerilar"), ocultar_nombres: on("ocultar_nombres"), ocultar_precios: on("ocultar_precios"), tarjetas_antes: on("tarjetas_antes"), barra: on("barra"), calendario: on("calendario"), avisame: on("avisame"),
        avisar_auto: on("avisar_auto"), push_titulo: v("push_titulo"), push_texto: v("push_texto"), wa_nombre: v("wa_nombre"),
        chip: v("chip"), chip_post: v("chip_post"), intro: v("intro"), intro_post: v("intro_post") };
      try { await API.saveSetting("especial", E); await loadBase(); toast(prog && API.dropEstado(E) === "antes" ? "Drop programado" : "Lanzamiento guardado"); $("#dropState").innerHTML = dropStateTxt(E); } catch (err) { toast(err.message); }
    }
    if (b.dataset.dropavisar !== undefined) {
      if (!confirmar(b)) return;
      b.disabled = true;
      try { const n = await API.dropAvisar(); toast(`Aviso enviado a ${n} ${n === 1 ? "persona" : "personas"}`); } catch (err) { toast(err.message); }
      loadDropInfo();
    }
    if (b.dataset.addp) {
      const c = b.dataset.addp, base = { especial: "esp", set: "set", promo: "promo", dirty: "dirty", mochi: "mochi" }[c];
      const id = base + "-" + Date.now().toString(36);
      const first = (cat) => (P.products.find((x) => x.categoria === cat) || {}).id || null;
      const p = { id, categoria: c, nombre: c === "set" ? "Nuevo set" : c === "promo" ? "Nueva promo" : "Nuevo sabor", ...(c === "promo" ? { promo_cant: 5 } : {}), descripcion: "", img: "", precio: c === "mochi" ? 5000 : 0, precio_12: c === "set" || c === "dirty" ? 0 : null, precio_16: c === "set" || c === "dirty" ? 0 : null,
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
        if (d.set_mochi === "") d.set_mochi = null;
        if (d.categoria === "promo" && !((parseInt(d.promo_cant, 10) || 0) >= 2 && parseInt(d.promo_cant, 10) <= 20)) return toast("Los mochis de la promo van de 2 a 20");
        ["precio", "precio_12", "precio_16", "orden", "promo_cant"].forEach((k) => { if (d[k] !== null && d[k] !== undefined && d[k] !== "") d[k] = parseInt(d[k], 10) || 0; });
        b.disabled = true;
        try { await API.saveProduct(d); delete P.drafts[id]; await loadBase(); toast("Guardado"); redrawCard(id); }
        catch (err) { toast(err.message); b.disabled = false; }
      }
      if (b.dataset.undo !== undefined) {
        delete P.drafts[id];
        if (base && base._new) { P.products = P.products.filter((x) => x.id !== id); viewCarta(); } else redrawCard(id);
      }
      if (b.dataset.nophoto !== undefined) { P.drafts[id] = { ...(P.drafts[id] || base), img: "" }; redrawCard(id); }
      if (b.dataset.nophoto2 !== undefined) { P.drafts[id] = { ...(P.drafts[id] || base), img2: null }; redrawCard(id); }
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
    if (t.matches("[data-fnota]")) { const F = P.falta[t.closest("[data-oid]").dataset.oid]; if (F) F.nota = t.value; return; }
    const pc = t.closest("[data-pid]"); if (!pc || !t.dataset.f) return;
    const id = pc.dataset.pid, base = P.products.find((x) => x.id === id);
    const d = P.drafts[id] || (P.drafts[id] = { ...base });
    d[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value;
    pc.classList.add("dirty");
    if (!pc.querySelector("[data-undo]")) { const sp = pc.querySelector("[data-savep]").parentElement; sp.insertAdjacentHTML("afterbegin", '<button class="linkbtn" data-undo>Descartar</button> '); }
    if (d.categoria === "set" || d.categoria === "promo") { const c = pc.querySelector("[data-calc]"); if (c) c.outerHTML = d.categoria === "set" ? setCalc(d) : promoCalc(d); }
    if (t.dataset.f === "activo") pc.classList.toggle("oculto", !t.checked);
    if (t.dataset.f === "formato") redrawCard(id);
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-sltipo]")) { t.closest(".slrow2").dataset.tipo = t.value; return; }
    if (t.matches('[data-esp="modo"]')) { t.closest("#espCfg").querySelector(".dropprog").hidden = t.value !== "programado"; return; }
    if (t.matches("[data-fsel]")) { const id = t.closest("[data-oid]").dataset.oid, F = P.falta[id], ix = +t.dataset.fsel, o = P.orders.find((x) => x.id === id);
      if (t.checked) F.sel[ix] = o.items[ix].qty; else delete F.sel[ix]; drawOrders(); return; }
    if (t.matches("[data-upimg]") && t.files && t.files[0]) {
      const form = t.closest("form"), name = t.dataset.upimg, max = +t.dataset.upmax || 1600; toast("Subiendo foto…");
      try { const blob = await fitBlob(t.files[0], max, /^s[im]\d/.test(name) ? 0.74 : 0.84); /* portada: más liviana, es lo primero que se descarga */ const url = await API.uploadPhoto(blob, "web-" + name); form.querySelector(`[name="${name}"]`).value = url;
        const prev = form.querySelector(`[data-prevfor="${name}"]`) || (t.closest(".slrow, .acts") || t.parentElement).querySelector(".upprev") || (t.closest(".slrow") || form).querySelector(".upprev"); if (prev) prev.innerHTML = `<img src="${url}" alt="">`; toast("Foto lista · tocá Guardar"); }
      catch (err) { toast(err.message || "No se pudo subir la foto"); }
      return;
    }
    if (t.matches("[data-upvid]") && t.files && t.files[0]) {
      const form = t.closest("form"), name = t.dataset.upvid, file = t.files[0];
      if (!/^video\//.test(file.type)) { toast("Elegí un video (MP4)"); return; }
      if (file.size > 25 * 1024 * 1024) { toast("El video pesa más de 25 MB. Acortalo o comprimilo."); return; }
      toast("Subiendo video… (puede tardar)");
      try { const url = await API.uploadMedia(file, "web-" + name); form.querySelector(`[name="${name}"]`).value = url; const pv = form.querySelector(`[data-prevfor="${name}"]`); if (pv) pv.innerHTML = `<video src="${url}" muted playsinline></video>`; toast("Video listo · tocá Guardar"); }
      catch (err) { toast(err.message || "No se pudo subir el video"); }
      return;
    }
    if (t.matches("[data-applogo]") && t.files && t.files[0]) {
      const i = t.dataset.applogo, row = t.closest(".applogo"); toast("Subiendo logo…");
      try { const blob = await squareBlob(t.files[0], 256); const url = await API.uploadPhoto(blob, "app-logo-" + i); row.querySelector(`[name=al${i}]`).value = url; row.querySelector(".lprev").innerHTML = `<img src="${url}" alt="">`; toast("Logo listo · tocá Guardar"); }
      catch (err) { toast(err.message || "No se pudo subir el logo"); }
      return;
    }
    if (t.matches("[data-photo2]") && t.files && t.files[0]) {
      const id = t.closest("[data-pid]").dataset.pid, base = P.products.find((x) => x.id === id);
      toast("Subiendo foto…");
      try { const blob = await squareBlob(t.files[0]); const url = await API.uploadPhoto(blob, id + "-2"); P.drafts[id] = { ...(P.drafts[id] || base), img2: url }; redrawCard(id); toast("2ª foto lista · tocá Guardar para publicarla"); }
      catch (err) { toast(err.message || "No se pudo subir la foto"); }
    }
    if (t.matches("[data-photo]") && t.files && t.files[0]) {
      const id = t.closest("[data-pid]").dataset.pid, base = P.products.find((x) => x.id === id);
      toast("Subiendo foto…");
      try { const blob = await squareBlob(t.files[0]); const url = await API.uploadPhoto(blob, id); P.drafts[id] = { ...(P.drafts[id] || base), img: url }; redrawCard(id); toast("Foto lista · tocá Guardar para publicarla"); }
      catch (err) { toast(err.message || "No se pudo subir la foto"); }
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-fradd]")) { const l = e.target.closest("form").querySelector(".frlist"); l.insertAdjacentHTML("beforeend", frRow(Date.now().toString(36))); l.lastElementChild.querySelector("[name^=fa]").focus(); return; }
    const x = e.target.closest("[data-frx]"); if (x) x.closest(".frrow").remove();
  });
  document.addEventListener("change", (e) => { if (e.target.matches(".frsw input")) e.target.nextElementSibling.textContent = e.target.checked ? "Activa" : "Apagada"; });
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-upx]"); if (!x) return; const n = x.dataset.upx, form = x.closest("form"); form.querySelector(`[name="${n}"]`).value = ""; const pv = form.querySelector(`[data-prevfor="${n}"]`); if (pv) pv.textContent = "—"; });
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-slx]"); if (!x) return; const r = x.closest(".slrow"), i = x.dataset.slx; ["si", "st", "sx"].forEach((p) => (r.querySelector(`[name=${p}${i}]`).value = "")); r.querySelector(".upprev").textContent = "Vacío · tocá Guardar"; x.remove(); });
  document.addEventListener("click", (e) => { const x = e.target.closest("[data-applogo-x]"); if (!x) return; const row = x.closest(".applogo"); row.querySelector(`[name=al${x.dataset.applogoX}]`).value = ""; row.querySelector(".lprev").textContent = "Sin logo"; x.remove(); });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-justx],[data-justgo]")) { setTimeout(() => { P.justDelivered = null; drawJust(); }, 300); } });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-votnew]"); if (!b) return; if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "¿Seguro? Tocá de nuevo y después Guardar"; return; } const f = b.closest("form"); f.dataset.newid = "v" + Date.now().toString(36); [0, 1, 2, 3, 4, 5].forEach((i) => (f.querySelector(`[name=oid${i}]`).value = "")); b.textContent = "Lista: tocá Guardar"; });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-msgreset]"); if (!b) return; const ta = b.closest("form").querySelector(`[name=m_${b.dataset.msgreset}]`); ta.value = window.SettoMSG.MSG[b.dataset.msgreset].texto; toast("Restaurado · tocá Guardar mensajes"); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-gix]"); if (!b) return; const r = b.closest(".slrow"); r.querySelector(`[name=gi${b.dataset.gix}]`).value = ""; r.querySelector(".upprev").textContent = "Sin imagen · tocá Guardar"; b.remove(); });
  document.addEventListener("submit", (e) => { if (e.target.matches("form[data-set]")) { e.preventDefault(); const b = e.target.querySelector(".ajbar .btn"); if (b) { b.disabled = true; b.textContent = "Guardando…"; } saveAjuste(e.target).finally(() => { const b2 = e.target.querySelector(".ajbar .btn"); if (b2) { b2.disabled = false; b2.textContent = "Guardar"; } }); } });
  // cambios sin guardar en Ajustes: se revisan al tocar algo y cada tanto (las fotos subidas cambian campos ocultos)
  ["input", "change", "click"].forEach((ev) => document.addEventListener(ev, () => setTimeout(ajCheck, 0)));
  setInterval(ajCheck, 1000);
  document.addEventListener("click", (e) => { if (e.target.closest("[data-ajundo]")) viewAjustes(); });
  // links a una sección de Ajustes (lista, volver, "Cambialo en Ajustes")
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#ajustes"]'); if (!a) return;
    e.preventDefault();
    const k = a.getAttribute("href").split("/")[1] || null;
    if (P.view === "ajustes" && P.ajSec === k) return;
    if (!ajSalir()) return;
    P.ajSec = k; go("ajustes", true); window.scrollTo(0, 0);
  });
  document.addEventListener("input", (e) => {
    if (!e.target.matches(".ajq")) return;
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".ajit").forEach((a) => (a.hidden = !!q && !a.dataset.q.includes(q)));
    document.querySelectorAll(".ajg").forEach((g) => (g.hidden = !!q && !g.querySelector(".ajit:not([hidden])")));
  });
  window.addEventListener("beforeunload", (e) => { if (P.view === "ajustes" && ajSucio()) { e.preventDefault(); e.returnValue = ""; } });

  /* =================== ARRANQUE =================== */
  (async () => {
    $("#demoBar").hidden = !API.DEMO;
    try { P.user = await API.session(); } catch (_) { P.user = null; }
    if (P.user) await afterLogin(); else drawLogin();
  })();
})();
