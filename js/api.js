/*
  Capa de datos de Setto.
  - Con Supabase configurado (js/config.js) habla con la base real.
  - Sin configurar, usa MODO DEMO: guarda todo en este navegador (localStorage).
  El sitio público y el panel usan las mismas funciones.
*/
(function () {
  const cfg = window.SETTO_CONFIG || {};
  const DEMO = !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase;
  const sb = DEMO ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  /* Celulares argentinos → 549 + 10 dígitos (igual que norm_phone en la base) */
  function normPhone(p) {
    let d = String(p || "").replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("549") && d.length === 13) return d;
    if (d.startsWith("54") && d.length >= 12) d = d.slice(2);
    if (d.startsWith("9") && d.length === 11) d = d.slice(1);
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 12) {
      if (d.substr(3, 2) === "15") d = d.slice(0, 3) + d.slice(5);
      else if (d.substr(2, 2) === "15") d = d.slice(0, 2) + d.slice(4);
      else if (d.substr(4, 2) === "15") d = d.slice(0, 4) + d.slice(6);
    }
    if (d.length === 9 && d.startsWith("15")) d = "223" + d.slice(2);
    if (d.length === 7) d = "223" + d;
    return d.length === 10 ? "549" + d : null;
  }
  /* Drop de la edición especial: en qué momento está ("antes", "abierto" o "terminado").
     Es la misma regla que especial_abierto() en la base, que es la que acepta o no los pedidos. */
  function dropEstado(E, now = Date.now()) {
    E = E || {};
    if (E.modo !== "programado") return E.estado === "disponible" ? "abierto" : "antes";
    const ini = Date.parse(E.lanzamiento || ""), fin = Date.parse(E.fin || "");
    if (!ini || now < ini) return "antes";
    return fin && now >= fin ? "terminado" : "abierto";
  }
  function prettyPhone(p) {
    const d = normPhone(p) || String(p || "");
    if (d.length !== 13) return d;
    return `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}`;
  }

  const fail = (error) => { if (error) throw new Error(cleanMsg(error.message || String(error))); };
  const cleanMsg = (m) => String(m).replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");

  /* =================== MODO DEMO =================== */
  const demoPuede = (db, ph, canal) => ((db.consents || []).find((x) => x.phone === ph && x.canal === canal) || {}).estado === "otorgado";
  const KEY = "setto-demo-db";
  function dbLoad() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    if (!db) {
      const seed = JSON.parse(JSON.stringify(window.SETTO_SEED));
      db = { settings: seed.settings, products: seed.products, orders: [], customers: [], events: [] };
      dbSave(db);
    }
    return db;
  }
  function dbSave(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw new Error("El navegador no tiene más espacio (modo demo). Probá con fotos más livianas."); } }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

  const demo = {
    async loadAll() { const db = dbLoad(); return { settings: db.settings, products: db.products }; },
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio: elegido, gift }) {
      const db = dbLoad(), ph = normPhone(phone), esp = db.settings.especial || {}, envio = db.settings.envio || {}, club = db.settings.club || {}, pers = db.settings.personalizacion || {};
      modo = modo === "envio" ? "envio" : "retiro";
      if (modo === "envio" && !envio.activo) throw new Error("Por ahora no hacemos envíos desde la web");
      if (modo === "envio" && String(direccion || "").trim().length < 5) throw new Error("Falta la dirección de entrega");
      if (modo === "envio" && pago !== (envio.pago || "Transferencia / Mercado Pago")) throw new Error("Con envío a domicilio el pago es solo por transferencia");
      if (!String(nombre || "").trim()) throw new Error("Falta tu nombre");
      if (!ph) throw new Error("El celular no parece válido");
      if (!items || !items.length) throw new Error("El pedido está vacío");
      let total = 0; const lines = [];
      for (const it of items) {
        const pr = db.products.find((p) => p.id === it.id && p.activo !== false);
        if (!pr) throw new Error("Un producto del pedido ya no está disponible");
        const qty = Math.max(1, Math.min(20, it.qty || 1));
        let price, size = null, name = pr.nombre;
        if (pr.categoria === "set" || pr.categoria === "dirty") {
          size = it.size; price = size === "12 oz" ? pr.precio_12 : size === "16 oz" ? pr.precio_16 : null;
          if (!price) throw new Error("Falta elegir el tamaño de " + pr.nombre);
        } else {
          price = pr.precio; name = "Mochi " + pr.nombre;
          if (pr.categoria === "especial" && dropEstado(esp) !== "abierto") throw new Error(pr.nombre + " no está disponible ahora");
        }
        if (pr.agotado) throw new Error(pr.nombre + " está agotado");
        if (!(price > 0)) throw new Error(pr.nombre + " todavía no tiene precio");
        let leche = null, sin = [], det = null;
        if ((pr.categoria === "set" || pr.categoria === "dirty") && pers.activo !== false) {
          leche = String(it.leche || "").trim() || null;
          if (leche) { const l = (pers.leches || []).find((x) => x.nombre === leche); if (!l) throw new Error("Esa leche ya no está disponible, elegí otra"); price += Math.max(0, Number(l.precio) || 0); if (Number(l.precio) > 0 || leche !== ((pers.leches || [])[0] || {}).nombre) det = leche; }
          for (const x of it.sin || []) { if (!(pers.sin || []).includes(x)) throw new Error("Opción no disponible: " + x); if (!sin.includes(x)) sin.push(x); }
          if (sin.length) det = [det, ...sin].filter(Boolean).join(" · ");
        }
        total += price * qty;
        lines.push({ id: pr.id, nombre: name, size, qty, precio: price, subtotal: price * qty, leche, sin, detalle: det });
      }
      const sub = total, costo = modo === "envio" ? Math.max(0, Number(envio.costo) || 0) : 0;
      if (costo > 0) { lines.push({ id: "envio", nombre: "Envío", size: null, qty: 1, precio: costo, subtotal: costo }); total += costo; }
      const cust = db.customers.find((x) => x.phone === ph), spp = club.sellos_por_pedido ?? 1, meta = club.meta || 8;
      const premio = club.activo !== false && spp > 0 && sub >= (Number(club.minimo) || 0) && (cust ? cust.sellos : 0) + spp >= meta;
      let ptxt = null, off = 0;
      if (premio) {
        const pdesc = club.premio_descuento ?? 35, tope = Number(club.premio_tope) || 0;
        if (elegido === "descuento" && pdesc > 0) {
          off = Math.round((sub * pdesc) / 100 / 10) * 10; if (tope > 0) off = Math.min(off, tope);
          ptxt = pdesc + "% off en este pedido"; lines.push({ id: "premio", nombre: "Premio Setto Club: " + ptxt, size: null, qty: 1, precio: -off, subtotal: -off }); total -= off;
        } else if (String(elegido || "").startsWith("set:") && club.premio_set !== false) {
          const ps = db.products.find((p) => p.id === elegido.slice(4) && p.categoria === "set" && p.activo !== false && !p.agotado);
          if (!ps) throw new Error("Ese set no está disponible, elegí otro premio");
          ptxt = ps.nombre + " (12 oz) de regalo"; lines.push({ id: "premio", nombre: "Premio Setto Club: " + ptxt, size: "12 oz", qty: 1, precio: 0, subtotal: 0 });
        } else throw new Error("Elegí tu premio del Setto Club");
      }
      let giftOff = 0, gc = null;
      if (gift && String(gift).trim()) {
        gc = (db.giftcards || []).find((g) => g.code === String(gift).trim().toUpperCase());
        if (!gc) throw new Error("No encontramos esa gift card. Revisá el código.");
        if (gc.estado === "pendiente") throw new Error("Esa gift card todavía no está activa");
        if (gc.estado !== "activa" || gc.saldo <= 0) throw new Error("Esa gift card ya no tiene saldo");
        giftOff = Math.min(gc.saldo, Math.max(total, 0));
        if (giftOff > 0) { lines.push({ id: "gift", nombre: "Gift card " + gc.code, size: null, qty: 1, precio: -giftOff, subtotal: -giftOff }); total -= giftOff; gc.saldo -= giftOff; if (gc.saldo <= 0) gc.estado = "usada"; }
      }
      let code; do { code = "STT-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"); }
      while (db.orders.some((o) => o.code === code && o.status === "pendiente"));
      const o = { id: uid(), code, nombre: String(nombre).trim(), phone: ph, items: lines, total, retiro, pago, nota: nota || null, status: "pendiente", sellos: 0, created_at: new Date().toISOString(),
        modo, direccion: modo === "envio" ? String(direccion).trim() : null, premio, premio_txt: ptxt };
      if (giftOff > 0) o.gift = { code: gc.code, monto: giftOff };
      o.etapa = "recibido"; o.track = uid().replace(/-/g, ""); db.orders.unshift(o); dbSave(db);
      return { id: o.id, code, total, items: lines, phone: ph, modo, direccion: o.direccion, costo_envio: costo, premio, premio_txt: ptxt, descuento: off, gift: giftOff, meta };
    },
    async getStock() { return null; },
    async getCard(phone) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("El celular no parece válido");
      const c = db.customers.find((x) => x.phone === ph), club = db.settings.club || {};
      return { existe: !!c, sellos: c ? c.sellos : 0, canjes: c ? c.canjes : 0, meta: club.meta || 8, premio: club.premio || "" };
    },
    /* equipo */
    async session() { return sessionStorage.getItem("setto-demo-staff") ? { email: "demo@setto" } : null; },
    async signIn() { sessionStorage.setItem("setto-demo-staff", "1"); return { email: "demo@setto" }; },
    async signOut() { sessionStorage.removeItem("setto-demo-staff"); },
    async isStaff() { return true; },
    async listOrders(status) {
      const db = dbLoad(), since = Date.now() - 7 * 864e5;
      return db.orders.filter((o) => o.status === status && (status === "pendiente" || new Date(o.created_at) > since));
    },
    async confirmOrder(id, phone, n) {
      const db = dbLoad(), o = db.orders.find((x) => x.id === id), ph = normPhone(phone);
      if (!ph) throw new Error("Número de celular inválido");
      if (!o || o.status !== "pendiente") throw new Error("Ese pedido ya no está pendiente");
      n = Math.max(0, Math.min(10, n | 0));
      Object.assign(o, { status: "entregado", phone: ph, sellos: n, closed_at: new Date().toISOString() });
      let c = db.customers.find((x) => x.phone === ph);
      if (!c) { c = { phone: ph, nombre: o.nombre, sellos: 0, canjes: 0, created_at: new Date().toISOString() }; db.customers.push(c); }
      c.sellos += n; c.updated_at = new Date().toISOString();
      if (n) db.events.unshift({ phone: ph, delta: n, motivo: "Pedido " + o.code, created_at: new Date().toISOString() });
      const club = db.settings.club || {}, meta = club.meta || 8; let canje = false;
      if (n > 0 && club.activo !== false && c.sellos >= meta) {
        c.sellos -= meta; c.canjes += 1; canje = true;
        db.events.unshift({ phone: ph, delta: -meta, motivo: "Premio entregado en " + o.code, created_at: new Date().toISOString() });
      }
      o.premio = canje;
      dbSave(db); return { phone: ph, sellos: c.sellos, canje, premio: club.premio };
    },
    async cancelOrder(id) {
      const db = dbLoad(), o = db.orders.find((x) => x.id === id);
      if (!o || o.status !== "pendiente") throw new Error("El pedido no está pendiente");
      o.status = "cancelado"; o.closed_at = new Date().toISOString();
      if (o.gift && !o.gift.devuelto) { const g = (db.giftcards || []).find((x) => x.code === o.gift.code); if (g) { g.saldo += o.gift.monto; g.estado = "activa"; } o.gift.devuelto = true; } dbSave(db);
    },
    async pedirCambio(id, faltan, nota) {
      const db = dbLoad(), o = db.orders.find((x) => x.id === id);
      if (!o || o.status !== "pendiente") throw new Error("El pedido no está pendiente");
      if (!faltan || !faltan.length) throw new Error("Marcá qué falta");
      o.cambio = { estado: "esperando", nota: (nota || "").trim() || null, at: new Date().toISOString(), faltan: faltan.map((f) => { const it = o.items[f.idx]; const q = Math.max(1, Math.min(f.qty || it.qty, it.qty)); return { idx: f.idx, id: it.id, nombre: it.nombre, size: it.size, qty: q, de: it.qty }; }) };
      dbSave(db); return o.cambio;
    },
    async quitarCambio(id) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (o) { o.cambio = null; dbSave(db); } },
    async cambioOpciones(track) {
      const db = dbLoad(), o = db.orders.find((x) => x.track === track); if (!o) throw new Error("No encontramos ese pedido");
      if (!o.cambio || o.cambio.estado !== "esperando" || o.status !== "pendiente") return { estado: (o.cambio && o.cambio.estado) || "sin_cambio", code: o.code, status: o.status };
      const leche = (n) => (((db.settings.personalizacion || {}).leches || []).find((l) => l.nombre === n) || {}).precio || 0;
      const precio = (a, size, l) => (["set", "dirty"].includes(a.categoria) ? (size === "16 oz" ? a.precio_16 : a.precio_12) + leche(l) : a.precio);
      return { estado: "esperando", code: o.code, status: o.status, nota: o.cambio.nota, total: o.total, items: o.items,
        faltan: o.cambio.faltan.map((f) => { const it = o.items[f.idx], pr = db.products.find((p) => p.id === it.id) || {};
          const alts = db.products.filter((a) => a.activo !== false && !a.agotado && a.id !== pr.id && (a.categoria === pr.categoria || (["mochi", "especial"].includes(pr.categoria) && a.categoria === "mochi")) && precio(a, it.size, it.leche) > 0)
            .map((a) => ({ id: a.id, nombre: ["mochi", "especial"].includes(a.categoria) ? "Mochi " + a.nombre : a.nombre, img: a.img, precio: precio(a, it.size, it.leche) }));
          return { idx: f.idx, nombre: it.nombre, size: it.size, detalle: it.detalle, qty: f.qty, de: it.qty, precio: it.precio, alternativas: alts }; }) };
    },
    async resolverCambio(track, elecciones, cancelar) {
      const db = dbLoad(), o = db.orders.find((x) => x.track === track); if (!o) throw new Error("No encontramos ese pedido");
      if (o.status !== "pendiente" || !o.cambio || o.cambio.estado !== "esperando") throw new Error("Este pedido no tiene cambios pendientes");
      if (cancelar) { o.status = "cancelado"; o.closed_at = new Date().toISOString(); Object.assign(o.cambio, { estado: "resuelto", resolucion: "cancelado" }); dbSave(db); return { estado: "cancelado", code: o.code }; }
      const op = await this.cambioOpciones(track), items = o.items.map((x) => ({ ...x })), add = [], res = [];
      op.faltan.forEach((f) => { const e = (elecciones || []).find((x) => x.idx === f.idx); if (!e) throw new Error("Elegí qué hacer con " + f.nombre);
        const it = items[f.idx]; it.qty -= f.qty;
        if (e.accion === "cambiar") { const a = f.alternativas.find((x) => x.id === e.id); if (!a) throw new Error("Ese reemplazo ya no está disponible, elegí otro"); add.push({ ...it, id: a.id, nombre: a.nombre, qty: f.qty, precio: a.precio, subtotal: a.precio * f.qty }); res.push({ de: f.nombre, qty: f.qty, a: a.nombre }); }
        else res.push({ de: f.nombre, qty: f.qty, a: null }); });
      const nuevo = [...items.filter((i) => i.id !== "gift" && (["envio", "premio"].includes(i.id) || i.qty > 0)).map((i) => (["envio", "premio"].includes(i.id) ? i : { ...i, subtotal: i.precio * i.qty })), ...add];
      if (!nuevo.some((i) => !["envio", "premio"].includes(i.id))) throw new Error("El pedido quedaría vacío. Elegí un reemplazo o cancelalo.");
      const antes = o.total; o.items = nuevo; o.total = Math.max(0, nuevo.reduce((s, i) => s + i.subtotal, 0));
      Object.assign(o.cambio, { estado: "resuelto", resolucion: "cambiado", cambios: res, total_antes: antes }); dbSave(db);
      return { estado: "resuelto", code: o.code, total: o.total, total_antes: antes, items: nuevo, cambios: res };
    },
    async setEtapa(id, etapa) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o || o.status !== "pendiente") throw new Error("El pedido no está pendiente"); o.etapa = etapa; dbSave(db); },
    async marcarAviso(id, etapa) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o) return; o.avisos = { ...(o.avisos || {}), [etapa]: new Date().toISOString() }; dbSave(db); },
    // consentimientos de marketing (migración 030): historial; vale la última fila por celular y canal
    async registrarConsentimiento(code, phone, canales, version) {
      const db = dbLoad(), ph = normPhone(phone), o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "pendiente"); if (!o) return;
      db.consents = db.consents || [];
      canales.filter((c) => ["whatsapp", "meta_ads"].includes(c) && !demoPuede(db, ph, c)).forEach((c) => db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "otorgado", origen: "checkout_web", aviso_version: version, order_id: o.id, created_at: new Date().toISOString() }));
      dbSave(db);
    },
    async bajaMarketing(phone, canal) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá el número: código de área + número, por ejemplo 223 347-1277.");
      db.consents = db.consents || [];
      ["whatsapp", "meta_ads"].filter((c) => (!canal || canal === c) && demoPuede(db, ph, c)).forEach((c) => db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "revocado", origen: sessionStorage.getItem("setto-demo-staff") ? "panel" : "preferencias_web", created_at: new Date().toISOString() }));
      dbSave(db);
    },
    async consentimientos(phone) { const ph = normPhone(phone); return (dbLoad().consents || []).filter((x) => x.phone === ph); },
    async marcarContacto(code, phone) { const db = dbLoad(), ph = normPhone(phone), o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "pendiente"); if (o && !o.contacto_at) { o.contacto_at = new Date().toISOString(); dbSave(db); } },
    onTrack(tracks, cb) { if (this._trk) return; this._trk = 1; window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); }); },
    async orderStatus(codes, phone) {
      const db = dbLoad(), ph = normPhone(phone), since = Date.now() - 3 * 864e5;
      return db.orders.filter((o) => o.phone === ph && codes.includes(o.code) && new Date(o.created_at) > since)
        .map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, cambio: o.cambio ? { estado: o.cambio.estado, resolucion: o.cambio.resolucion } : null, resena: (db.reviews || []).some((r) => r.order_id === o.id) }));
    },
    async buscarPedido(phone, code) {
      const db = dbLoad(), ph = normPhone(phone), since = Date.now() - 2 * 864e5;
      return db.orders.filter((o) => o.status === "pendiente" && new Date(o.created_at) > since && (code ? o.code === code : ph && o.phone === ph)).slice(-3).reverse()
        .map((o) => ({ code: code ? o.code : "STT-••" + o.code.slice(-2), etapa: o.etapa || "recibido", modo: o.modo, created_at: o.created_at }));
    },
    async trackStatus(tracks) {
      const db = dbLoad();
      return db.orders.filter((o) => o.track && tracks.includes(o.track)).map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, phone: o.phone, cambio: o.cambio ? { estado: o.cambio.estado, resolucion: o.cambio.resolucion } : null, resena: (db.reviews || []).some((r) => r.order_id === o.id) }));
    },
    async pushSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async pushDesuscribir() {},
    async dropSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async dropDesuscribir() {},
    async dropAvisos() { return { suscriptos: 0, avisado: null }; },
    async dropAvisar() { throw new Error("En modo demo no hay notificaciones"); },
    async equipoPushSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async equipoPushDesuscribir() {},
    async equipoPushActivo() { return false; },
    async createReviewTrack(track, rating, texto, foto, instagram) { const o = dbLoad().orders.find((x) => x.track === track); if (!o) throw new Error("No encontramos ese pedido"); return this.createReview(o.code, o.phone, rating, texto, foto, instagram); },
    async uploadReviewPhoto(blob) { return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); },
    async productRatings() {
      const db = dbLoad(), out = {};
      (db.reviews || []).filter((r) => r.estado === "aprobada").forEach((r) => { const o = db.orders.find((x) => x.id === r.order_id); if (!o) return;
        [...new Set(o.items.filter((i) => !["envio", "premio"].includes(i.id)).map((i) => i.id))].forEach((id) => { const a = (out[id] = out[id] || { s: 0, cantidad: 0 }); a.s += r.rating; a.cantidad++; }); });
      Object.values(out).forEach((a) => { a.promedio = Math.round((a.s / a.cantidad) * 10) / 10; delete a.s; }); return out;
    },
    async createReview(code, phone, rating, texto, foto, instagram) {
      const db = dbLoad(), ph = normPhone(phone); db.reviews = db.reviews || [];
      const ig = String(instagram || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
      if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) throw new Error("Revisá tu usuario de Instagram");
      if (!(rating >= 1 && rating <= 5)) throw new Error("Elegí de 1 a 5 estrellas");
      const o = db.orders.find((x) => x.code === code && x.phone === ph && (x.status === "entregado" || (x.status === "pendiente" && x.etapa === "listo")));
      if (!o) throw new Error("Vas a poder dejar tu reseña cuando tu pedido esté listo");
      if (db.reviews.some((r) => r.order_id === o.id)) throw new Error("Ya dejaste una reseña de este pedido. ¡Gracias!");
      db.reviews.unshift({ id: uid(), order_id: o.id, phone: ph, nombre: o.nombre, rating, texto: String(texto || "").trim() || null, foto: foto || null, instagram: ig.toLowerCase() || null, estado: "pendiente", created_at: new Date().toISOString() }); dbSave(db);
    },
    async publicReviews() {
      const ok = (dbLoad().reviews || []).filter((r) => r.estado === "aprobada");
      const nom = (n) => { const [a, b] = String(n).trim().split(/\s+/); return a.charAt(0).toUpperCase() + a.slice(1) + (b ? " " + b[0].toUpperCase() + "." : ""); };
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null,
        items: ok.filter((r) => r.texto || r.foto).slice(0, 12).map((r) => { const o = dbLoad().orders.find((x) => x.id === r.order_id) || { items: [] };
          return { nombre: nom(r.nombre), rating: r.rating, texto: r.texto, foto: r.foto, instagram: r.instagram, fecha: r.created_at, pedido: [...new Set(o.items.filter((i) => !["envio", "premio"].includes(i.id)).map((i) => i.nombre))] }; }) };
    },
    async listReviews() { return (dbLoad().reviews || []).slice(0, 100); },
    async createGiftcard({ diseno, monto, de, para, mensaje, phone }) {
      const db = dbLoad(), ph = normPhone(phone), cfg = db.settings.giftcards || {}; db.giftcards = db.giftcards || [];
      if (!ph) throw new Error("Revisá tu celular");
      if (!(monto >= (cfg.minimo || 5000) && monto <= (cfg.maximo || 100000))) throw new Error(`El monto tiene que ser entre ${cfg.minimo || 5000} y ${cfg.maximo || 100000}`);
      if (!String(para || "").trim()) throw new Error("Falta para quién es");
      const hex = () => Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, "0");
      const g = { id: uid(), code: `GIFT-${hex()}-${hex()}`, token: uid().replace(/-/g, ""), diseno, monto, saldo: 0, de: de || null, para, mensaje: mensaje || null, phone: ph, estado: "pendiente", created_at: new Date().toISOString() };
      db.giftcards.unshift(g); dbSave(db); return { code: g.code, token: g.token, monto };
    },
    async giftcardByToken(token) { const g = (dbLoad().giftcards || []).find((x) => x.token === token); if (!g) return null; return { ...g, code: ["activa", "usada"].includes(g.estado) ? g.code : null }; },
    async giftcardCheck(code) { const g = (dbLoad().giftcards || []).find((x) => x.code === String(code).trim().toUpperCase() && x.estado !== "anulada"); return g ? { code: g.code, saldo: g.saldo, estado: g.estado, diseno: g.diseno } : null; },
    async listGiftcards() { return (dbLoad().giftcards || []).slice(0, 200); },
    async activateGiftcard(id, cuenta) { const db = dbLoad(), g = (db.giftcards || []).find((x) => x.id === id); if (!g || g.estado !== "pendiente") throw new Error("La gift card no está pendiente"); g.estado = "activa"; g.saldo = g.monto; g.pago = cuenta; g.activada_at = new Date().toISOString(); dbSave(db); return { token: g.token, code: g.code }; },
    async annulGiftcard(id) { const db = dbLoad(), g = (db.giftcards || []).find((x) => x.id === id); if (!g) return; if (g.estado === "usada" || (g.estado === "activa" && g.saldo < g.monto)) throw new Error("Ya se usó: no se puede anular"); g.estado = "anulada"; g.saldo = 0; dbSave(db); },
    async pollResults(poll) { const v = (dbLoad().votes || []).filter((x) => x.poll === poll), conteo = {}; v.forEach((x) => (conteo[x.opcion] = (conteo[x.opcion] || 0) + 1)); return { total: v.length, conteo }; },
    async castVote(poll, opcion, phone) {
      const db = dbLoad(), cfg = db.settings.votacion || {}, ph = normPhone(phone); db.votes = db.votes || [];
      if (!cfg.activo || cfg.id !== poll) throw new Error("Esta votación ya cerró");
      if (!(cfg.opciones || []).some((o) => o.id === opcion)) throw new Error("Esa opción no existe");
      if (!ph) throw new Error("Revisá tu celular");
      if (cfg.solo_clientes && !db.orders.some((o) => o.phone === ph && o.status === "entregado")) throw new Error("Votan quienes ya hicieron un pedido por la web. ¡Te esperamos!");
      const ex = db.votes.find((x) => x.poll === poll && x.phone === ph); if (ex) ex.opcion = opcion; else db.votes.push({ poll, opcion, phone: ph, created_at: new Date().toISOString() });
      dbSave(db); return this.pollResults(poll);
    },
    async publicReviewsAll(offset = 0) {
      const db = dbLoad(), ok = (db.reviews || []).filter((r) => r.estado === "aprobada"), por = {};
      ok.forEach((r) => (por[r.rating] = (por[r.rating] || 0) + 1));
      const nom = (n) => { const [a, b] = String(n).trim().split(/\s+/); return a.charAt(0).toUpperCase() + a.slice(1) + (b ? " " + b[0].toUpperCase() + "." : ""); };
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null, por_estrella: por,
        items: ok.slice(offset, offset + 50).map((r) => { const o = db.orders.find((x) => x.id === r.order_id) || { items: [] };
          return { nombre: nom(r.nombre), rating: r.rating, texto: r.texto, foto: r.foto, instagram: r.instagram, fecha: r.created_at, pedido: [...new Set(o.items.filter((i) => !["envio", "premio"].includes(i.id)).map((i) => i.nombre))] }; }) };
    },
    async productReviews(id) {
      const db = dbLoad(), ok = (db.reviews || []).filter((r) => r.estado === "aprobada" && (db.orders.find((x) => x.id === r.order_id) || { items: [] }).items.some((i) => i.id === id)), por = {};
      ok.forEach((r) => (por[r.rating] = (por[r.rating] || 0) + 1));
      const all = await this.publicReviewsAll(0), keep = new Set(ok.map((r) => r.created_at));
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null, por_estrella: por, items: all.items.filter((x) => keep.has(x.fecha)).slice(0, 30) };
    },
    async setReviewEstado(id, estado) { const db = dbLoad(), r = (db.reviews || []).find((x) => x.id === id); if (r) { r.estado = estado; dbSave(db); } },
    async addStamps(phone, nombre, delta, motivo) {
      const db = dbLoad(), ph = normPhone(phone);
      if (!ph) throw new Error("Número de celular inválido");
      if (!delta || Math.abs(delta) > 20) throw new Error("Cantidad de sellos inválida");
      let c = db.customers.find((x) => x.phone === ph);
      if (!c) { c = { phone: ph, nombre: nombre || null, sellos: 0, canjes: 0, created_at: new Date().toISOString() }; db.customers.push(c); }
      if (nombre) c.nombre = nombre;
      c.sellos = Math.max(0, c.sellos + delta); c.updated_at = new Date().toISOString();
      db.events.unshift({ phone: ph, delta, motivo: motivo || "Manual", created_at: new Date().toISOString() });
      dbSave(db); return { phone: ph, sellos: c.sellos };
    },
    async redeem(phone) {
      const db = dbLoad(), ph = normPhone(phone), meta = (db.settings.club || {}).meta || 8;
      const c = db.customers.find((x) => x.phone === ph);
      if (!c || c.sellos < meta) throw new Error("Todavía no completó la tarjeta");
      c.sellos -= meta; c.canjes += 1; c.updated_at = new Date().toISOString();
      db.events.unshift({ phone: ph, delta: -meta, motivo: "Canje de premio", created_at: new Date().toISOString() });
      dbSave(db); return { phone: ph, sellos: c.sellos, canjes: c.canjes };
    },
    async findCustomer(phone) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Número de celular inválido");
      return {
        phone: ph,
        customer: db.customers.find((x) => x.phone === ph) || null,
        events: db.events.filter((e) => e.phone === ph).slice(0, 30),
        orders: db.orders.filter((o) => o.phone === ph).slice(0, 10),
      };
    },
    async listCustomers() { return dbLoad().customers.slice().sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 40); },
    async saveProduct(p) {
      const db = dbLoad(), i = db.products.findIndex((x) => x.id === p.id);
      if (i >= 0) db.products[i] = { ...db.products[i], ...p }; else db.products.push(p);
      dbSave(db); return p;
    },
    async deleteProduct(id) { const db = dbLoad(); db.products = db.products.filter((p) => p.id !== id); dbSave(db); },
    async saveSetting(key, value) { const db = dbLoad(); db.settings[key] = value; dbSave(db); },
    async uploadPhoto(blob) {
      return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    },
    async uploadMedia(file) { return this.uploadPhoto(file); },
    onOrders(cb) { window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); }); },
    resetDemo() { localStorage.removeItem(KEY); },
  };

  /* =================== SUPABASE =================== */
  const trkChans = new Map();
  const live = {
    async loadAll() {
      const [s, p] = await Promise.all([
        sb.from("settings").select("key,value"),
        sb.from("products").select("*").order("orden", { ascending: true }),
      ]);
      fail(s.error); fail(p.error);
      const settings = {}; s.data.forEach((r) => (settings[r.key] = r.value));
      return { settings, products: p.data };
    },
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio, gift }) {
      const { data, error } = await sb.rpc("create_order_v5", {
        p_nombre: nombre, p_phone: phone, p_items: items.map((i) => ({ id: i.id, size: i.size || null, qty: i.qty, leche: i.leche || null, sin: i.sin || [] })),
        p_retiro: retiro, p_pago: pago, p_nota: nota || null, p_modo: modo || "retiro", p_direccion: direccion || null, p_premio: premio || null, p_gift: gift || null,
      });
      fail(error); return data;
    },
    async getCard(phone) { const { data, error } = await sb.rpc("get_card", { p_phone: phone }); fail(error); return data; },
    /* {producto: unidades en el Café} o null si el stock en la web está apagado */
    async getStock() { const { data, error } = await sb.rpc("stock_publico"); if (error) return null; return data; },
    async session() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); fail(error); return data.user; },
    async signOut() { await sb.auth.signOut(); },
    async isStaff() {
      const u = await live.session(); if (!u) return false;
      const { data, error } = await sb.from("staff").select("user_id").eq("user_id", u.id).maybeSingle();
      return !error && !!data;
    },
    async listOrders(status) {
      let q = sb.from("orders").select("*").eq("status", status).order("created_at", { ascending: status !== "pendiente" ? false : true }).limit(100);
      if (status !== "pendiente") q = q.gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());
      const { data, error } = await q; fail(error); return data;
    },
    async confirmOrder(id, phone, n) { const { data, error } = await sb.rpc("confirm_order", { p_id: id, p_phone: phone, p_sellos: n }); fail(error); return data; },
    async cancelOrder(id) { const { error } = await sb.rpc("cancel_order", { p_id: id }); fail(error); },
    async pedirCambio(id, faltan, nota) { const { data, error } = await sb.rpc("pedir_cambio", { p_id: id, p_faltan: faltan, p_nota: nota || null }); fail(error); return data; },
    async quitarCambio(id) { const { error } = await sb.rpc("quitar_cambio", { p_id: id }); fail(error); },
    async cambioOpciones(track) { const { data, error } = await sb.rpc("cambio_opciones", { p_track: track }); fail(error); return data; },
    async resolverCambio(track, elecciones, cancelar) { const { data, error } = await sb.rpc("resolver_cambio", { p_track: track, p_elecciones: elecciones || [], p_cancelar: !!cancelar }); fail(error); return data; },
    async setEtapa(id, etapa) { const { error } = await sb.rpc("set_order_etapa", { p_id: id, p_etapa: etapa }); fail(error); },
    async marcarAviso(id, etapa) { const { error } = await sb.rpc("marcar_aviso", { p_id: id, p_etapa: etapa }); fail(error); },
    // el cliente abrió WhatsApp para mandar el pedido (migración 029; sin ella, no pasa nada)
    async marcarContacto(code, phone) { await sb.rpc("marcar_contacto", { p_code: code, p_phone: phone }); },
    // consentimientos de marketing (migración 030)
    async registrarConsentimiento(code, phone, canales, version) { const { error } = await sb.rpc("registrar_consentimiento", { p_code: code, p_phone: phone, p_canales: canales, p_version: version }); fail(error); },
    async bajaMarketing(phone, canal) { const { error } = await sb.rpc("baja_marketing", { p_phone: phone, p_canal: canal || null }); fail(error); },
    async consentimientos(phone) { const { data, error } = await sb.from("customer_consents").select("*").eq("phone", normPhone(phone)).order("created_at", { ascending: false }).limit(20); fail(error); return data || []; },
    // seguimiento en vivo: un canal público por link de pedido; la base avisa cuando el pedido cambia (migración 024)
    onTrack(tracks, cb) {
      const want = new Set(tracks);
      for (const [t, ch] of trkChans) if (!want.has(t)) { sb.removeChannel(ch); trkChans.delete(t); }
      want.forEach((t) => { if (!trkChans.has(t)) trkChans.set(t, sb.channel("pedido-" + t).on("broadcast", { event: "cambio" }, () => cb(t)).subscribe()); });
    },
    async orderStatus(codes, phone) { const { data, error } = await sb.rpc("get_order_status", { p_codes: codes, p_phone: phone }); fail(error); return data || []; },
    async buscarPedido(phone, code) { const { data, error } = await sb.rpc("buscar_pedido", { p_phone: phone || null, p_code: code || null }); fail(error); return data || []; },
    async trackStatus(tracks) { const { data, error } = await sb.rpc("track_status", { p_tracks: tracks }); fail(error); return data || []; },
    async pushSuscribir(track, sub) { const k = sub.toJSON().keys || {}; const { error } = await sb.rpc("push_suscribir", { p_track: track, p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth }); fail(error); },
    async pushDesuscribir(track, endpoint) { const { error } = await sb.rpc("push_desuscribir", { p_track: track, p_endpoint: endpoint }); fail(error); },
    /* avisos de drops: el cliente se anota una vez y le llega cada lanzamiento */
    async dropSuscribir(sub) { const k = sub.toJSON().keys || {}; const { error } = await sb.rpc("drop_suscribir", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth }); fail(error); },
    async dropDesuscribir(endpoint) { const { error } = await sb.rpc("drop_desuscribir", { p_endpoint: endpoint }); fail(error); },
    async dropAvisos() { const { data, error } = await sb.rpc("drop_avisos_info"); fail(error); return data; },
    async dropAvisar() { const { data, error } = await sb.rpc("drop_avisar"); fail(error); return data; },
    /* avisos al equipo en el panel: pedido nuevo, gift card, cambio resuelto, reseña (migración 027) */
    async equipoPushSuscribir(sub) { const k = sub.toJSON().keys || {}; const { error } = await sb.rpc("staff_push_suscribir", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth }); fail(error); },
    async equipoPushDesuscribir(endpoint) { const { error } = await sb.rpc("staff_push_desuscribir", { p_endpoint: endpoint }); fail(error); },
    async equipoPushActivo(endpoint) { const { data, error } = await sb.rpc("staff_push_activo", { p_endpoint: endpoint }); fail(error); return !!data; },
    async createReviewTrack(track, rating, texto, foto, instagram) { const { error } = await sb.rpc("create_review_track", { p_track: track, p_rating: rating, p_texto: texto || null, p_foto: foto || null, p_instagram: instagram || null }); fail(error); },
    async createReview(code, phone, rating, texto, foto, instagram) { const { error } = await sb.rpc("create_review_v2", { p_code: code, p_phone: phone, p_rating: rating, p_texto: texto || null, p_foto: foto || null, p_instagram: instagram || null }); fail(error); },
    async uploadReviewPhoto(blob) {
      const ext = (blob.type || "").includes("webp") ? "webp" : "jpg", path = `r/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await sb.storage.from("resenas").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
      if (error) throw new Error("No pudimos subir la foto. Probá con otra o enviá la reseña sin foto.");
      return sb.storage.from("resenas").getPublicUrl(path).data.publicUrl;
    },
    async productRatings() { const { data, error } = await sb.rpc("product_ratings"); if (error) return {}; return data || {}; },
    async publicReviews() { const { data, error } = await sb.rpc("public_reviews"); fail(error); return data; },
    async productReviews(id) { const { data, error } = await sb.rpc("product_reviews", { p_id: id }); fail(error); return data; },
    async publicReviewsAll(offset = 0) { const { data, error } = await sb.rpc("public_reviews_all", { p_offset: offset }); fail(error); return data; },
    async createGiftcard({ diseno, monto, de, para, mensaje, phone }) { const { data, error } = await sb.rpc("create_giftcard", { p_diseno: diseno, p_monto: monto, p_de: de || null, p_para: para, p_mensaje: mensaje || null, p_phone: phone }); fail(error); return data; },
    async giftcardByToken(token) { const { data, error } = await sb.rpc("giftcard_by_token", { p_token: token }); fail(error); return data; },
    async giftcardCheck(code) { const { data, error } = await sb.rpc("giftcard_check", { p_code: code }); fail(error); return data; },
    async listGiftcards() { const { data, error } = await sb.from("giftcards").select("*").order("created_at", { ascending: false }).limit(200); fail(error); return data; },
    async activateGiftcard(id, cuenta) { const { data, error } = await sb.rpc("activate_giftcard", { p_id: id, p_cuenta: cuenta || "mp" }); fail(error); return data; },
    async annulGiftcard(id) { const { error } = await sb.rpc("annul_giftcard", { p_id: id }); fail(error); },
    async pollResults(poll) { const { data, error } = await sb.rpc("poll_results", { p_poll: poll }); fail(error); return data; },
    async castVote(poll, opcion, phone) { const { data, error } = await sb.rpc("cast_vote", { p_poll: poll, p_opcion: opcion, p_phone: phone }); fail(error); return data; },
    async listReviews() { const { data, error } = await sb.from("reviews").select("*").order("created_at", { ascending: false }).limit(100); fail(error); return data; },
    async setReviewEstado(id, estado) { const { error } = await sb.from("reviews").update({ estado }).eq("id", id); fail(error); },
    async addStamps(phone, nombre, delta, motivo) { const { data, error } = await sb.rpc("add_stamps", { p_phone: phone, p_nombre: nombre || null, p_delta: delta, p_motivo: motivo || null }); fail(error); return data; },
    async redeem(phone) { const { data, error } = await sb.rpc("redeem_reward", { p_phone: phone }); fail(error); return data; },
    async findCustomer(phone) {
      const ph = normPhone(phone); if (!ph) throw new Error("Número de celular inválido");
      const [c, e, o] = await Promise.all([
        sb.from("customers").select("*").eq("phone", ph).maybeSingle(),
        sb.from("stamp_events").select("*").eq("phone", ph).order("created_at", { ascending: false }).limit(30),
        sb.from("orders").select("*").eq("phone", ph).order("created_at", { ascending: false }).limit(10),
      ]);
      fail(c.error); fail(e.error); fail(o.error);
      return { phone: ph, customer: c.data, events: e.data, orders: o.data };
    },
    async listCustomers() { const { data, error } = await sb.from("customers").select("*").order("updated_at", { ascending: false }).limit(40); fail(error); return data; },
    async saveProduct(p) {
      const row = { ...p, updated_at: new Date().toISOString() };
      const { data, error } = await sb.from("products").upsert(row).select().single(); fail(error); return data;
    },
    async deleteProduct(id) { const { error } = await sb.from("products").delete().eq("id", id); fail(error); },
    async saveSetting(key, value) { const { error } = await sb.from("settings").upsert({ key, value, updated_at: new Date().toISOString() }); fail(error); },
    async uploadMedia(file, id) {
      const ext = ((file.name || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || (file.type.includes("webm") ? "webm" : "mp4");
      const path = `${id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("productos").upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      fail(error);
      return sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    },
    async uploadPhoto(blob, id) {
      const ext = (blob.type || "").includes("webp") ? "webp" : "jpg";
      const path = `${id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("productos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true });
      fail(error);
      return sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    },
    onOrders(cb) {
      sb.channel("orders-live").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => cb()).subscribe();
    },
  };

  window.SettoAPI = Object.assign({ DEMO, normPhone, prettyPhone, dropEstado }, DEMO ? demo : live);
})();
