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
  function prettyPhone(p) {
    const d = normPhone(p) || String(p || "");
    if (d.length !== 13) return d;
    return `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}`;
  }

  const fail = (error) => { if (error) throw new Error(cleanMsg(error.message || String(error))); };
  const cleanMsg = (m) => String(m).replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");

  /* =================== MODO DEMO =================== */
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
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio: elegido }) {
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
          if (pr.categoria === "especial" && esp.estado !== "disponible") throw new Error(pr.nombre + " no está disponible ahora");
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
      let code; do { code = "STT-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"); }
      while (db.orders.some((o) => o.code === code && o.status === "pendiente"));
      const o = { id: uid(), code, nombre: String(nombre).trim(), phone: ph, items: lines, total, retiro, pago, nota: nota || null, status: "pendiente", sellos: 0, created_at: new Date().toISOString(),
        modo, direccion: modo === "envio" ? String(direccion).trim() : null, premio, premio_txt: ptxt };
      o.etapa = "recibido"; o.track = uid().replace(/-/g, ""); db.orders.unshift(o); dbSave(db);
      return { id: o.id, code, total, items: lines, phone: ph, modo, direccion: o.direccion, costo_envio: costo, premio, premio_txt: ptxt, descuento: off, meta };
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
      o.status = "cancelado"; o.closed_at = new Date().toISOString(); dbSave(db);
    },
    async setEtapa(id, etapa) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o || o.status !== "pendiente") throw new Error("El pedido no está pendiente"); o.etapa = etapa; dbSave(db); },
    async orderStatus(codes, phone) {
      const db = dbLoad(), ph = normPhone(phone), since = Date.now() - 3 * 864e5;
      return db.orders.filter((o) => o.phone === ph && codes.includes(o.code) && new Date(o.created_at) > since)
        .map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, resena: (db.reviews || []).some((r) => r.order_id === o.id) }));
    },
    async trackStatus(tracks) {
      const db = dbLoad();
      return db.orders.filter((o) => o.track && tracks.includes(o.track)).map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, phone: o.phone, resena: (db.reviews || []).some((r) => r.order_id === o.id) }));
    },
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
      const o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "entregado");
      if (!o) throw new Error("Solo podés dejar reseña de un pedido que ya recibiste");
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
    async publicReviewsAll(offset = 0) {
      const db = dbLoad(), ok = (db.reviews || []).filter((r) => r.estado === "aprobada"), por = {};
      ok.forEach((r) => (por[r.rating] = (por[r.rating] || 0) + 1));
      const nom = (n) => { const [a, b] = String(n).trim().split(/\s+/); return a.charAt(0).toUpperCase() + a.slice(1) + (b ? " " + b[0].toUpperCase() + "." : ""); };
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null, por_estrella: por,
        items: ok.slice(offset, offset + 50).map((r) => { const o = db.orders.find((x) => x.id === r.order_id) || { items: [] };
          return { nombre: nom(r.nombre), rating: r.rating, texto: r.texto, foto: r.foto, instagram: r.instagram, fecha: r.created_at, pedido: [...new Set(o.items.filter((i) => !["envio", "premio"].includes(i.id)).map((i) => i.nombre))] }; }) };
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
    onOrders(cb) { window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); }); },
    resetDemo() { localStorage.removeItem(KEY); },
  };

  /* =================== SUPABASE =================== */
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
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio }) {
      const { data, error } = await sb.rpc("create_order_v4", {
        p_nombre: nombre, p_phone: phone, p_items: items.map((i) => ({ id: i.id, size: i.size || null, qty: i.qty, leche: i.leche || null, sin: i.sin || [] })),
        p_retiro: retiro, p_pago: pago, p_nota: nota || null, p_modo: modo || "retiro", p_direccion: direccion || null, p_premio: premio || null,
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
    async setEtapa(id, etapa) { const { error } = await sb.rpc("set_order_etapa", { p_id: id, p_etapa: etapa }); fail(error); },
    async orderStatus(codes, phone) { const { data, error } = await sb.rpc("get_order_status", { p_codes: codes, p_phone: phone }); fail(error); return data || []; },
    async trackStatus(tracks) { const { data, error } = await sb.rpc("track_status", { p_tracks: tracks }); fail(error); return data || []; },
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
    async publicReviewsAll(offset = 0) { const { data, error } = await sb.rpc("public_reviews_all", { p_offset: offset }); fail(error); return data; },
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

  window.SettoAPI = Object.assign({ DEMO, normPhone, prettyPhone }, DEMO ? demo : live);
})();
