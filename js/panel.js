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
  const VISTAS = ["pedidos", "club", "carta", "resenas", "gift", "ajustes"]; // también sirven como #hash (lo usan los avisos push)
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
          ${[["pedidos", "Pedidos"], ["club", "Club"], ["carta", "Carta"], ["resenas", "Reseñas"], ["gift", "Gift cards"], ["ajustes", "Ajustes"]].map(([k, l]) => `<button class="ptab" role="tab" data-view="${k}" aria-selected="false">${l}${k === "pedidos" ? ' <span class="n" id="pendN" hidden>0</span>' : k === "resenas" ? ' <span class="n" id="resN" hidden>0</span>' : k === "gift" ? ' <span class="n" id="gcN" hidden>0</span>' : ""}</button>`).join("")}
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
    ({ pedidos: viewPedidos, club: viewClub, carta: viewCarta, resenas: viewResenas, gift: viewGift, ajustes: viewAjustes })[v]();
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
      const prods = (o.items || []).map((i, idx) => ({ i, idx })).filter(({ i }) => !["envio", "premio", "gift"].includes(i.id));
      return `<div class="faltabox"><b>¿Qué falta?</b><span class="hintp">Marcá lo que no tenés. Si te queda algo, bajá la cantidad que falta.</span>
        ${prods.map(({ i, idx }) => { const q = F.sel[idx]; return `<div class="frow"><label><input type="checkbox" data-fsel="${idx}" ${q ? "checked" : ""}> ${esc(i.nombre)}${i.size ? ` (${esc(i.size)})` : ""} <small>×${i.qty}</small></label>
          ${q && i.qty > 1 ? `<span class="stepper sm"><button data-fq="${idx}:-1" aria-label="Menos">−</button><span>faltan ${q}</span><button data-fq="${idx}:1" aria-label="Más">+</button></span>` : ""}</div>`; }).join("")}
        <input class="inp" data-fnota placeholder="Nota para el cliente (opcional)" maxlength="140" value="${esc(F.nota || "")}">
        <div class="acts"><button class="btn solid" data-fsend ${Object.keys(F.sel).length ? "" : "disabled"}>Pedir cambio al cliente</button><button class="linkbtn" data-fx>Cancelar</button></div></div>`;
    }
    if (!c) return o.status === "pendiente" ? `<button class="linkbtn" data-falta>¿Falta algo? Pedile un cambio al cliente</button>` : "";
    if (c.estado === "esperando") return `<div class="cambiobox wait"><b>⏳ Esperando que el cliente elija</b><span>Falta: ${esc(faltanTxt(c))}${c.nota ? ` · “${esc(c.nota)}”` : ""}</span>
        <div class="acts"><a class="btn solid" target="_blank" rel="noopener" href="https://wa.me/${esc(o.phone)}?text=${encodeURIComponent(cambioTxt(o))}">Mandar el aviso por WhatsApp</a><button class="linkbtn" data-fquitar>Quitar aviso (lo arreglamos por chat)</button></div></div>`;
    if (c.resolucion === "cancelado") return `<div class="cambiobox bad"><b>El cliente canceló el pedido</b><span>Faltaba: ${esc(faltanTxt(c))}</span></div>`;
    return `<div class="cambiobox ok"><b>✓ El cliente eligió el cambio</b>${(c.cambios || []).map((x) => `<span>${x.qty}× ${esc(x.de)} → ${x.a ? `<b>${esc(x.a)}</b>` : "<b>lo sacó</b>"}</span>`).join("")}
        ${c.total_antes != null && c.total_antes !== o.total ? `<span>Total: <s>${money(c.total_antes)}</s> → <b>${money(o.total)}</b>${o.total > c.total_antes ? " (paga la diferencia)" : " (cobrás menos)"}</span>` : ""}</div>`;
  }
  function resenaTxt(o) {
    const s = Number(o.sellos) || 0;
    return M.render("pedir_resena", { nombre: primerNombre(o), codigo: o.code, link: linkListo(o), sellos: s > 0 ? `Sumaste ${s === 1 ? "1 sello" : s + " sellos"} al Setto Club.` : "" }, P.settings);
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
  function estadoBox(o) {
    const et = o.etapa || "recibido", orden = ["recibido", "preparando", "listo"], idx = orden.indexOf(et), av = avisadoEn(o, et);
    const wa = `https://wa.me/${esc(o.phone)}?text=${encodeURIComponent(avisoTxt(o))}`;
    return `<div class="estado">
      <div class="estado-h"><b>Estado que ve el cliente</b><span class="hintp">Se actualiza solo en su celular</span></div>
      <div class="pasos">${orden.map((k, i) => `<button class="paso ${i < idx ? "done" : i === idx ? "now" : ""}" data-etapa="${k}" aria-pressed="${i === idx}"><i>${i < idx ? "✓" : i + 1}</i><span>${etapaNom(o, k)}</span></button>`).join("")}</div>
      ${av ? `<div class="aviso ok"><span class="aviso-t"><b>✓ Ya le avisaste por WhatsApp</b><small>“${esc(etapaNom(o, et))}” · ${ago(av)}</small></span><a class="linkbtn" target="_blank" rel="noopener" data-aviso="${et}" href="${wa}">Reenviar</a></div>`
        : `<div class="aviso pend"><span class="aviso-t"><b>💬 Falta avisarle: “${esc(etapaNom(o, et))}”</b><small>“${esc(avisoBase(o).slice(0, 70))}…”</small></span><a class="btn solid wa" target="_blank" rel="noopener" data-aviso="${et}" href="${wa}">Enviar WhatsApp</a></div>`}
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
    $("#view").innerHTML = `<h1 class="ph1">Gift cards</h1><p class="muted">Cuando te paguen, tocá <b>Pago recibido</b>: se activa, entra a la caja y te da el link para mandarle al comprador.</p>
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
            : g.estado === "activa" ? `<div class="acts"><a class="btn solid" target="_blank" rel="noopener" href="https://wa.me/${esc(g.phone)}?text=${encodeURIComponent(regaloTxt(g))}">Mandar link al comprador</a><button class="linkbtn" data-gcopy="${esc(linkRegalo(g))}">Copiar link</button>${g.saldo === g.monto ? '<button class="linkbtn warn" data-gann>Anular</button>' : ""}</div>` : ""}
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
      if (b.dataset.gact !== undefined) { await API.activateGiftcard(id, card.querySelector("[data-gcta]").value); toast("Activada · cargada en la caja"); P.gsub = "activa"; }
      else { if (!confirmar(b)) { b.disabled = false; return; } await API.annulGiftcard(id); toast("Anulada"); }
      viewGift();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  function confirmar(b) { if (b.dataset.armed) return true; b.dataset.armed = "1"; b.disabled = false; b.textContent = "¿Seguro? Tocá de nuevo"; return false; }

  /* =================== RESEÑAS =================== */
  async function viewResenas() {
    $("#view").innerHTML = `<h1 class="ph1">Reseñas</h1><p class="muted">Solo las publicadas se ven en la web (las que tienen texto o foto). Revisá la foto antes de publicar. Las deja quien recibió su pedido.</p><div id="rvList" class="pgrid" style="margin-top:18px"><p class="muted">Cargando…</p></div>`;
    try {
      const l = await API.listReviews(); P.reviews = l; contarResenas();
      $("#rvList").innerHTML = l.length ? l.map((r) => `<article class="pcard rvc ${r.estado}" data-rid="${r.id}">
          <div class="ohead"><span style="color:#f8a29a;letter-spacing:2px">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span><span class="ago">${ago(r.created_at)}</span><span class="st ${r.estado === "aprobada" ? "entregado" : r.estado === "oculta" ? "cancelado" : "pendiente"}">${r.estado}</span></div>
          ${r.foto ? `<a href="${esc(r.foto)}" target="_blank" rel="noopener"><img src="${esc(r.foto)}" alt="Foto de la reseña" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-top:6px"></a>` : ""}
          <p style="margin:6px 0">${r.texto ? esc(r.texto) : '<i class="muted">Sin texto (solo puntaje)</i>'}</p>
          ${r.instagram ? `<a class="linkbtn" href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>` : ""}
          <div class="who2"><b>${esc(r.nombre)}</b><span class="num">${esc(pretty(r.phone))}</span></div>
          <div class="acts">${r.estado !== "aprobada" ? '<button class="btn solid" data-rv="aprobada">Publicar</button>' : ""}${r.estado !== "oculta" ? '<button class="linkbtn warn" data-rv="oculta">Ocultar</button>' : ""}</div></article>`).join("") : '<p class="muted">Todavía no hay reseñas.</p>';
    } catch (e) { $("#rvList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  function contarResenas() { const n = (P.reviews || []).filter((r) => r.estado === "pendiente").length, el = $("#resN"); if (el) { el.textContent = n; el.hidden = !n; } }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rv]"); if (!b) return;
    const id = b.closest("[data-rid]").dataset.rid; b.disabled = true;
    try { await API.setReviewEstado(id, b.dataset.rv); toast(b.dataset.rv === "aprobada" ? "Publicada en la web" : "Oculta"); viewResenas(); } catch (err) { toast(err.message); b.disabled = false; }
  });
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
      <div class="justdel" id="justDel" hidden></div>
      <div class="pgrid" id="olist"><p class="muted">Cargando…</p></div>`;
    refreshOrders(false);
  }
  function drawJust() {
    const el = $("#justDel"); if (!el) return; const o = P.justDelivered;
    el.hidden = !o; if (!o) return;
    el.innerHTML = `<div><b>Entregado ${esc(o.code)} · ${esc((o.nombre || "").split(" ")[0])}</b><span>Mandale el link para que deje su reseña y vea sus sellos. El cobro y los mochis ya se cargaron en la <a class="tocaja" href="caja.html#movs">Caja</a>.</span></div>
      <a class="btn solid" target="_blank" rel="noopener" data-justgo href="https://wa.me/${esc(o.phone)}?text=${encodeURIComponent(resenaTxt(o))}">Pedir reseña por WhatsApp</a><button class="linkbtn" data-justx>Ahora no</button>`;
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
      const c = P.confirm[o.id] || (P.confirm[o.id] = { phone: pretty(o.phone), n: club.activo === false || prodTotal < (Number(club.minimo) || 0) ? 0 : (club.sellos_por_pedido ?? 1) });
      const env = o.modo === "envio";
      return `<article class="pcard" data-oid="${o.id}">
        <div class="ohead"><span class="ocode num">${esc(o.code)}</span><span class="ago">${ago(o.created_at)}</span><span class="st ${o.status}">${o.status}</span></div>
        <div class="who2"><b>${esc(o.nombre)}</b><span class="num">${esc(pretty(o.phone))}</span><a class="chat" href="https://wa.me/${esc(o.phone)}" target="_blank" rel="noopener">Abrir chat</a></div>
        <div class="acts"><span class="modo-tag ${env ? "env" : ""}">${env ? "Envío a domicilio" : "Retiro"}</span>${o.premio && o.status === "pendiente" ? `<span class="premio-tag">🎁 Completa la tarjeta</span>` : ""}${faltaAvisar(o) ? `<span class="falta-tag">💬 Falta avisar</span>` : ""}</div>
        ${env ? `<div class="dirbox"><b>${esc(o.direccion || "")}</b><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((o.direccion || "") + ", Mar del Plata")}" target="_blank" rel="noopener">Ver en Maps</a></div>` : ""}
        ${o.premio && o.status === "pendiente" ? `<div class="premiobox">Este pedido completa la tarjeta del Club. Premio elegido: <b>${esc(o.premio_txt || "a confirmar con el cliente")}</b>${/off/.test(o.premio_txt || "") ? " (ya descontado del total)" : ""}. Al tocar Entregado se canjea solo.</div>` : ""}
        <div class="meta"><span>${env ? "Entrega" : "Retiro"}: <b>${esc(o.retiro || "—")}</b></span><span>Pago: <b>${esc(o.pago || "—")}</b></span>${o.nota ? `<span>Nota: <b>${esc(o.nota)}</b></span>` : ""}</div>
        <div class="olines">${(o.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.nombre)}${i.size ? ` (${esc(i.size)})` : ""}${i.detalle ? `<small class="det">${esc(i.detalle)}</small>` : ""}</span><span class="num">${money(i.subtotal)}</span></div>`).join("")}</div>
        <div class="otot"><span>Total</span><span class="num">${money(o.total)}</span></div>
        ${cambioBox(o)}
        ${o.status === "pendiente" ? estadoBox(o) : ""}
        ${o.status === "pendiente" ? `<div class="confirm">
            <label>Número del chat de WhatsApp<input class="inp" data-cphone value="${esc(c.phone)}" inputmode="tel"></label>
            <div class="acts"><span style="font-size:.85rem;font-weight:600">Sellos a sumar</span><span class="stepper"><button data-cn="-1" aria-label="Menos">−</button><span>${c.n}</span><button data-cn="1" aria-label="Más">+</button></span></div>
            <div class="acts"><button class="btn solid" data-deliver>Entregado ✓</button><button class="linkbtn warn" data-cancel>${P.cancelArm === o.id ? "¿Seguro? Tocá de nuevo para cancelar" : "Cancelar pedido"}</button></div>
          </div>` : o.status === "entregado" ? `<p class="hintp">Entregado ${o.closed_at ? ago(o.closed_at) : ""} · ${o.sellos || 0} sello(s) sumado(s) a ${esc(pretty(o.phone))} · <a class="tocaja" href="caja.html#movs">Cobro en la Caja →</a></p>
            <a class="btn solid" style="margin-top:8px" target="_blank" rel="noopener" href="https://wa.me/${esc(o.phone)}?text=${encodeURIComponent(resenaTxt(o))}">Pedir reseña por WhatsApp</a>` : ""}
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
        ${c === "especial" ? espCfgHtml(E) : ""}
        <div class="pgrid">${byCat(c).map(cardP).join("")}</div>
        <button class="btn" data-addp="${c}" style="margin-top:14px">+ Agregar ${l === "Sets" ? "set" : l === "Mochis" ? "mochi" : l === "Dirty lattes" ? "dirty" : "sabor especial"}</button>
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
        <div class="checks">${si("cuenta", "Cuenta regresiva")}${si("esmerilar", "Esmerilar todas las fotos")}${si("ocultar_nombres", "Ocultar nombres (\"Sabor sorpresa\")", false)}${si("ocultar_precios", "Ocultar precios", false)}${si("barra", "Barra con cuenta regresiva arriba de toda la web")}${si("calendario", "Botón Agendar en el calendario")}${si("avisame", "Botón Avisame (notificación)")}</div>
        <span class="hintp">Al llegar la hora, la web destapa las fotos y habilita los pedidos sola, sin tocar nada. La barra de arriba muestra "¡Ya salió!" durante 48 hs.</span>
        <b class="dsub">Notificación de lanzamiento</b>
        <div class="row2">${t("push_titulo", "Título", "¡Salió " + (E.titulo || "la edición especial") + "!", 60)}${t("push_texto", "Texto", "Ya se puede pedir. Entrá antes de que se agote.", 140)}</div>
        <div class="checks">${si("avisar_auto", "Mandarla sola a la hora del lanzamiento")}</div>
        <div class="dropinfo" id="dropInfo"><span class="muted">Cargando avisos…</span></div>
      </div>
      <div class="row2">${t("chip", "Etiqueta de arriba (antes)", "Ej: Drop mensual · solo 3 días")}${t("chip_post", "Etiqueta de arriba (cuando sale)", "Ej: ¡Ya salió! Hasta agotar stock")}</div>
      <label>Texto debajo del título (antes)<textarea data-esp="intro">${esc(E.intro || "")}</textarea></label>
      <label>Texto debajo del título (cuando sale, opcional)<textarea data-esp="intro_post" placeholder="Si lo dejás vacío se usa el de arriba">${esc(E.intro_post || "")}</textarea></label>
      <div class="savebar"><span class="hintp">Los sabores del drop son los de abajo marcados como Visible.</span><button class="btn solid" data-saveesp>Guardar lanzamiento</button></div></div>`;
  }
  async function loadDropInfo() {
    const box = $("#dropInfo"); if (!box) return;
    try {
      const r = await API.dropAvisos();
      box.innerHTML = `<span>🔔 <b>${r.suscriptos}</b> ${r.suscriptos === 1 ? "persona anotada" : "personas anotadas"} para los avisos${r.avisado ? ` · ya se avisó este lanzamiento (${new Date(r.avisado).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })})` : ""}</span>
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
  function cardP(p0) {
    const p = draftOf(p0), c = p.categoria, dirty = !!P.drafts[p.id] || p._new, F = c === "especial" ? p.formato || "mochi" : c;
    const inp = (f, label, type = "text", extra = "") => `<label>${label}<input data-f="${f}" type="${type}" value="${esc(p[f] ?? "")}" ${extra}></label>`;
    const chk = (f, label) => `<label><input type="checkbox" data-f="${f}" ${p[f] ? "checked" : ""}> ${label}</label>`;
    const money3 = 'min="0" step="100" inputmode="numeric"';
    const opts = (cat, sel) => P.products.filter((x) => x.categoria === cat).map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.nombre)}</option>`).join("");
    return `<article class="pcard ${dirty ? "dirty" : ""} ${p.activo === false ? "oculto" : ""}" data-pid="${esc(p.id)}">
      <div class="ptop"><img src="${esc(p.img || "img/mochito-lie.png")}" alt=""><div><b>${esc(p.nombre)}</b><br>
        <label class="up">${p.img ? "Cambiar foto" : "Subir foto"}<input type="file" accept="image/*" data-photo></label>
        ${p.img && c === "especial" ? `<button class="linkbtn" data-nophoto>Quitar foto</button>` : ""}</div></div>
      ${inp("nombre", "Nombre")}
      ${c === "especial" ? `<label>Tipo<select data-f="formato">${[["mochi", "Mochi (precio por unidad)"], ["dirty", "Dirty / latte (12 y 16 oz, leche y extras)"], ["set", "Set (bebida + mochi, 12 y 16 oz)"]].map(([v, l]) => `<option value="${v}" ${F === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      ${c === "especial" && F === "set" ? `<label>Mochi que incluye (para el stock)<select data-f="set_mochi"><option value="">—</option>${opts("mochi", p.set_mochi)}${P.products.filter((x) => x.categoria === "especial" && (x.formato || "mochi") === "mochi").map((x) => `<option value="${esc(x.id)}" ${x.id === p.set_mochi ? "selected" : ""}>${esc(x.nombre)} (especial)</option>`).join("")}</select></label>` : ""}
      ${c === "set" ? `<div class="row2">${inp("codigo", "Código (ej: Set 04)")}${inp("tema", "Tema (ej: Matcha & cereza)")}</div>
        <div class="row2"><label>Bebida<select data-f="set_bebida">${opts("dirty", p.set_bebida)}</select></label><label>Mochi<select data-f="set_mochi">${opts("mochi", p.set_mochi)}</select></label></div>`
        : `<label>Descripción<textarea data-f="descripcion">${esc(p.descripcion || "")}</textarea></label>`}
      ${c === "set" || c === "dirty" || (c === "especial" && F !== "mochi") ? `<div class="row3">${inp("precio_12", "Precio 12 oz", "number", money3)}${inp("precio_16", "Precio 16 oz", "number", money3)}${inp("orden", "Orden", "number")}</div>`
        : `<div class="row2">${inp("precio", c === "especial" ? "Precio (0 = a confirmar)" : "Precio por unidad", "number", money3)}${inp("orden", "Orden", "number")}</div>`}
      ${c === "set" ? setCalc(p) : ""}
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
  async function fitBlob(file, max = 1600) { // achica sin recortar
    let src; try { src = await createImageBitmap(file); } catch (_) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
    const k = Math.min(1, max / Math.max(src.width, src.height)), cv = document.createElement("canvas");
    cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k); cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    const as = (t, q) => new Promise((r) => cv.toBlob(r, t, q)); let b = await as("image/webp", 0.84); if (!b || b.type !== "image/webp") b = await as("image/jpeg", 0.86); return b;
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
        <form class="pcard wide" data-set="hero"><b>Portada (slides del inicio)</b>
          <span class="hintp">Dos tipos de slide. <b>Foto + texto de la web</b>: subís la foto y escribís título y texto acá (el texto va siempre abajo). <b>Diseño propio</b>: imagen o video con el texto ya diseñado adentro. Medidas: <b>compu 2000 × 1000</b> (2:1) y <b>celular 1080 × 1350</b> (4:5); si no subís la de celular, se usa la de compu recortada. Video: corto (5–15 s), sin sonido, MP4, hasta 25 MB.</span>
          <span class="hintp">Los botones van debajo de la portada y cambian con cada slide. Dejá el texto vacío para no mostrar ese botón. Recomendado: 1 o 2 por slide, uno solo "Principal".</span>
          ${[0, 1, 2, 3, 4, 5].map((i) => { const x = ((S.hero || {}).slides || [])[i] || {}, tp = x.tipo === "media" ? "media" : "texto", bs = heroBotones(x);
            const prev = (n, v, vid) => `<span class="upprev ${vid ? "vid" : ""}" data-prevfor="${n}${i}">${v ? (vid ? `<video src="${esc(v)}" muted playsinline></video>` : `<img src="${esc(v)}" alt="">`) : "—"}</span>`;
            const up = (n, label, vid, max, cls = "") => `<div class="upbox ${cls}"><small>${label}</small>${prev(n, x[{ si: "img", sm: "img_m", sv: "video", sw: "video_m" }[n]], vid)}<input type="hidden" name="${n}${i}" value="${esc(x[{ si: "img", sm: "img_m", sv: "video", sw: "video_m" }[n]] || "")}">
              <span class="acts" style="gap:4px"><label class="linkbtn">${vid ? "Subir video" : "Subir"}<input type="file" accept="${vid ? "video/mp4,video/webm,video/quicktime" : "image/*"}" ${vid ? `data-upvid="${n}${i}"` : `data-upimg="${n}${i}" data-upmax="${max}"`} hidden></label><button type="button" class="linkbtn warn" data-upx="${n}${i}">✕</button></span></div>`;
            const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
            return `<div class="slrow2" data-tipo="${tp}"><div class="slhead"><b class="sln">Slide ${i + 1}</b>
              <select class="inp" name="sk${i}" data-sltipo aria-label="Tipo de slide ${i + 1}">${opt([["texto", "Foto + texto de la web"], ["media", "Diseño propio (imagen o video)"]], tp)}</select></div>
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
          <label>Aviso arriba de la web (opcional)<input class="inp" name="aviso" maxlength="70" value="${esc((S.tema || {}).aviso || "")}" placeholder="Ej: Edición Halloween · del 29/10 al 2/11"></label>
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
  const AJ_SEC = [
    { k: "contacto", g: "Pedidos", t: "Contacto", d: "El WhatsApp que recibe los pedidos, Instagram y tu link de links.", s: (S) => pretty(S.whatsapp) || "Sin WhatsApp" },
    { k: "retiro", g: "Pedidos", t: "Horarios de retiro", d: "Qué días y en qué franjas pueden elegir retirar.", s: (S) => { const r = S.retiro || {}; return (r.dias || []).length ? `${r.dias.length} días · ${(r.rangos || []).map((x) => x.join("–")).join(", ")}` : "Sin días"; } },
    { k: "envio", g: "Pedidos", t: "Envío a domicilio", d: "Si ofrecés envío, cuánto cuesta y cómo se paga.", s: (S) => ((S.envio || {}).activo ? ((S.envio || {}).costo ? "Activo · " + money((S.envio || {}).costo) : "Activo · a coordinar") : "Apagado") },
    { k: "pagos", g: "Pedidos", t: "Formas de pago", d: "Las opciones que ve el cliente al pedir.", s: (S) => `${(S.pagos || []).length} formas` },
    { k: "personalizacion", g: "Pedidos", t: "Personalizar bebidas", d: "Leches con recargo y lo que se puede sacar.", s: (S) => ((S.personalizacion || {}).activo !== false ? `Activo · ${((S.personalizacion || {}).leches || []).length} leches` : "Apagado") },
    { k: "stock_web", g: "Pedidos", t: "Stock en la web", d: "Cuántos mochis se ven disponibles y si se frena al llegar a 0.", s: (S) => ((S.stock_web || {}).activo !== false ? ((S.stock_web || {}).bloquear !== false ? "Visible · frena en 0" : "Visible · no frena") : "Oculto") },
    { k: "mensajes", g: "Pedidos", t: "Mensajes de WhatsApp", d: "Los textos que se arman solos para el cliente y para ustedes.", s: (S) => { const n = Object.keys(S.mensajes || {}).length; return n ? `${n} cambiados` : "Los originales"; } },
    { k: "club", g: "Clientes", t: "Setto Club", d: "Sellos, premio y pedido mínimo.", s: (S) => ((S.club || {}).activo !== false ? `${(S.club || {}).meta || 8} sellos` : "Apagado") },
    { k: "giftcards", g: "Clientes", t: "Gift cards", d: "Montos y diseños de las tarjetas de regalo.", s: (S) => ((S.giftcards || {}).activo !== false ? "A la venta" : "Apagado") },
    { k: "votacion", g: "Clientes", t: "Votación", d: "Una pregunta con opciones para que voten en la web.", s: (S) => ((S.votacion || {}).activo ? "Abierta" : "Apagada") },
    { k: "hero", g: "Web", t: "Portada", d: "Las slides del inicio y sus botones.", s: (S) => `${((S.hero || {}).slides || []).length} slides` },
    { k: "ventajas", g: "Web", t: "Pedir acá te conviene", d: "Los motivos para pedir por la web.", s: (S) => ((S.ventajas || {}).activo !== false ? `${((S.ventajas || {}).items || []).length} motivos` : "Oculto") },
    { k: "faq", g: "Web", t: "Preguntas frecuentes", d: "Las preguntas del final de la web.", s: (S) => `${(((S.faq || {}).items) || FAQ_DEF).length} preguntas` },
    { k: "apps", g: "Web", t: "Apps de delivery", d: "Links y logos de PedidosYa, Rappi y Uber Eats.", s: (S) => `${(S.apps || []).length} apps` },
    { k: "ubicacion", g: "Web", t: "Ubicación", d: "El mapa público de la web.", s: (S) => ((S.ubicacion || {}).activo ? "Visible" : "Oculto") },
    { k: "stickers", g: "Web", t: "Stickers de WhatsApp", d: "El link al pack de Mochito.", s: (S) => ((S.stickers || {}).activo ? "Visibles" : "Ocultos") },
    { k: "tema", g: "Web", t: "Decoración de temporada", d: "Colores y aviso especial, por ejemplo Halloween.", s: (S) => ((S.tema || {}).nombre ? (S.tema || {}).nombre : "Ninguna") },
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
      if (k === "hero") {
        const slides = [0, 1, 2, 3, 4, 5].map((i) => {
          const tipo = f["sk" + i] === "media" ? "media" : "texto", g = (n) => (f[n + i] || "").trim();
          const botones = [0, 1, 2].map((j) => ({ texto: (f[`bt${i}_${j}`] || "").trim(), link: f[`bl${i}_${j}`] || "#sets", estilo: f[`be${i}_${j}`] === "secundario" ? "secundario" : "principal" })).filter((b) => b.texto);
          const x = { tipo, img: g("si"), img_m: g("sm"), botones };
          if (tipo === "media") Object.assign(x, { video: g("sv"), video_m: g("sw"), alt: g("st") });
          else Object.assign(x, { titulo: g("sti"), texto: g("stx"), ajuste: f["sa" + i] === "recorte" ? "recorte" : "foto", pos: f["sp" + i] || "centro", alt: g("sti") });
          return x;
        }).filter((x) => x.img || x.img_m || x.video || x.video_m);
        if (!slides.length) throw new Error("Subí al menos una imagen o video");
        if (slides.some((x) => x.tipo === "texto" && !x.titulo)) throw new Error("A las slides de foto + texto les falta el título");
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
      if (k === "ubicacion") await API.saveSetting("ubicacion", { activo: !!f.activo, mapa: (f.mapa || "").trim(), titulo: (f.titulo || "").trim() || "Dónde estamos", texto: (f.texto || "").trim(), zoom: +f.zoom || 15 });
      if (k === "tema") await API.saveSetting("tema", { nombre: f.nombre || "", aviso: (f.aviso || "").trim() });
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
        try { await API.setEtapa(id, b.dataset.etapa); if (o) o.etapa = b.dataset.etapa; drawOrders(); toast(o && avisadoEn(o, b.dataset.etapa) ? "Estado actualizado" : "Estado actualizado · ahora mandale el WhatsApp"); }
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
      if (b.dataset.cn) { c.n = Math.max(0, Math.min(10, c.n + +b.dataset.cn)); drawOrders(); }
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
        cuenta: on("cuenta"), esmerilar: on("esmerilar"), ocultar_nombres: on("ocultar_nombres"), ocultar_precios: on("ocultar_precios"), barra: on("barra"), calendario: on("calendario"), avisame: on("avisame"),
        avisar_auto: on("avisar_auto"), push_titulo: v("push_titulo"), push_texto: v("push_texto"),
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
        if (d.set_mochi === "") d.set_mochi = null;
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
    if (t.matches("[data-fnota]")) { const F = P.falta[t.closest("[data-oid]").dataset.oid]; if (F) F.nota = t.value; return; }
    const pc = t.closest("[data-pid]"); if (!pc || !t.dataset.f) return;
    const id = pc.dataset.pid, base = P.products.find((x) => x.id === id);
    const d = P.drafts[id] || (P.drafts[id] = { ...base });
    d[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value;
    pc.classList.add("dirty");
    if (!pc.querySelector("[data-undo]")) { const sp = pc.querySelector("[data-savep]").parentElement; sp.insertAdjacentHTML("afterbegin", '<button class="linkbtn" data-undo>Descartar</button> '); }
    if (d.categoria === "set") { const c = pc.querySelector("[data-calc]"); if (c) c.outerHTML = setCalc(d); }
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
      try { const blob = await fitBlob(t.files[0], max); const url = await API.uploadPhoto(blob, "web-" + name); form.querySelector(`[name="${name}"]`).value = url;
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
    if (t.matches("[data-photo]") && t.files && t.files[0]) {
      const id = t.closest("[data-pid]").dataset.pid, base = P.products.find((x) => x.id === id);
      toast("Subiendo foto…");
      try { const blob = await squareBlob(t.files[0]); const url = await API.uploadPhoto(blob, id); P.drafts[id] = { ...(P.drafts[id] || base), img: url }; redrawCard(id); toast("Foto lista · tocá Guardar para publicarla"); }
      catch (err) { toast(err.message || "No se pudo subir la foto"); }
    }
  });
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
