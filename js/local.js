/*
  Local de Setto: tickear comandas en el mostrador, mandarlas a la barra y cobrar.
  - Los precios que se ven acá son solo para mostrar: la base los vuelve a calcular (local_crear, migración 058).
  - Cobrar crea la entrada en la Caja (categoría "Venta en el local") y descuenta los mochis del stock.
  - Vistas: #tickear (caja del mostrador), #barra (pantalla de pedidos en vivo) y #hoy (comandas del día).
  - Categoría "Local": productos que no están en la web (facturas, etc., tabla local_productos, migración 062)
    y "Otro" para cargar uno suelto con nombre y precio a mano.
  - Setto Club en el mostrador (migración 065): celular opcional en la comanda. Al quedar cobrada suma el sello sola
    (mismas reglas que la web); si se anula, lo descuenta. El premio se canjea a mano con "Canjear" (redeem_reward).
*/
(function () {
  const cfg = window.SETTO_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TZ = "America/Argentina/Buenos_Aires";

  if (!cfg.supabaseUrl || !window.supabase) {
    app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Local</h1><p>El local necesita la base de Supabase configurada en <b>js/config.js</b>. No funciona en modo demo.</p></div></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  /* ---------- formatos ---------- */
  const money = (n) => (Number(n) < 0 ? "−$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("es-AR");
  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const mins = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const clean = (m) => String(m || "").replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");
  const fail = (r) => { if (r.error) throw new Error(clean(r.error.message)); return r.data; };
  const parseMoney = (s) => { const t = String(s || "").replace(/[^\d]/g, ""); return t ? parseInt(t, 10) : NaN; };
  let toastT;
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); };
  // fotos chicas: en setto.com.ar y en los previews pasan por el optimizador de Vercel (igual que la web)
  const OPT = /(^|\.)setto\.com\.ar$|\.vercel\.app$/.test(location.hostname);
  const IMG = (u) => (OPT && /\.(webp|png|jpe?g)$/i.test(u) && (u.indexOf(cfg.supabaseUrl + "/storage/v1/object/public/") === 0 || /^\/?img\//.test(u)) ? "/_vercel/image?url=" + encodeURIComponent(/^img\//.test(u) ? "/" + u : u) + "&w=256&q=75" : u);
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

  /* ---------- estado ---------- */
  const PAGOS = [["efectivo", "Efectivo"], ["qr", "QR Mercado Pago"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"]];
  const CATS = [["set", "Sets"], ["dirty", "Dirty"], ["mochi", "Mochis"], ["especial", "Especial"], ["promo", "Promos"], ["local", "Local"]];
  const S = {
    me: (() => { try { return localStorage.getItem("setto-caja-yo") || ""; } catch (_) { return ""; } })(),
    view: ["tickear", "barra", "hoy"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "tickear",
    socios: [], prods: [], pers: {}, comandas: [], lprods: [], falta062: false, editLocal: false,
    cat: ls.get("setto-local-cat", "set"),
    ticket: ls.get("setto-local-ticket", []), // borrador: sobrevive a un refresco sin querer
    nombre: "", nota: "", desc: 0, verDesc: false,
    tel: "", card: null, wa: false, falta065: false, // Club: celular de la comanda que se está tickeando y su tarjeta
    sending: false, vistas: new Set(),
    print: Object.assign({ auto: false, cliente: false, ancho: 80 }, ls.get("setto-local-print", {})),
  };
  const guardarTicket = () => ls.set("setto-local-ticket", S.ticket);

  /* ---------- productos (mismas reglas que la web: js/site.js) ---------- */
  const on = (p) => p.activo !== false;
  const find = (id) => S.prods.find((p) => p.id === id);
  const fmtP = (p) => (p.categoria === "especial" ? p.formato || "mochi" : p.categoria);
  const esBebida = (p) => ["set", "dirty"].includes(fmtP(p));
  const esPromo = (p) => p.categoria === "promo";
  const promoCant = (p) => Math.max(2, Math.min(20, Math.round(Number(p.promo_cant) || 5)));
  const leches = () => (S.pers.activo === false ? [] : S.pers.leches || []);
  const sinOpts = () => (S.pers.activo === false ? [] : S.pers.sin || []);
  const lechePrecio = (n) => { const l = leches().find((x) => x.nombre === n); return l ? Number(l.precio) || 0 : 0; };
  const bebOpts = (p) => (p.categoria === "especial" && fmtP(p) === "set" && !p.set_bebida ? S.prods.filter((x) => on(x) && !x.agotado && x.categoria === "especial" && fmtP(x) === "dirty" && Number(x.precio_12) > 0) : []);
  const mochisSabores = () => S.prods.filter((m) => on(m) && !m.agotado && m.categoria === "mochi" && Number(m.precio) > 0);
  const precioBase = (p, sz) => (esBebida(p) ? Number(sz === "16 oz" ? p.precio_16 : p.precio_12) : Number(p.precio)) || 0;
  const nombreDe = (p) => (esBebida(p) || esPromo(p) ? p.nombre.trim() : "Mochi " + p.nombre.trim());
  const sinTxt = (x) => String(x).replace(/^\s*sin\s+/i, "");
  const vendible = (p) => on(p) && !p.agotado && (esBebida(p) ? Number(p.precio_12) > 0 || Number(p.precio_16) > 0 : Number(p.precio) > 0);
  /* líneas propias del local: tipo "lp" (guardado en local_productos) o "libre" (nombre y precio a mano) */
  const findLp = (id) => S.lprods.find((x) => x.id === id);
  const precioLinea = (l) => { if (l.tipo === "lp") return Number((findLp(l.lp) || l).precio) || 0; if (l.tipo === "libre") return Number(l.precio) || 0; const p = find(l.id); return p ? precioBase(p, l.size) + (esBebida(p) ? lechePrecio(l.leche) : 0) : 0; };
  const nombreLinea = (l) => (l.tipo === "lp" ? (findLp(l.lp) || l).nombre : l.tipo === "libre" ? l.nombre : nombreDe(find(l.id)));
  const detalleLinea = (l) => {
    if (l.tipo) return "";
    const p = find(l.id); if (!p) return "";
    if (esPromo(p)) { const c = new Map(); (l.mochis || []).forEach((id) => c.set(id, (c.get(id) || 0) + 1)); return [...c].map(([id, n]) => ((find(id) || {}).nombre || "Mochi").trim() + (n > 1 ? " ×" + n : "")).join(" · "); }
    const pri = (leches()[0] || {}).nombre;
    return [l.bebida && find(l.bebida) ? "Bebida: " + find(l.bebida).nombre.trim() : "", l.leche && (lechePrecio(l.leche) > 0 || l.leche !== pri) ? l.leche : "", ...(l.sin || [])].filter(Boolean).join(" · ");
  };
  const subtotal = () => S.ticket.reduce((a, l) => a + precioLinea(l) * l.qty, 0);
  const total = () => Math.max(0, subtotal() - (S.desc || 0));
  const unidades = () => S.ticket.reduce((a, l) => a + l.qty, 0);
  const keyDe = (l) => [l.id, l.tipo === "libre" ? l.nombre + "·" + l.precio : "", l.size || "", l.leche || "", (l.sin || []).join(","), l.bebida || "", (l.mochis || []).join(","), l.nota || ""].join("|");

  /* ---------- carga ---------- */
  async function loadBase() {
    const [prods, pers, socios, lprods] = await Promise.all([
      sb.from("products").select("id,categoria,nombre,formato,precio,precio_12,precio_16,set_bebida,set_mochi,promo_cant,activo,agotado,orden,img").eq("activo", true).order("orden"),
      sb.from("settings").select("value").eq("key", "personalizacion").maybeSingle(),
      sb.from("caja_socios").select("nombre,activo").order("orden"),
      sb.from("local_productos").select("id,nombre,precio,orden").eq("activo", true).order("orden"),
    ]);
    S.falta062 = !!lprods.error; S.lprods = lprods.error ? [] : lprods.data || [];
    S.prods = fail(prods) || []; S.pers = (fail(pers) || {}).value || {}; S.socios = (fail(socios) || []).filter((s) => s.activo);
    // el borrador guardado se limpia si cambió la carta
    S.ticket = S.ticket.filter((l) => { if (l.qty <= 0) return false; if (l.tipo === "libre") return true; if (l.tipo === "lp") return !!findLp(l.lp); const p = find(l.id); return p && vendible(p); }); guardarTicket();
  }
  async function loadComandas() {
    const r = await sb.from("comandas").select("*").eq("dia", hoy()).order("numero", { ascending: false }).limit(400);
    if (r.error && /comandas/.test(r.error.message || "")) throw new Error("FALTA_058");
    const prev = new Set(S.comandas.map((c) => c.id)), primera = !S.comandas.length && !S.cargoUnaVez;
    S.comandas = fail(r) || []; S.cargoUnaVez = true;
    const nuevas = S.comandas.filter((c) => c.estado === "barra" && !prev.has(c.id));
    if (!primera && nuevas.length && S.view === "barra") { ding(); nuevas.forEach((c) => S.vistas.add(c.id)); }
  }
  let reT;
  function softReload() { clearTimeout(reT); reT = setTimeout(async () => { try { await loadComandas(); render(); } catch (_) {} }, 250); }

  /* ---------- login ---------- */
  function drawLogin(msg) {
    app.innerHTML = `<div class="loginwrap"><form class="loginbox" id="login">
      <img class="l" src="img/logo.svg" alt="Setto"><h1 class="ph1">Local</h1>
      <label class="f">Email<input id="lEmail" type="email" autocomplete="username" required></label>
      <label class="f">Contraseña<input id="lPass" type="password" autocomplete="current-password" required></label>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn solid big" type="submit">Entrar</button>
      <p class="hintp">Es el mismo usuario del panel y de la caja.</p></form></div>`;
    $("#login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
      if (r.error) return drawLogin(r.error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : r.error.message);
      start();
    });
  }
  async function start() {
    app.innerHTML = `<div class="loading">Abriendo el local…</div>`;
    const u = (await sb.auth.getSession()).data.session;
    if (!u) return drawLogin();
    const st = await sb.from("staff").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (st.error || !st.data) { app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Usuario sin permiso</h1><p>Este usuario no está habilitado como equipo de Setto.</p></div></div>`; return; }
    try { await loadBase(); await loadComandas(); }
    catch (e) {
      app.innerHTML = `<div class="loginwrap"><div class="loginbox"><h1 class="ph1">Falta activar el local</h1><p>La base todavía no tiene las comandas. Corré <b>supabase/migrations/058_local_comandas.sql</b> en el SQL Editor de Supabase.</p><p class="err">${esc(e.message === "FALTA_058" ? "No existe la tabla comandas" : e.message)}</p></div></div>`;
      return;
    }
    drawShell(); render();
    if (!S.socios.some((s) => s.nombre === S.me)) whoSheet(true);
    sb.channel("local-live").on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, softReload).subscribe();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) softReload(); });
    setInterval(() => { if (S.view !== "tickear" && !document.hidden) softReload(); }, 20000); // respaldo si se corta el tiempo real
    setInterval(() => { if (S.view === "barra" && !document.hidden) render(); }, 30000); // los minutos de espera
  }

  /* ---------- estructura ---------- */
  function drawShell() {
    app.innerHTML = `<header class="cbar lbar"><div class="wrap">
        <a class="logo" href="index.html" title="Ver el sitio"><img src="img/logo.svg" alt="Setto"></a>
        <nav class="appsw" aria-label="Cambiar de app"><a href="panel.html">Pedidos</a><a href="caja.html">Caja</a><a href="local.html" aria-current="page">Local</a></nav>
        <nav class="lviews" role="tablist">${[["tickear", "Tickear"], ["barra", "Barra"], ["hoy", "Hoy"]].map(([k, l]) => `<button role="tab" data-go="${k}">${l}<span class="n" data-n="${k}" hidden></span></button>`).join("")}</nav>
        <span class="sp"></span>
        <button class="icbtn" data-cfg title="Impresión" aria-label="Configurar impresión">🖨</button>
        <button class="mebtn" data-who><i>${esc((S.me || "?")[0])}</i><span>${esc(S.me || "¿Quién sos?")}</span></button>
      </div></header>
      <main id="view"></main>`;
  }
  function render() {
    if (!$("#view")) return;
    document.body.dataset.view = S.view;
    document.querySelectorAll(".lviews [data-go]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.go === S.view)));
    const enBarra = S.comandas.filter((c) => c.estado === "barra").length, sinCobrar = S.comandas.filter((c) => c.estado !== "anulada" && !c.pagado).length;
    const nb = $('[data-n="barra"]'), nh = $('[data-n="hoy"]');
    if (nb) { nb.textContent = enBarra; nb.hidden = !enBarra; }
    if (nh) { nh.textContent = sinCobrar; nh.hidden = !sinCobrar; nh.title = `${sinCobrar} sin cobrar`; }
    const mb = $("[data-who]"); if (mb) mb.innerHTML = `<i>${esc((S.me || "?")[0])}</i><span>${esc(S.me || "¿Quién sos?")}</span>`;
    ({ tickear: vTickear, barra: vBarra, hoy: vHoy })[S.view]();
  }
  function go(v) { S.view = v; history.replaceState(null, "", "#" + v); if (v === "barra") S.comandas.forEach((c) => S.vistas.add(c.id)); render(); window.scrollTo(0, 0); if (v !== "tickear") softReload(); }

  /* ---------- TICKEAR ---------- */
  function tileHtml(p) {
    const pr = esBebida(p) ? Number(p.precio_12) || Number(p.precio_16) : Number(p.precio);
    const q = S.ticket.filter((l) => l.id === p.id).reduce((a, l) => a + l.qty, 0);
    const img = IMG(p.img || "img/mochito-cup.png");
    return `<button class="tile${p.agotado ? " off" : ""}" data-p="${esc(p.id)}" ${vendible(p) ? "" : "disabled"}>
      <span class="ti"><img src="${esc(img)}" alt="" loading="lazy" decoding="async"></span>
      <span class="tn">${esc(p.nombre.trim())}</span>
      <span class="tp num">${p.agotado ? "Agotado" : (esBebida(p) ? "desde " : "") + money(pr)}</span>
      ${q ? `<span class="tq num">${q}</span>` : ""}</button>`;
  }
  function vTickear() {
    const hay = CATS.filter(([k]) => k === "local" || S.prods.some((p) => on(p) && p.categoria === k));
    if (!hay.some(([k]) => k === S.cat) && hay.length) S.cat = hay[0][0];
    const lista = S.prods.filter((p) => on(p) && p.categoria === S.cat);
    $("#view").innerHTML = `<div class="pos">
      <section class="pos-l">
        <div class="cats" role="tablist">${hay.map(([k, l]) => `<button role="tab" data-cat="${k}" aria-selected="${k === S.cat}">${l}</button>`).join("")}</div>
        ${S.cat === "local" ? localTilesHtml() : `<div class="tiles">${lista.map(tileHtml).join("") || `<p class="muted">No hay productos activos en esta categoría.</p>`}</div>`}
      </section>
      <aside class="pos-r" id="tk">${ticketHtml()}</aside>
    </div>
    <button class="tk-mini" data-tkopen ${S.ticket.length ? "" : "hidden"}><span><b class="num">${unidades()}</b> ${unidades() === 1 ? "producto" : "productos"}</span><b class="num">${money(total())}</b><span>Ver comanda ›</span></button>`;
  }
  function lpTileHtml(x) {
    const q = S.ticket.filter((l) => l.tipo === "lp" && l.lp === x.id).reduce((a, l) => a + l.qty, 0);
    return `<button class="tile lp${S.editLocal ? " ed" : ""}" data-lp="${esc(x.id)}"><span class="tn">${esc(x.nombre)}</span><span class="tp num">${money(x.precio)}</span>${S.editLocal ? `<span class="tq">✎</span>` : q ? `<span class="tq num">${q}</span>` : ""}</button>`;
  }
  function localTilesHtml() {
    if (S.falta062) return `<p class="muted">Para cargar productos que no están en la web falta correr <b>supabase/migrations/062_local_productos_propios.sql</b> en el SQL Editor de Supabase.</p>`;
    return `<div class="tiles">${S.lprods.map(lpTileHtml).join("")}<button class="tile lp otro" data-otro><span class="tn">＋ Otro producto</span><span class="tp">Nombre y precio a mano</span></button></div>
      <p class="lpnote">${S.lprods.length ? `<button class="linkbtn" data-lpedit>${S.editLocal ? "Listo" : "Editar precios u ocultar"}</button>` : `Facturas, medialunas, agua… lo que no está en la web. Cargalo una vez con “Otro” y queda acá.`}</p>`;
  }
  function ticketHtml() {
    const n = (S.comandas.filter((c) => c.dia === hoy()).reduce((a, c) => Math.max(a, c.numero), 0) || 0) + 1;
    if (!S.ticket.length) return `<div class="tk-h"><h2>Comanda <span class="num">#${n}</span></h2><button class="x tk-x" data-tkclose aria-label="Cerrar">✕</button></div><div class="tk-empty"><img src="img/mochito-cup.png" alt=""><p>Tocá un producto para empezar.</p><small>Los mochis se suman directo. Las bebidas abren sus opciones.</small></div>`;
    return `<div class="tk-h"><h2>Comanda <span class="num">#${n}</span></h2><button class="linkbtn" data-tkclear>Vaciar</button><button class="x tk-x" data-tkclose aria-label="Cerrar">✕</button></div>
      <ul class="tk-lines">${S.ticket.map((l, i) => { const det = detalleLinea(l); return `<li>
        <button class="tl-main" data-edit="${i}"><b>${esc(nombreLinea(l))}${l.size ? ` <small>${esc(l.size)}</small>` : ""}</b>${det ? `<span>${esc(det)}</span>` : ""}${l.nota ? `<em>“${esc(l.nota)}”</em>` : ""}</button>
        <span class="stepper"><button data-q="${i}:-1" aria-label="Uno menos">−</button><b class="num">${l.qty}</b><button data-q="${i}:1" aria-label="Uno más">+</button></span>
        <span class="tl-p num">${money(precioLinea(l) * l.qty)}</span></li>`; }).join("")}</ul>
      <div class="tk-f">
        <div class="tk-in"><input class="inp" id="tkNombre" placeholder="Nombre (opcional)" maxlength="40" value="${esc(S.nombre)}" autocomplete="off"><input class="inp" id="tkNota" placeholder="Nota para la barra" maxlength="200" value="${esc(S.nota)}" autocomplete="off"></div>
        <div class="tk-club"><input class="inp" id="tkTel" type="tel" inputmode="tel" placeholder="Celular · Setto Club (opcional)" maxlength="20" value="${esc(S.tel)}" autocomplete="off"><div id="tkCard">${clubHtml()}</div></div>
        ${S.verDesc ? `<label class="tk-desc">Descuento $<input class="inp num" id="tkDesc" inputmode="numeric" value="${S.desc || ""}" placeholder="0"><button class="linkbtn" data-nodesc>Quitar</button></label>` : `<button class="linkbtn" data-desc>+ Descuento</button>`}
        <div class="tk-tot">${S.desc ? `<span>Subtotal <s class="num">${money(subtotal())}</s></span>` : ""}<span>Total</span><b class="num" id="tkTotal">${money(total())}</b></div>
        <div class="tk-acts"><button class="btn solid big" data-cobrar ${S.sending ? "disabled" : ""}>Cobrar <span class="num">${money(total())}</span></button>
        <button class="btn" data-sincobrar ${S.sending ? "disabled" : ""}>Mandar a barra sin cobrar</button></div>
      </div>`;
  }
  /* ---------- Setto Club en el mostrador ---------- */
  const telDig = (t) => String(t || "").replace(/\D/g, "");
  const telOk = (t) => telDig(t).length >= 10;
  const ult4 = (ph) => "···" + String(ph || "").slice(-4);
  const puntos = (n, meta) => `<span class="cl-dots" aria-hidden="true">${Array.from({ length: meta }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
  const falta065Html = `<p class="cl-h">Para sumar sellos desde el local falta correr <b>supabase/migrations/065_local_club.sql</b> en el SQL Editor de Supabase.</p>`;
  const es065 = (m) => /local_club|comandas_club|column .*phone/i.test(m || "") && /does not exist|no existe|schema cache/i.test(m || "");
  function clubHtml() {
    if (S.falta065) return falta065Html;
    if (!S.tel.trim()) return `<p class="cl-h">Con el celular suma 1 sello en su tarjeta del Club.</p>`;
    if (!telOk(S.tel)) return `<p class="cl-h">Seguí escribiendo el número (con característica).</p>`;
    const k = S.card;
    if (!k) return `<p class="cl-h">Buscando la tarjeta…</p>`;
    if (k.error) return `<p class="cl-h err">${esc(k.error)}</p>`;
    if (!k.activo) return `<p class="cl-h">El Club está apagado en Ajustes: esta compra no suma sellos.</p>`;
    const meta = k.meta || 8, completa = k.sellos >= meta;
    const suma = total() >= (k.minimo || 0);
    const wa = k.whatsapp ? `<span class="cl-ok">Recibe novedades por WhatsApp ✓</span>` : `<label class="tg sm"><input type="checkbox" id="tkWa" ${S.wa ? "checked" : ""}> Me dijo que quiere novedades por WhatsApp</label>`;
    return `<div class="cl-card${completa ? " full" : ""}">
        <div class="cl-top"><b>${k.existe ? esc(k.nombre || "Cliente del Club") : "Nuevo en el Club"}</b><span class="num">${k.sellos}/${meta}</span></div>
        ${puntos(Math.min(k.sellos, meta), meta)}
        ${completa ? `<div class="cl-premio"><span>Completó la tarjeta${k.premio ? `: <b>${esc(k.premio)}</b>` : ""}</span><button class="btn sm solid" data-canje="${esc(k.phone)}">Canjear premio</button></div>`
          : `<span class="cl-h">${suma ? `Con esta compra queda en ${Math.min(meta, k.sellos + 1)}/${meta}${k.sellos + 1 >= meta ? " y completa la tarjeta" : ""}.` : `No suma sello: la compra mínima es ${money(k.minimo)}.`}</span>`}
        ${wa}</div>`;
  }
  let telT, telSeq = 0;
  function buscarTarjeta() {
    clearTimeout(telT); S.card = null;
    const el = $("#tkCard"); if (el) el.innerHTML = clubHtml();
    if (!telOk(S.tel) || S.falta065) return;
    const seq = ++telSeq, tel = S.tel;
    telT = setTimeout(async () => {
      const r = await sb.rpc("local_club_ver", { p_phone: tel });
      if (seq !== telSeq) return;
      if (r.error) { if (es065(r.error.message)) S.falta065 = true; else S.card = { error: clean(r.error.message) }; }
      else {
        S.card = r.data;
        // si el cliente ya tiene nombre en el Club y la comanda no, se completa solo
        if (r.data.nombre && !S.nombre.trim()) { S.nombre = r.data.nombre; const n = $("#tkNombre"); if (n) n.value = S.nombre; }
      }
      const c = $("#tkCard"); if (c) c.innerHTML = clubHtml();
    }, 350);
  }
  // anota el celular en la comanda; la base suma el sello si ya está cobrada (o cuando se cobre)
  async function anotarClub(c, tel, wa) {
    const r = await sb.rpc("local_club", { p_id: c.id, p_phone: tel, p_whatsapp: !!wa });
    if (r.error) { if (es065(r.error.message)) S.falta065 = true; throw new Error(S.falta065 ? "falta correr la migración 065" : clean(r.error.message)); }
    S.comandas = S.comandas.map((x) => (x.id === r.data.comanda.id ? r.data.comanda : x));
    return r.data;
  }
  function premioSheet(k) {
    openSheet(`<div class="sh"><h3>¡Completó la tarjeta!</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <p>${esc(k.nombre || "El cliente")} (${ult4(k.phone)}) tiene <b class="num">${k.sellos}/${k.meta}</b> sellos.${k.premio ? ` Premio: <b>${esc(k.premio)}</b>.` : ""}</p>
      <p class="muted">Si se lo das ahora, tocá Canjear: se descuentan ${k.meta} sellos de la tarjeta. Si lo prefiere para la próxima, queda guardado.</p>
      <div class="oadd"><button class="btn solid big" data-canje="${esc(k.phone)}">Canjear premio</button></div>
      <button class="linkbtn" data-close>Lo usa la próxima</button>`);
  }
  async function canjear(phone, b) {
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Canjear? Tocá de nuevo"; return; }
    b.disabled = true;
    const r = await sb.rpc("redeem_reward", { p_phone: phone });
    if (r.error) { b.disabled = false; return toast(clean(r.error.message)); }
    toast(`Premio canjeado · le quedan ${r.data.sellos} sello${r.data.sellos === 1 ? "" : "s"}`);
    if (!$("#sheet").hidden && $("#sheet [data-canje]")) closeSheet();
    if (S.card && S.card.phone === phone) {
      S.card = Object.assign({}, S.card, { sellos: r.data.sellos, canjes: r.data.canjes });
      // si el premio va en esta comanda, queda a mano el descuento
      if (S.ticket.length && !S.verDesc) { S.verDesc = true; redrawTicket(); toast("Premio canjeado. Si va en esta comanda, cargalo como descuento"); }
      const c = $("#tkCard"); if (c) c.innerHTML = clubHtml();
    }
  }

  function redrawTicket() {
    const tk = $("#tk"); if (!tk) return;
    const a = document.activeElement && document.activeElement.id; tk.innerHTML = ticketHtml();
    if (a && $("#" + a)) { const el = $("#" + a); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} }
    const mini = $("[data-tkopen]"); if (mini) { mini.hidden = !S.ticket.length; mini.innerHTML = `<span><b class="num">${unidades()}</b> ${unidades() === 1 ? "producto" : "productos"}</span><b class="num">${money(total())}</b><span>Ver comanda ›</span>`; }
    document.querySelectorAll(".tiles [data-p]").forEach((b) => { const p = find(b.dataset.p); if (p) b.outerHTML = tileHtml(p); });
    document.querySelectorAll(".tiles [data-lp]").forEach((b) => { const x = findLp(b.dataset.lp); if (x) b.outerHTML = lpTileHtml(x); });
    if (!S.ticket.length) document.body.classList.remove("tk-on");
  }
  function sumar(l) {
    const k = keyDe(l), ex = S.ticket.find((x) => keyDe(x) === k);
    if (ex) ex.qty = Math.min(50, ex.qty + l.qty); else S.ticket.push(l);
    guardarTicket(); redrawTicket();
    const b = document.querySelector(l.tipo === "lp" ? `.tiles [data-lp="${CSS.escape(l.lp)}"]` : `.tiles [data-p="${CSS.escape(l.id)}"]`); if (b) { b.classList.add("pop"); setTimeout(() => b.classList.remove("pop"), 260); }
  }

  /* hoja de opciones: misma personalización que la web (leche, sacar ingredientes, bebida del set, sabores de la box) + nota */
  let O = null;
  function abrirOpciones(p, idx) {
    const l = idx != null ? S.ticket[idx] : null;
    O = { p, idx, qty: l ? l.qty : 1, size: l ? l.size : "12 oz", leche: l ? l.leche || "" : (leches()[0] || {}).nombre || "", sin: l ? [...(l.sin || [])] : [], bebida: l ? l.bebida || "" : bebOpts(p).length === 1 ? bebOpts(p)[0].id : "", mochis: l ? [...(l.mochis || [])] : [], nota: l ? l.nota || "" : "" };
    drawOpciones();
  }
  function drawOpciones() {
    const { p } = O, beb = esBebida(p), cant = esPromo(p) ? promoCant(p) : 0;
    const box = esPromo(p) ? `<div class="og"><span class="eyebrow">Sabores · ${O.mochis.length}/${cant}</span><div class="boxp">${mochisSabores().map((m) => { const n = O.mochis.filter((x) => x === m.id).length; return `<div class="bx"><span>${esc(m.nombre.trim())}</span><span class="stepper"><button data-bx="${esc(m.id)}:-1" ${n ? "" : "disabled"} aria-label="Uno menos">−</button><b class="num">${n}</b><button data-bx="${esc(m.id)}:1" ${O.mochis.length >= cant ? "disabled" : ""} aria-label="Uno más">+</button></span></div>`; }).join("")}</div></div>` : "";
    const bebSel = bebOpts(p).length ? `<div class="og"><span class="eyebrow">Bebida del set</span><div class="chips">${bebOpts(p).map((x) => `<button data-obeb="${esc(x.id)}" aria-pressed="${x.id === O.bebida}">${esc(x.nombre.trim())}</button>`).join("")}</div></div>` : "";
    const lech = beb && leches().length ? `<div class="og"><span class="eyebrow">Leche</span><div class="chips">${leches().map((x) => `<button data-oleche="${esc(x.nombre)}" aria-pressed="${x.nombre === O.leche}">${esc(x.nombre)}${Number(x.precio) > 0 ? ` <span class="num">+${money(x.precio)}</span>` : ""}</button>`).join("")}</div></div>` : "";
    const sin = beb && sinOpts().length ? `<div class="og"><span class="eyebrow">Sacar</span><div class="chips quitar">${sinOpts().map((x) => `<button data-osin="${esc(x)}" aria-pressed="${O.sin.includes(x)}"><i aria-hidden="true">${O.sin.includes(x) ? "✕" : "−"}</i>${esc(sinTxt(x))}</button>`).join("")}</div></div>` : "";
    const faltaBox = esPromo(p) && O.mochis.length !== cant, faltaBeb = bebOpts(p).length && !O.bebida;
    const precioCon = (sz) => (precioBase(p, sz) + (beb ? lechePrecio(O.leche) : 0)) * O.qty;
    const editando = O.idx != null;
    const btns = beb
      ? `<div class="oadd sz">${["12 oz", "16 oz"].filter((sz) => precioBase(p, sz) > 0).map((sz) => `<button class="btn ${editando && O.size !== sz ? "" : "solid"} big" data-oadd="${sz}" ${faltaBeb ? "disabled" : ""}><b>${sz}</b><span class="num">${money(precioCon(sz))}</span></button>`).join("")}</div>`
      : `<div class="oadd"><button class="btn solid big" data-oadd="" ${faltaBox ? "disabled" : ""}>${faltaBox ? `Elegí ${cant - O.mochis.length} más` : `${editando ? "Guardar" : "Agregar"} · <span class="num">${money(precioCon(""))}</span>`}</button></div>`;
    openSheet(`<div class="sh"><h3>${esc(nombreDe(p))}</h3><span class="stepper big"><button data-oq="-1" aria-label="Uno menos">−</button><b class="num">${O.qty}</b><button data-oq="1" aria-label="Uno más">+</button></span><button class="x" data-close aria-label="Cerrar">✕</button></div>
      ${bebSel}${box}${lech}${sin}
      <div class="og"><input class="inp" id="oNota" placeholder="Nota para la barra (ej. poco hielo)" maxlength="80" value="${esc(O.nota)}" autocomplete="off"></div>
      ${beb && faltaBeb ? `<p class="hintp">Elegí la bebida del set.</p>` : ""}
      ${btns}${editando ? `<button class="linkbtn danger" data-odel>Sacar de la comanda</button>` : ""}`);
  }
  function confirmarOpciones(sz) {
    const { p } = O, nota = ($("#oNota") ? $("#oNota").value : O.nota).trim().slice(0, 80);
    const l = { id: p.id, qty: O.qty, size: esBebida(p) ? sz : "", leche: esBebida(p) ? O.leche : "", sin: esBebida(p) ? sinOpts().filter((x) => O.sin.includes(x)) : [], bebida: bebOpts(p).length ? O.bebida : "", mochis: esPromo(p) ? [...O.mochis].sort((a, b) => S.prods.findIndex((x) => x.id === a) - S.prods.findIndex((x) => x.id === b)) : [], nota };
    if (O.idx != null) S.ticket.splice(O.idx, 1);
    closeSheet(); sumar(l);
  }

  /* hoja "Otro producto": nombre y precio a mano. Si se tilda "guardar", queda en la categoría Local para la próxima.
     También sirve para editar una línea propia del local (cantidad y nota) y, en modo edición, el producto guardado. */
  let L = null;
  function abrirLibre(idx, lp) {
    const l = idx != null ? S.ticket[idx] : null, x = lp || (l && l.tipo === "lp" ? findLp(l.lp) : null);
    L = { idx, lp: x ? x.id : null, gestion: !!lp, qty: l ? l.qty : 1, nombre: x ? x.nombre : l ? l.nombre : "", precio: x ? x.precio : l ? l.precio : "", nota: l ? l.nota || "" : "", guardar: !S.falta062 && !l };
    drawLibre();
  }
  function drawLibre() {
    const fijo = L.lp && !L.gestion; // una línea de un producto guardado: el precio se cambia desde "Editar precios"
    const titulo = L.gestion ? "Producto del local" : L.idx != null ? "Editar" : "Otro producto";
    openSheet(`<div class="sh"><h3>${titulo}</h3>${L.gestion ? "" : `<span class="stepper big"><button data-lq="-1" aria-label="Uno menos">−</button><b class="num">${L.qty}</b><button data-lq="1" aria-label="Uno más">+</button></span>`}<button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div class="og lpf"><label class="f">Nombre<input id="lNom" maxlength="40" placeholder="Ej. Medialuna de manteca" value="${esc(L.nombre)}" autocomplete="off" ${fijo ? "readonly" : ""}></label>
        <label class="f">Precio<input id="lPre" class="num" inputmode="numeric" placeholder="$" value="${L.precio ? esc(String(L.precio)) : ""}" autocomplete="off" ${fijo ? "readonly" : ""}></label></div>
      ${L.gestion ? "" : `<div class="og"><input class="inp" id="lNota" placeholder="Nota para la barra (opcional)" maxlength="80" value="${esc(L.nota)}" autocomplete="off"></div>`}
      ${!L.gestion && !L.lp && !S.falta062 ? `<label class="tg"><input type="checkbox" id="lGuardar" ${L.guardar ? "checked" : ""}> Guardarlo en “Local” para la próxima</label>` : ""}
      ${fijo ? `<p class="hintp">El precio de los productos guardados se cambia con “Editar precios u ocultar”.</p>` : ""}
      <div class="oadd"><button class="btn solid big" data-lok>${L.gestion ? "Guardar" : `${L.idx != null ? "Guardar" : "Agregar"} · <span class="num" id="lTot">${money((parseMoney(L.precio) || 0) * L.qty)}</span>`}</button></div>
      ${L.gestion ? `<button class="linkbtn danger" data-lhide>Ocultar de la lista</button>` : L.idx != null ? `<button class="linkbtn danger" data-ldel>Sacar de la comanda</button>` : ""}`);
    if (!L.nombre && $("#lNom")) $("#lNom").focus();
  }
  async function confirmarLibre() {
    const nombre = ($("#lNom").value || "").replace(/\s+/g, " ").trim().slice(0, 40), precio = parseMoney($("#lPre").value);
    if (!nombre) { toast("Poné el nombre"); return $("#lNom").focus(); }
    if (!(precio >= 1 && precio <= 10000000)) { toast("Poné el precio"); return $("#lPre").focus(); }
    const nota = $("#lNota") ? $("#lNota").value.trim().slice(0, 80) : "";
    const guardar = L.gestion || (!L.lp && $("#lGuardar") && $("#lGuardar").checked);
    let lp = L.lp && !L.gestion ? findLp(L.lp) : null;
    if (guardar) {
      const ok = $("[data-lok]"); if (ok) ok.disabled = true;
      try {
        lp = fail(await sb.rpc("local_producto_guardar", { p_id: L.gestion ? L.lp : null, p_nombre: nombre, p_precio: precio, p_activo: true }));
        S.lprods = [...S.lprods.filter((x) => x.id !== lp.id), lp].sort((a, b) => a.orden - b.orden);
      } catch (e) { if (ok) ok.disabled = false; return toast(e.message); }
      if (L.gestion) { closeSheet(); toast(`${lp.nombre}: ${money(lp.precio)}`); return vTickear(); }
    }
    const l = lp ? { id: "lp:" + lp.id, tipo: "lp", lp: lp.id, nombre: lp.nombre, precio: lp.precio, qty: L.qty, nota } : { id: "libre", tipo: "libre", nombre, precio, qty: L.qty, nota };
    if (L.idx != null) S.ticket.splice(L.idx, 1);
    closeSheet(); sumar(l); if (guardar && S.cat === "local") vTickear();
  }

  /* ---------- cobrar ---------- */
  function lineasParaBase() { return S.ticket.map((l) => l.tipo === "lp" ? { tipo: "lp", lp: l.lp, qty: l.qty, nota: l.nota || null } : l.tipo === "libre" ? { tipo: "libre", nombre: l.nombre, precio: l.precio, qty: l.qty, nota: l.nota || null } : ({ id: l.id, qty: l.qty, size: l.size || null, leche: l.leche || null, sin: l.sin || [], bebida: l.bebida || null, mochis: l.mochis && l.mochis.length ? l.mochis : null, nota: l.nota || null })); }
  const needMe = () => { if (!S.me) { whoSheet(); toast("Primero elegí quién sos"); return false; } return true; };
  let C = null; // estado de la hoja de cobro
  function cobrarSheet(comanda) {
    // comanda = null → la comanda que se está tickeando; si no, una ya mandada que quedó sin cobrar
    const tot = comanda ? comanda.total : total();
    C = { comanda, total: tot, pago: ls.get("setto-local-pago", "efectivo"), con: null };
    drawCobro();
  }
  function drawCobro() {
    const { total: tot, pago, con } = C;
    const sug = [...new Set([tot, Math.ceil(tot / 1000) * 1000, Math.ceil(tot / 5000) * 5000, Math.ceil(tot / 10000) * 10000, Math.ceil(tot / 20000) * 20000].filter((x) => x >= tot))].slice(0, 5);
    const vuelto = con != null && con >= tot ? con - tot : null;
    openSheet(`<div class="sh"><h3>Cobrar ${C.comanda ? `#${C.comanda.numero}` : ""}</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div class="cob-tot num">${money(tot)}</div>
      <div class="og"><span class="eyebrow">¿Cómo paga?</span><div class="pagos">${PAGOS.map(([k, l]) => `<button data-pago="${k}" aria-pressed="${k === pago}">${l}</button>`).join("")}</div></div>
      ${pago === "efectivo" && tot > 0 ? `<div class="og"><span class="eyebrow">Paga con (opcional)</span><div class="chips">${sug.map((v) => `<button data-con="${v}" aria-pressed="${con === v}">${v === tot ? "Justo" : money(v)}</button>`).join("")}</div>
        <input class="inp num" id="cCon" inputmode="numeric" placeholder="Otro monto" value="${con != null && !sug.includes(con) ? con : ""}">
        ${vuelto != null ? `<p class="vuelto">Vuelto <b class="num">${money(vuelto)}</b></p>` : con != null ? `<p class="err">No alcanza</p>` : ""}</div>` : ""}
      <button class="btn solid big wide" data-cobok ${S.sending || (con != null && con < tot) ? "disabled" : ""}>${S.sending ? "Guardando…" : C.comanda ? "Cobrar" : "Cobrar y mandar a barra"}</button>`);
  }
  async function enviar(pago, con) {
    if (S.sending || !S.ticket.length || !needMe()) return;
    S.sending = true; redrawTicket(); if (C) drawCobro();
    try {
      let c = fail(await sb.rpc("local_crear", { p_items: lineasParaBase(), p_nombre: S.nombre.trim() || null, p_nota: S.nota.trim() || null, p_descuento: S.desc || 0, p_pago: pago || null, p_paga_con: pago === "efectivo" && con != null ? con : null, p_quien: S.me }));
      if (pago) ls.set("setto-local-pago", pago);
      // Club: la comanda ya salió; si falla el sello, no se frena nada y se puede sumar después desde "Hoy"
      let club = null, clubErr = "";
      if (telOk(S.tel) && !S.falta065) { try { club = await anotarClub(c, S.tel, S.wa); c = club.comanda; } catch (err) { clubErr = err.message; } }
      S.ticket = []; S.nombre = ""; S.nota = ""; S.desc = 0; S.verDesc = false; S.tel = ""; S.card = null; S.wa = false; guardarTicket();
      S.comandas = [c, ...S.comandas.filter((x) => x.id !== c.id)];
      closeSheet(); document.body.classList.remove("tk-on");
      S.sending = false; render();
      toast(`Comanda #${c.numero} a la barra${pago ? " · cobrada" : " · sin cobrar"}${pago === "efectivo" && con != null && con > c.total ? ` · vuelto ${money(con - c.total)}` : ""}${club ? (c.sellos ? ` · +${c.sellos} sello (${club.tarjeta.sellos}/${club.tarjeta.meta})` : c.pagado ? "" : " · el sello se suma al cobrar") : ""}`);
      if (clubErr) setTimeout(() => toast(`No se sumó al Club: ${clubErr}. Probá desde “Hoy”.`), 2700);
      if (S.print.auto) imprimir(c, S.print.cliente && c.pagado ? "ambos" : "comanda");
      if (club && c.sellos && club.tarjeta.sellos >= club.tarjeta.meta) premioSheet(club.tarjeta);
    } catch (e) { S.sending = false; redrawTicket(); if (C && $("#sheet:not([hidden])")) drawCobro(); toast(e.message); }
  }
  async function cobrarExistente(pago, con) {
    if (S.sending || !needMe()) return;
    S.sending = true; drawCobro();
    try {
      const c = fail(await sb.rpc("local_cobrar", { p_id: C.comanda.id, p_pago: pago, p_paga_con: pago === "efectivo" && con != null ? con : null, p_quien: S.me }));
      ls.set("setto-local-pago", pago); S.sending = false; closeSheet();
      S.comandas = S.comandas.map((x) => (x.id === c.id ? c : x)); render();
      toast(`#${c.numero} cobrada${pago === "efectivo" && con != null && con > c.total ? ` · vuelto ${money(con - c.total)}` : ""}${c.sellos ? ` · +${c.sellos} sello al Club` : ""}`);
      if (S.print.auto && S.print.cliente) imprimir(c, "cliente");
    } catch (e) { S.sending = false; drawCobro(); toast(e.message); }
  }

  /* ---------- BARRA ---------- */
  function cardBarra(c) {
    const m = mins(c.created_at), nueva = !S.vistas.has(c.id);
    return `<article class="bc ${c.estado}${m >= 10 && c.estado === "barra" ? " tarde" : ""}${nueva ? " nueva" : ""}">
      <div class="bh"><b class="bn num">#${c.numero}</b>${c.nombre ? `<span class="bnom">${esc(c.nombre)}</span>` : ""}<span class="bt num" title="${hora(c.created_at)}">${m < 1 ? "recién" : m + " min"}</span></div>
      ${c.pagado ? "" : `<span class="tag sc">Sin cobrar</span>`}
      <ul>${(c.items || []).map((i) => `<li><b class="num">${i.qty}×</b><div><b>${esc(i.nombre)}${i.size ? ` <small>${esc(i.size)}</small>` : ""}</b>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ""}${i.nota ? `<em>“${esc(i.nota)}”</em>` : ""}</div></li>`).join("")}</ul>
      ${c.nota ? `<p class="bnota">“${esc(c.nota)}”</p>` : ""}
      <div class="bf">${c.estado === "barra" ? `<button class="btn solid big" data-est="${c.id}:lista">Lista ✓</button>` : `<button class="btn solid" data-est="${c.id}:entregada">Entregada</button><button class="linkbtn" data-est="${c.id}:barra">Volver a preparar</button>`}
        <button class="icbtn" data-reimp="${c.id}" title="Imprimir comanda" aria-label="Imprimir comanda #${c.numero}">🖨</button></div>
    </article>`;
  }
  function vBarra() {
    const prep = S.comandas.filter((c) => c.estado === "barra").sort((a, b) => a.numero - b.numero);
    const listas = S.comandas.filter((c) => c.estado === "lista").sort((a, b) => a.numero - b.numero);
    $("#view").innerHTML = `<div class="barra">
      <div class="bhead"><h1 class="h1">Barra</h1><span class="muted">${prep.length ? `${prep.length} en preparación` : "Nada para preparar"}</span><span class="sp"></span><button class="btn sm" data-fs>Pantalla completa</button></div>
      <div class="bgrid">${prep.map(cardBarra).join("") || `<div class="bvacio"><img src="img/mochito-cup.png" alt=""><p>Cuando el mostrador mande una comanda, aparece acá al instante.</p></div>`}</div>
      ${listas.length ? `<h2 class="h2">Listas para entregar <small>${listas.length}</small></h2><div class="bgrid listas">${listas.map(cardBarra).join("")}</div>` : ""}
    </div>`;
    prep.concat(listas).forEach((c) => S.vistas.add(c.id));
  }

  /* ---------- HOY ---------- */
  function vHoy() {
    const act = S.comandas.filter((c) => c.estado !== "anulada");
    const cob = act.filter((c) => c.pagado), sin = act.filter((c) => !c.pagado);
    const por = (cta) => cob.filter((c) => c.cuenta_id === cta).reduce((a, c) => a + c.total, 0);
    $("#view").innerHTML = `<div class="wrap hoy">
      <h1 class="h1">Hoy en el local</h1>
      <div class="kp"><div><span>Cobrado</span><b class="num">${money(cob.reduce((a, c) => a + c.total, 0))}</b><small>${cob.length} comanda${cob.length === 1 ? "" : "s"}</small></div>
        <div><span>Efectivo</span><b class="num">${money(por("efectivo"))}</b></div><div><span>Mercado Pago</span><b class="num">${money(por("mp"))}</b></div>
        <div class="${sin.length ? "warn" : ""}"><span>Sin cobrar</span><b class="num">${money(sin.reduce((a, c) => a + c.total, 0))}</b><small>${sin.length} comanda${sin.length === 1 ? "" : "s"}</small></div></div>
      <ul class="hlist">${S.comandas.map((c) => `<li class="${c.estado === "anulada" ? "anul" : ""}"><button data-com="${c.id}">
          <b class="num">#${c.numero}</b><span class="hn">${esc(c.nombre || "Sin nombre")}<small>${hora(c.created_at)} · ${(c.items || []).reduce((a, i) => a + i.qty, 0)} prod. · ${esc(c.registro)}</small></span>
          <span class="he e-${c.estado}">${{ barra: "En barra", lista: "Lista", entregada: "Entregada", anulada: "Anulada" }[c.estado]}</span>
          <span class="hp"><b class="num">${money(c.total)}</b><small>${c.estado === "anulada" ? "" : c.pagado ? esc(c.pago || "") : "Sin cobrar"}</small></span></button>
          ${c.estado !== "anulada" && !c.pagado ? `<button class="btn sm solid" data-cobrarc="${c.id}">Cobrar</button>` : ""}</li>`).join("") || `<li class="muted" style="padding:16px">Todavía no hay comandas hoy.</li>`}</ul>
      <p class="kpinote">Lo cobrado ya está en la Caja como “Venta en el local”. Si anulás una comanda cobrada, la entrada de la Caja se anula y los mochis vuelven al stock.</p>
    </div>`;
  }
  function comandaSheet(id) {
    const c = S.comandas.find((x) => x.id === id); if (!c) return;
    openSheet(`<div class="sh"><h3>Comanda #${c.numero}${c.nombre ? " · " + esc(c.nombre) : ""}</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <p class="muted">${hora(c.created_at)} · cargó ${esc(c.registro)}${c.estado === "anulada" ? ` · anulada por ${esc(c.anulada_por || "")}: ${esc(c.anulada_motivo || "")}` : ""}</p>
      <ul class="tk-lines ro">${(c.items || []).map((i) => `<li><span class="tl-main"><b>${i.qty}× ${esc(i.nombre)}${i.size ? ` <small>${esc(i.size)}</small>` : ""}</b>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ""}${i.nota ? `<em>“${esc(i.nota)}”</em>` : ""}</span><span class="tl-p num">${money(i.subtotal)}</span></li>`).join("")}
        ${c.descuento ? `<li><span class="tl-main"><b>Descuento</b></span><span class="tl-p num">−${money(c.descuento)}</span></li>` : ""}</ul>
      ${c.nota ? `<p class="bnota">“${esc(c.nota)}”</p>` : ""}
      <div class="tk-tot"><span>Total</span><b class="num">${money(c.total)}</b></div>
      ${clubComandaHtml(c)}
      <p>${c.pagado ? `Cobrada · <b>${esc(c.pago || "")}</b>${c.paga_con ? ` · pagó con ${money(c.paga_con)}, vuelto ${money(c.paga_con - c.total)}` : ""}` : c.estado === "anulada" ? "" : "<b>Sin cobrar</b>"}</p>
      ${c.estado === "anulada" ? "" : `<div class="og"><div class="chips">
        ${c.pagado ? "" : `<button data-cobrarc="${c.id}">Cobrar</button>`}
        ${c.pagado ? `<button data-cambpago="${c.id}">Cambiar forma de pago</button>` : ""}
        <button data-reimp="${c.id}">Imprimir comanda</button>
        <button data-reimpcli="${c.id}">Ticket del cliente</button>
        ${c.estado !== "entregada" ? `<button data-est="${c.id}:entregada">Marcar entregada</button>` : `<button data-est="${c.id}:lista">Volver a “lista”</button>`}
      </div></div>
      <details class="anul"><summary>Anular comanda</summary><input class="inp" id="anMot" maxlength="140" placeholder="¿Por qué? (ej. se cargó dos veces)"><button class="btn sm" data-anular="${c.id}">Anular${c.pagado ? " y sacar de la caja" : ""}</button></details>`}`);
  }
  function clubComandaHtml(c) {
    if (c.phone) return `<p class="cl-line">Setto Club · <b class="num">${ult4(c.phone)}</b> · ${c.sellos ? `sumó ${c.sellos} sello${c.sellos === 1 ? "" : "s"}` : c.estado === "anulada" ? "sin sellos (anulada)" : c.pagado ? "no sumó sello (compra mínima o Club apagado)" : "suma el sello al cobrar"}</p>`;
    if (c.estado === "anulada") return "";
    if (S.falta065) return falta065Html;
    return `<div class="og cl-add"><span class="eyebrow">Setto Club</span><div class="cl-row"><input class="inp" id="cTel" type="tel" inputmode="tel" placeholder="Celular del cliente" maxlength="20" autocomplete="off"><button class="btn sm solid" data-clubc="${c.id}">Sumar</button></div>
      <label class="tg sm"><input type="checkbox" id="cWa"> Me dijo que quiere novedades por WhatsApp</label></div>`;
  }
  function cambiarPagoSheet(id) {
    const c = S.comandas.find((x) => x.id === id); if (!c) return;
    openSheet(`<div class="sh"><h3>#${c.numero} · ¿Cómo pagó?</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <p class="muted">Ahora figura: ${esc(c.pago || "—")}. Si cambia de efectivo a Mercado Pago (o al revés), la entrada se mueve de cuenta en la Caja.</p>
      <div class="pagos">${PAGOS.map(([k, l]) => `<button data-cpago="${c.id}:${k}" aria-pressed="${l === c.pago}">${l}</button>`).join("")}</div>`);
  }

  /* ---------- impresión (ticket interno de 58/80 mm, con el diálogo del navegador) ---------- */
  function ticketComandaHtml(c) {
    return `<div class="pt"><div class="pt-n">#${c.numero}</div>${c.nombre ? `<div class="pt-nom">${esc(c.nombre)}</div>` : ""}<div class="pt-m">${hora(c.created_at)} · ${esc(c.registro)}${c.pagado ? "" : " · SIN COBRAR"}</div>
      <hr>${(c.items || []).map((i) => `<div class="pt-i"><b>${i.qty}× ${esc(i.nombre)}${i.size ? " " + esc(i.size) : ""}</b>${i.detalle ? `<div>${esc(i.detalle)}</div>` : ""}${i.nota ? `<div>» ${esc(i.nota)}</div>` : ""}</div>`).join("")}
      ${c.nota ? `<hr><div class="pt-i">» ${esc(c.nota)}</div>` : ""}<hr></div>`;
  }
  function ticketClienteHtml(c) {
    return `<div class="pt"><div class="pt-logo">SETTO</div><div class="pt-m">${new Date(c.created_at).toLocaleDateString("es-AR", { timeZone: TZ })} ${hora(c.created_at)} · Comanda #${c.numero}</div><hr>
      ${(c.items || []).map((i) => `<div class="pt-r"><span>${i.qty}× ${esc(i.nombre)}${i.size ? " " + esc(i.size) : ""}</span><span>${money(i.subtotal)}</span></div>`).join("")}
      ${c.descuento ? `<div class="pt-r"><span>Descuento</span><span>−${money(c.descuento)}</span></div>` : ""}<hr>
      <div class="pt-r pt-t"><span>TOTAL</span><span>${money(c.total)}</span></div>${c.pagado ? `<div class="pt-r"><span>${esc(c.pago || "")}</span><span></span></div>` : ""}
      ${c.paga_con ? `<div class="pt-r"><span>Pagó con</span><span>${money(c.paga_con)}</span></div><div class="pt-r"><span>Vuelto</span><span>${money(c.paga_con - c.total)}</span></div>` : ""}
      ${c.sellos ? `<hr><div class="pt-m">Setto Club: sumaste ${c.sellos} sello${c.sellos === 1 ? "" : "s"} · ${ult4(c.phone)}</div>` : ""}
      <hr><div class="pt-m">No válido como factura · ¡Gracias!</div></div>`;
  }
  function imprimir(c, que) {
    const w = S.print.ancho === 58 ? 58 : 80;
    $("#printPage").textContent = `@page{size:${w}mm auto;margin:0}#print{width:${w}mm}`;
    $("#print").innerHTML = que === "cliente" ? ticketClienteHtml(c) : que === "ambos" ? ticketComandaHtml(c) + `<div class="pt-cut"></div>` + ticketClienteHtml(c) : ticketComandaHtml(c);
    setTimeout(() => { try { window.print(); } catch (_) {} }, 30);
  }
  function cfgSheet() {
    const P = S.print;
    openSheet(`<div class="sh"><h3>Impresión en este dispositivo</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <label class="tg"><input type="checkbox" data-pcfg="auto" ${P.auto ? "checked" : ""}> Imprimir la comanda al mandarla a la barra</label>
      <label class="tg"><input type="checkbox" data-pcfg="cliente" ${P.cliente ? "checked" : ""}> Imprimir también el ticket del cliente (con precios)</label>
      <div class="og"><span class="eyebrow">Ancho del papel</span><div class="chips">${[58, 80].map((w) => `<button data-pancho="${w}" aria-pressed="${P.ancho === w}">${w} mm</button>`).join("")}</div></div>
      <button class="btn" data-ptest>Imprimir una prueba</button>
      <p class="hintp">Usa la impresora que tenga configurada este dispositivo. Para que salga sin el cuadro de “Imprimir”, en una compu se abre Chrome con <code>--kiosk-printing</code> y la térmica como predeterminada.</p>`);
  }

  /* ---------- hojas ---------- */
  function openSheet(html) { const sh = $("#sheet"); sh.innerHTML = `<div class="grab"></div>${html}`; sh.hidden = false; $("#sheetBg").hidden = false; document.body.classList.add("sheet-on"); }
  function closeSheet() { $("#sheet").hidden = true; $("#sheetBg").hidden = true; $("#sheet").innerHTML = ""; document.body.classList.remove("sheet-on"); O = null; C = null; L = null; }
  function whoSheet(first) {
    openSheet(`<div class="sh"><h3>¿Quién atiende?</h3>${first ? "" : '<button class="x" data-close aria-label="Cerrar">✕</button>'}</div>
      <p class="muted">Queda guardado en este dispositivo (es el mismo de la Caja). Las comandas y los cobros figuran a tu nombre.</p>
      <div class="who-grid">${S.socios.map((s) => `<button data-iam="${esc(s.nombre)}" aria-pressed="${S.me === s.nombre}"><i>${esc(s.nombre[0])}</i>${esc(s.nombre)}</button>`).join("")}</div>`);
  }
  let actx;
  function ding() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.25, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.5); o.start(); o.stop(actx.currentTime + 0.5); } catch (_) {} }

  /* ---------- eventos ---------- */
  async function rpc(nombre, args, ok) {
    try { const c = fail(await sb.rpc(nombre, args)); S.comandas = S.comandas.map((x) => (x.id === c.id ? c : x)); if (ok) toast(ok(c)); return c; }
    catch (e) { toast(e.message); return null; }
  }
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "tkNombre") S.nombre = t.value;
    else if (t.id === "tkNota") S.nota = t.value;
    else if (t.id === "tkTel") { const antes = telDig(S.tel); S.tel = t.value; if (telDig(S.tel) !== antes) { S.wa = false; buscarTarjeta(); } }
    else if (t.id === "tkDesc") { const v = parseMoney(t.value); S.desc = isNaN(v) ? 0 : Math.min(v, subtotal()); const tt = $("#tkTotal"); if (tt) tt.textContent = money(total()); const cb = $("[data-cobrar]"); if (cb) cb.innerHTML = `Cobrar <span class="num">${money(total())}</span>`; const kc = $("#tkCard"); if (kc && S.card) kc.innerHTML = clubHtml(); }
    else if (t.id === "oNota" && O) O.nota = t.value;
    else if (L && ["lNom", "lPre", "lNota"].includes(t.id)) { L[{ lNom: "nombre", lPre: "precio", lNota: "nota" }[t.id]] = t.value; const tt = $("#lTot"); if (tt) tt.textContent = money((parseMoney(L.precio) || 0) * L.qty); }
    else if (t.id === "cCon" && C) { const v = parseMoney(t.value); C.con = isNaN(v) ? null : v; const pos = t.selectionStart; drawCobro(); const n = $("#cCon"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "tkWa") { S.wa = e.target.checked; return; }
    const k = e.target.dataset && e.target.dataset.pcfg; if (!k) return;
    S.print[k] = e.target.checked; ls.set("setto-local-print", S.print);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet").hidden && $("#sheet [data-close]")) closeSheet();
    if (e.key === "Enter" && ["lNom", "lPre", "lNota"].includes(e.target.id)) { e.preventDefault(); const b = $("[data-lok]"); if (b && !b.disabled) b.click(); return; }
    if (e.key === "Enter" && e.target.id === "cTel") { e.preventDefault(); const b = $("[data-clubc]"); if (b && !b.disabled) b.click(); return; }
    if (e.key === "Enter" && e.target.id === "cCon") { e.preventDefault(); const b = $("[data-cobok]"); if (b && !b.disabled) b.click(); }
  });
  document.addEventListener("click", async (e) => {
    if (e.target.id === "sheetBg") { if ($("#sheet [data-close]")) closeSheet(); return; }
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.close !== undefined) return closeSheet();
    if (d.go) return go(d.go);
    if (d.who !== undefined) return whoSheet();
    if (d.iam) { S.me = d.iam; localStorage.setItem("setto-caja-yo", S.me); closeSheet(); render(); toast(`Hola, ${S.me}`); return; }
    if (d.cfg !== undefined) return cfgSheet();
    if (d.pancho) { S.print.ancho = +d.pancho; ls.set("setto-local-print", S.print); return cfgSheet(); }
    if (d.ptest !== undefined) return imprimir({ numero: 0, nombre: "Prueba", created_at: new Date().toISOString(), registro: S.me || "Setto", pagado: true, pago: "Efectivo", total: 5000, descuento: 0, items: [{ qty: 1, nombre: "Caramel Vanilla Dirty", size: "16 oz", detalle: "Leche de avena · Sin hielo", nota: "poco dulce", subtotal: 5000 }] }, "ambos");
    if (d.fs !== undefined) { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (_) {} return; }
    /* tickear */
    if (d.cat) { S.cat = d.cat; ls.set("setto-local-cat", S.cat); return vTickear(); }
    if (d.p) {
      const p = find(d.p); if (!p || !vendible(p)) return;
      if (esBebida(p) || esPromo(p) || bebOpts(p).length) return abrirOpciones(p, null);
      return sumar({ id: p.id, qty: 1, size: "", leche: "", sin: [], bebida: "", mochis: [], nota: "" });
    }
    if (d.lp) {
      const x = findLp(d.lp); if (!x) return;
      if (S.editLocal) return abrirLibre(null, x);
      return sumar({ id: "lp:" + x.id, tipo: "lp", lp: x.id, nombre: x.nombre, precio: x.precio, qty: 1, nota: "" });
    }
    if (d.otro !== undefined) return abrirLibre(null, null);
    if (d.lpedit !== undefined) { S.editLocal = !S.editLocal; return vTickear(); }
    if (d.edit) { const l = S.ticket[+d.edit]; if (l && l.tipo) return abrirLibre(+d.edit, null); const p = l && find(l.id); if (p) abrirOpciones(p, +d.edit); return; }
    if (d.q) { const [i, n] = d.q.split(":").map(Number); const l = S.ticket[i]; if (!l) return; l.qty += n; if (l.qty <= 0) S.ticket.splice(i, 1); else l.qty = Math.min(50, l.qty); guardarTicket(); return redrawTicket(); }
    if (d.tkclear !== undefined) { if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Vaciar? Tocá de nuevo"; return; } S.ticket = []; S.desc = 0; S.verDesc = false; S.nombre = ""; S.nota = ""; guardarTicket(); return redrawTicket(); }
    if (d.desc !== undefined) { S.verDesc = true; redrawTicket(); const i = $("#tkDesc"); if (i) i.focus(); return; }
    if (d.nodesc !== undefined) { S.verDesc = false; S.desc = 0; return redrawTicket(); }
    if (d.tkopen !== undefined) { document.body.classList.add("tk-on"); return; }
    if (d.tkclose !== undefined) { document.body.classList.remove("tk-on"); return; }
    if (d.cobrar !== undefined) { if (!S.ticket.length || !needMe()) return; return cobrarSheet(null); }
    if (d.sincobrar !== undefined) return enviar(null, null);
    /* opciones */
    if (O) {
      if (d.oq) { O.qty = Math.max(1, Math.min(50, O.qty + +d.oq)); return drawOpciones(); }
      if (d.oleche !== undefined) { O.leche = d.oleche; return drawOpciones(); }
      if (d.osin !== undefined) { O.sin = O.sin.includes(d.osin) ? O.sin.filter((x) => x !== d.osin) : [...O.sin, d.osin]; return drawOpciones(); }
      if (d.obeb) { O.bebida = d.obeb; return drawOpciones(); }
      if (d.bx) { const [id, n] = d.bx.split(":"); if (+n > 0) { if (O.mochis.length < promoCant(O.p)) O.mochis.push(id); } else { const k = O.mochis.lastIndexOf(id); if (k >= 0) O.mochis.splice(k, 1); } return drawOpciones(); }
      if (d.oadd !== undefined) return confirmarOpciones(d.oadd);
      if (d.odel !== undefined) { S.ticket.splice(O.idx, 1); guardarTicket(); closeSheet(); return redrawTicket(); }
    }
    /* producto del local / suelto */
    if (L) {
      if (d.lq) { L.qty = Math.max(1, Math.min(50, L.qty + +d.lq)); const s = $("#sheet .stepper b"); if (s) s.textContent = L.qty; const tt = $("#lTot"); if (tt) tt.textContent = money((parseMoney(L.precio) || 0) * L.qty); return; }
      if (d.lok !== undefined) return confirmarLibre();
      if (d.ldel !== undefined) { S.ticket.splice(L.idx, 1); guardarTicket(); closeSheet(); return redrawTicket(); }
      if (d.lhide !== undefined) {
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Ocultarlo? Tocá de nuevo"; return; }
        const x = findLp(L.lp); if (!x) return;
        try { fail(await sb.rpc("local_producto_guardar", { p_id: x.id, p_nombre: x.nombre, p_precio: x.precio, p_activo: false })); }
        catch (err) { return toast(err.message); }
        S.lprods = S.lprods.filter((y) => y.id !== x.id); S.ticket = S.ticket.filter((l) => l.lp !== x.id); guardarTicket();
        closeSheet(); toast(`${x.nombre} oculto`); if (!S.lprods.length) S.editLocal = false; return vTickear();
      }
    }
    /* cobro */
    if (C) {
      if (d.pago) { C.pago = d.pago; if (d.pago !== "efectivo") C.con = null; return drawCobro(); }
      if (d.con) { C.con = C.con === +d.con ? null : +d.con; return drawCobro(); }
      if (d.cobok !== undefined) return C.comanda ? cobrarExistente(C.pago, C.con) : enviar(C.pago, C.con);
    }
    /* barra y hoy */
    if (d.est) { const [id, est] = d.est.split(":"); b.disabled = true; const c = await rpc("local_estado", { p_id: id, p_estado: est }, (x) => (est === "lista" ? `#${x.numero} lista` : est === "entregada" ? `#${x.numero} entregada` : `#${x.numero} vuelve a la barra`)); if (c && !$("#sheet").hidden) closeSheet(); return render(); }
    if (d.reimp) { const c = S.comandas.find((x) => x.id === d.reimp); if (c) imprimir(c, "comanda"); return; }
    if (d.reimpcli) { const c = S.comandas.find((x) => x.id === d.reimpcli); if (c) imprimir(c, "cliente"); return; }
    if (d.com) return comandaSheet(d.com);
    if (d.canje) return canjear(d.canje, b);
    if (d.clubc) {
      const tel = ($("#cTel") || {}).value || ""; if (!telOk(tel)) { toast("Poné el celular con característica"); const i = $("#cTel"); if (i) i.focus(); return; }
      b.disabled = true;
      try {
        const r = await anotarClub({ id: d.clubc }, tel, ($("#cWa") || {}).checked);
        const c = r.comanda, k = r.tarjeta; render();
        toast(c.sellos ? `+${c.sellos} sello · ${k.sellos}/${k.meta}` : c.pagado ? "Anotado, pero no suma sello (compra mínima o Club apagado)" : "Anotado: el sello se suma al cobrar");
        if (c.sellos && k.sellos >= k.meta) premioSheet(k); else comandaSheet(c.id);
      } catch (err) { b.disabled = false; toast(err.message); }
      return;
    }
    if (d.cobrarc) { const c = S.comandas.find((x) => x.id === d.cobrarc); if (c) cobrarSheet(c); return; }
    if (d.cambpago) return cambiarPagoSheet(d.cambpago);
    if (d.cpago) { if (!needMe()) return; const [id, k] = d.cpago.split(":"); const c = await rpc("local_cambiar_pago", { p_id: id, p_pago: k, p_quien: S.me }, (x) => `#${x.numero}: ${x.pago}`); if (c) { closeSheet(); render(); } return; }
    if (d.anular) {
      if (!needMe()) return;
      const mot = ($("#anMot") || {}).value || ""; if (!mot.trim()) { toast("Contá por qué se anula"); const i = $("#anMot"); if (i) i.focus(); return; }
      b.disabled = true; const c = await rpc("local_anular", { p_id: d.anular, p_motivo: mot.trim(), p_quien: S.me }, (x) => `#${x.numero} anulada`); if (c) { closeSheet(); render(); } else b.disabled = false; return;
    }
  });
  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (["tickear", "barra", "hoy"].includes(v) && v !== S.view) go(v); });

  start();
})();
