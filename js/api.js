/*
  Capa de datos de Setto.
  - Con Supabase configurado (js/config.js) habla con la base real.
  - Sin configurar, usa MODO DEMO: guarda todo en este navegador (localStorage).
  El sitio público y el panel usan las mismas funciones.
*/
(function () {
  const cfg = window.SETTO_CONFIG || {};
  // ?prueba en una vista previa de Vercel (o en la compu): modo demo para probar sin tocar la base real. Queda prendido en esa pestaña.
  const PRUEBA = (() => {
    try {
      const h = location.hostname; if (!/-git-.+\.vercel\.app$/.test(h) && h !== "localhost" && h !== "127.0.0.1") return false;
      const q = new URLSearchParams(location.search);
      if (q.has("prueba")) sessionStorage.setItem("setto-prueba", q.get("prueba") === "no" ? "" : "1");
      return sessionStorage.getItem("setto-prueba") === "1";
    } catch (_) { return false; }
  })();
  const DEMO = PRUEBA || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase;
  /* Lecturas y RPC con tiempo límite: con una red móvil mala un pedido colgado dejaba la carta "cargando" para siempre.
     Las subidas de fotos (storage) no tienen límite. */
  const conLimite = (url, opts = {}) => {
    if (!/\/rest\/v1\//.test(String(url && url.url || url)) || opts.signal || !window.AbortController) return fetch(url, opts);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
    return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
  };
  // la web pública no inicia sesión: sin el candado de sesión del navegador (en algunos navegadores internos de apps se traba y frena todas las consultas)
  const PUBLICA = !/^\/panel/.test(location.pathname);
  const sb = DEMO ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    global: { fetch: conLimite },
    auth: PUBLICA ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, lock: (_n, _t, fn) => fn() } : {},
  });

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

  // llama una Edge Function y devuelve su mensaje de error tal cual (ej. "Faltan las credenciales…")
  async function fn(nombre, body) {
    const { data, error } = await sb.functions.invoke(nombre, { body });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (_) {} throw new Error(m); }
    return data;
  }
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
  // reseñas: primero las que tienen número de orden (Panel → Reseñas), después de la más nueva a la más vieja (igual que la base)
  const ordenRv = (l) => l.slice().sort((a, b) => (a.orden || 1e9) - (b.orden || 1e9) || String(b.created_at).localeCompare(String(a.created_at)));

  /* maquinita en modo demo */
  const MAQ_DEF = [["gift", "Gift card $10.000", 0.1, "monto", 10000], ["mochi", "Mochi gratis", 0.5, "mochi", 0], ["off", "10% off", 2, "porcentaje", 10], ["extra", null, 0, "porcentaje", 0]];
  function maqPremiosCfg(cfg) {
    return MAQ_DEF.map(([id, titulo, chance, tipo, valor]) => {
      const c = Array.isArray(cfg.premios) ? cfg.premios.find((x) => x.id === id) : null;
      if (!c) return { id, titulo, chance, tipo, valor };
      const tp = c.tipo || tipo, vl = c.valor != null ? Math.max(0, +c.valor || 0) : valor;
      return { id, titulo: String(c.titulo || "").trim() || null, chance: c.activo === false || (tp !== "mochi" && !vl) ? 0 : Math.max(0, +c.chance || 0), tipo: tp, valor: vl };
    });
  }
  const MAQ_VENCE = 48 * 3600e3; // el premio dura 48 hs (migración 040)
  const maqVigente = (x) => !x.vence_at || new Date(x.vence_at) > new Date();
  const maqPub = (x) => ({ code: x.code, titulo: x.titulo, tipo: x.tipo, valor: x.valor, saldo: x.saldo, vence_at: x.vence_at || null });
  const maqDia = (db) => Math.max(1, Math.min(5, Math.round(+(db.settings.maquinita || {}).fichas_dia || 1)));
  // sello de regalo por la reseña de la primera compra (mismas reglas que dar_sello_resena en la base)
  function selloResena(db, o) {
    const club = db.settings.club || {}; db.sellos_resena = db.sellos_resena || [];
    if (club.activo === false || club.sello_resena === false || !o || o.status !== "entregado" || !o.primera_compra) return;
    const r = (db.reviews || []).find((x) => x.order_id === o.id);
    if (!r || r.estado === "oculta" || (String(r.texto || "").trim().length < 10 && !r.foto)) return;
    if (db.sellos_resena.some((x) => x.phone === o.phone || x.order_id === o.id)) return;
    db.sellos_resena.push({ phone: o.phone, order_id: o.id });
    let c = db.customers.find((x) => x.phone === o.phone);
    if (!c) { c = { phone: o.phone, nombre: o.nombre, sellos: 0, canjes: 0, created_at: new Date().toISOString() }; db.customers.push(c); }
    c.sellos += 1; db.events.unshift({ phone: o.phone, delta: 1, motivo: "Reseña de " + o.code + " (primera compra)", created_at: new Date().toISOString() });
  }
  // códigos de descuento (migración 053): mismas reglas que promo_problema() de la base
  const promoCod = (db, code) => (db.promo_codigos || []).find((x) => x.code === String(code || "").trim().toUpperCase());
  const promoVence = (c, p) => [c.vence_at, p.vence_at].filter(Boolean).sort()[0] || null;
  const promoPub = (c, p, error) => ({ code: c.code, titulo: p.titulo, tipo: p.tipo, valor: p.valor, regalo: p.regalo || null, tope: p.tope || 0, minimo: p.minimo || 0, acumula: !!p.acumula, vence_at: promoVence(c, p), requiere: p.requiere || null, requiere_nombre: p.requiere ? ((dbLoad().products || []).find((x) => x.id === p.requiere) || {}).nombre || null : null, desde_at: p.desde_at || null, personal: !!c.phone, error: error || null });
  function promoProblema(db, code, ph) {
    const c = promoCod(db, code); if (!c) return "No encontramos ese código. Revisá que esté bien escrito.";
    const p = (db.promos || []).find((x) => x.id === c.promo_id), usos = (db.promo_usos || []).filter((u) => u.promo_id === p.id && !u.devuelto), v = promoVence(c, p);
    if (p.activa === false) return "Este código ya no está activo.";
    if (p.desde_at && new Date(p.desde_at) > new Date()) return `Este código vale desde el ${new Date(p.desde_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} hs.`;
    if (v && new Date(v) <= new Date()) return `Este código venció el ${new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}.`;
    if (p.usos_max && usos.length >= p.usos_max) return "Este código ya se usó todas las veces posibles.";
    if (!ph) return null;
    if (c.phone && c.phone !== ph) return "Este código es personal: usalo con el celular al que te lo mandamos.";
    if (usos.filter((u) => u.phone === ph).length >= (p.por_cliente || 1)) return "Ya usaste este código" + (p.por_cliente > 1 ? ` las ${p.por_cliente} veces` : "") + ".";
    return null;
  }
  const selloResCampos = (db, o) => ({ primera: !!o.primera_compra && !(db.sellos_resena || []).some((x) => x.phone === o.phone && x.order_id !== o.id), sello_resena: (db.sellos_resena || []).some((x) => x.order_id === o.id) });
  function maqJug(db, ph) {
    db.maq = db.maq || { jug: {}, premios: [] }; db.maq.jug = db.maq.jug || {}; db.maq.premios = db.maq.premios || [];
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const j = db.maq.jug[ph] || (db.maq.jug[ph] = { fichas: 0, gratis_dia: hoy, gratis_usadas: 0 });
    if (j.gratis_dia !== hoy) { j.gratis_dia = hoy; j.gratis_usadas = 0; }
    return j;
  }
  function maqDev(db, dev) {
    db.maq = db.maq || { jug: {}, premios: [] }; db.maq.jug = db.maq.jug || {}; db.maq.premios = db.maq.premios || []; db.maq.dev = db.maq.dev || {};
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const d = db.maq.dev[dev] || (db.maq.dev[dev] = { gratis_dia: hoy, gratis_usadas: 0 });
    if (d.gratis_dia !== hoy) { d.gratis_dia = hoy; d.gratis_usadas = 0; }
    return d;
  }
  const demo = {
    async loadAll() { const db = dbLoad(); return { settings: db.settings, products: db.products }; },
    async getSetting(key) { return dbLoad().settings[key]; },
    // Dashboard: en modo demo solo hay pedidos web (la Caja necesita Supabase)
    async dashboard(desde) { return { orders: dbLoad().orders.filter((o) => new Date(o.created_at) >= desde), caja: null, stock: null }; },
    async maqStats() { return null; },
    async turnosOcupados() { // mismo cálculo que la función turnos_ocupados de Supabase
      const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, hoy = k(new Date()), cnt = {};
      dbLoad().orders.filter((o) => o.status === "pendiente" && (o.etapa || "recibido") !== "listo" && /· \d{1,2}:\d{2} hs$/.test(o.retiro || "")).forEach((o) => {
        const [dia, resto] = o.retiro.split(" · "), base = new Date(o.created_at); let f = null;
        if (dia === "Hoy") f = base; else if (dia === "Mañana") { f = new Date(base); f.setDate(f.getDate() + 1); }
        else { const n = +(dia.match(/(\d+)$/) || [])[1]; for (let i = 0; i < 7 && n; i++) { const g = new Date(base); g.setDate(g.getDate() + i); if (g.getDate() === n) { f = g; break; } } }
        if (!f || k(f) < hoy) return;
        const key = k(f) + "|" + resto.replace(" hs", "").padStart(5, "0"); cnt[key] = (cnt[key] || 0) + 1;
      });
      return Object.entries(cnt).map(([key, n]) => { const [f, h] = key.split("|"); return { f, h, n }; });
    },
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio: elegido, gift, maq, codigo }) {
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
        const conTam = pr.categoria === "set" || pr.categoria === "dirty" || (pr.categoria === "especial" && ["set", "dirty"].includes(pr.formato));
        if (conTam) {
          if (pr.categoria === "especial" && dropEstado(esp) !== "abierto") throw new Error(pr.nombre + " no está disponible ahora");
          size = it.size; price = size === "12 oz" ? pr.precio_12 : size === "16 oz" ? pr.precio_16 : null;
          if (!price) throw new Error("Falta elegir el tamaño de " + pr.nombre);
        } else {
          price = pr.precio; name = "Mochi " + pr.nombre;
          if (pr.categoria === "especial" && dropEstado(esp) !== "abierto") throw new Error(pr.nombre + " no está disponible ahora");
        }
        if (pr.agotado) throw new Error(pr.nombre + " está agotado");
        if (!(price > 0)) throw new Error(pr.nombre + " todavía no tiene precio");
        let leche = null, sin = [], det = null;
        if (conTam && pers.activo !== false) {
          leche = String(it.leche || "").trim() || null;
          if (leche) { const l = (pers.leches || []).find((x) => x.nombre === leche); if (!l) throw new Error("Esa leche ya no está disponible, elegí otra"); price += Math.max(0, Number(l.precio) || 0); if (Number(l.precio) > 0 || leche !== ((pers.leches || [])[0] || {}).nombre) det = leche; }
          for (const x of it.sin || []) { if (!(pers.sin || []).includes(x)) throw new Error("Opción no disponible: " + x); if (!sin.includes(x)) sin.push(x); }
          if (sin.length) det = [det, ...sin].filter(Boolean).join(" · ");
        }
        // set del Especial sin bebida fija: la bebida elegida tiene que ser una dirty activa del drop
        let bebida = null;
        if (pr.categoria === "especial" && pr.formato === "set" && !pr.set_bebida) {
          const bp = db.products.find((x) => x.id === it.bebida && x.categoria === "especial" && x.formato === "dirty" && x.activo !== false && !x.agotado);
          if (it.bebida && !bp) throw new Error("Esa bebida ya no está disponible, elegí otra");
          bebida = bp ? bp.id : null; det = [bp ? "Bebida: " + bp.nombre.trim() : "Bebida: a confirmar", det].filter(Boolean).join(" · ");
        }
        // promo (box): los sabores tienen que ser mochis de la carta visibles y sin agotar (igual que la migración 047)
        let mochis = null;
        if (pr.categoria === "promo") {
          const cant = pr.promo_cant || 5; name = pr.nombre.trim();
          if (!Array.isArray(it.mochis) || it.mochis.length !== cant) throw new Error(`Elegí los ${cant} mochis de ${name}`);
          const ms = it.mochis.map((id) => db.products.find((x) => x.id === id && x.categoria === "mochi" && x.activo !== false && !x.agotado));
          if (ms.some((m) => !m)) throw new Error(`Un sabor de ${name} ya no está disponible, elegí otro`);
          mochis = ms.map((m) => m.id); const c = new Map(); ms.forEach((m) => c.set(m.nombre.trim(), (c.get(m.nombre.trim()) || 0) + 1));
          det = [...c].map(([n, k]) => n + (k > 1 ? " ×" + k : "")).join(" · ");
        }
        total += price * qty;
        lines.push({ id: pr.id, nombre: name, size, qty, precio: price, subtotal: price * qty, leche, sin, detalle: det, bebida, mochis });
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
      // código de descuento: después del premio del Club y antes de la maquinita (igual que create_order_v7)
      let codOff = 0, pc = null, pp = null;
      if (codigo && String(codigo).trim()) {
        const err = promoProblema(db, codigo, ph); if (err) throw new Error(err);
        pc = promoCod(db, codigo); pp = db.promos.find((x) => x.id === pc.promo_id);
        if (!pp.acumula && (premio || (maq && String(maq).trim()))) throw new Error(`Este código no se suma con ${premio ? "el premio del Setto Club" : "el premio de la maquinita"}. Guardalo para tu próximo pedido.`);
        if (pp.requiere && !lines.some((l) => l.id === pp.requiere)) throw new Error(`Este código es para pedidos con ${(((db.products.find((p) => p.id === pp.requiere) || {}).nombre) || "un producto de la carta").trim()}. Sumalo al carrito.`);
        if (sub < (pp.minimo || 0)) throw new Error("Este código es para compras desde $" + Number(pp.minimo).toLocaleString("es-AR"));
        if (pp.tipo === "porcentaje") { codOff = Math.round((sub * pp.valor) / 100 / 10) * 10; if (pp.tope > 0) codOff = Math.min(codOff, pp.tope); }
        else if (pp.tipo === "monto") codOff = pp.valor;
        else if (pp.tipo === "regalo") {
          const ps = lines.filter((l) => { const pr = db.products.find((p) => p.id === l.id); return pr && (l.id !== pp.requiere || l.qty > 1) && (pp.regalo === "bebida" ? pr.categoria === "dirty" || (pr.categoria === "especial" && pr.formato === "dirty") : pr.categoria === "mochi" || (pr.categoria === "especial" && (pr.formato || "mochi") === "mochi")); }).map((l) => l.precio);
          if (!ps.length) throw new Error("Para usar este código agregá " + (pp.regalo === "bebida" ? "una bebida (dirty) al pedido" : "un mochi al pedido"));
          codOff = Math.min(...ps);
        } else { if (modo !== "envio") throw new Error("Este código es de envío gratis: elegí envío a domicilio"); codOff = costo; }
        codOff = Math.max(0, Math.min(codOff, Math.max(total, 0)));
        lines.push({ id: "codigo", nombre: `Código ${pc.code}: ${pp.titulo}`, size: null, qty: 1, precio: -codOff, subtotal: -codOff }); total -= codOff; pc.usos = (pc.usos || 0) + 1;
      }
      let maqOff = 0, mp = null;
      if (maq && String(maq).trim()) {
        mp = ((db.maq || {}).premios || []).find((x) => x.code === String(maq).trim().toUpperCase());
        if (!mp) throw new Error("No encontramos ese premio de la maquinita. Revisá el código.");
        if (mp.phone !== ph) throw new Error("Ese premio es de otro número: pedí con el celular que tiró en la maquinita");
        if (mp.estado !== "activo") throw new Error("Ese premio de la maquinita ya se usó");
        if (!maqVigente(mp)) throw new Error("Ese premio de la maquinita venció: duraba 48 hs");
        if (mp.tipo === "monto") maqOff = Math.min(mp.saldo, Math.max(total, 0));
        else if (mp.tipo === "porcentaje") maqOff = Math.min(Math.round((sub * mp.valor) / 100 / 10) * 10, Math.max(total, 0));
        else {
          const ms = lines.filter((l) => { const pr = db.products.find((p) => p.id === l.id); return pr && (pr.categoria === "mochi" || pr.categoria === "especial"); }).map((l) => l.precio);
          if (!ms.length) throw new Error("Para usar el mochi gratis agregá un mochi al pedido");
          maqOff = Math.min(Math.min(...ms), Math.max(total, 0));
        }
        if (maqOff > 0) { lines.push({ id: "maquinita", nombre: "Premio maquinita: " + mp.titulo, size: null, qty: 1, precio: -maqOff, subtotal: -maqOff }); total -= maqOff; }
        if (mp.tipo === "monto") { mp.saldo -= maqOff; if (mp.saldo <= 0) mp.estado = "usado"; } else mp.estado = "usado";
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
      if (mp) o.maq = { code: mp.code, monto: maqOff };
      if (pc) (db.promo_usos = db.promo_usos || []).push({ id: uid(), promo_id: pp.id, code: pc.code, order_id: o.id, phone: ph, monto: codOff, devuelto: false, created_at: new Date().toISOString() });
      o.primera_compra = !db.orders.some((x) => x.phone === ph && x.status !== "cancelado") && !(db.sellos_resena || []).some((x) => x.phone === ph);
      o.etapa = "recibido"; o.track = uid().replace(/-/g, ""); db.orders.unshift(o); dbSave(db);
      return { id: o.id, code, total, items: lines, phone: ph, modo, direccion: o.direccion, costo_envio: costo, premio, premio_txt: ptxt, descuento: off, gift: giftOff, maquinita: maqOff, codigo: codOff, meta };
    },
    async getStock() { return null; },
    async getCard(phone) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("El celular no parece válido");
      const c = db.customers.find((x) => x.phone === ph), club = db.settings.club || {};
      return { existe: !!c, sellos: c ? c.sellos : 0, canjes: c ? c.canjes : 0, meta: club.meta || 8, premio: club.premio || "" };
    },
    /* equipo */
    // maquinita (migración 034): misma regla que maq_tirar en la base. "forzar" solo existe en el demo, para probar premios.
    async maqEstado(phone) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá tu celular");
      const j = maqJug(db, ph); dbSave(db);
      return { gratis: Math.max(0, maqDia(db) - j.gratis_usadas), fichas: j.fichas, premios: (db.maq.premios || []).filter((x) => x.phone === ph && x.estado === "activo" && maqVigente(x)).map(maqPub) };
    },
    async maqTirar(phone, forzar) {
      const db = dbLoad(), ph = normPhone(phone), cfg = db.settings.maquinita || {};
      if (cfg.activo === false) throw new Error("La maquinita está apagada por ahora");
      if (!ph) throw new Error("Revisá tu celular");
      const j = maqJug(db, ph);
      if (j.gratis_usadas < maqDia(db)) j.gratis_usadas++;
      else if (j.fichas > 0) j.fichas--;
      else throw new Error("No te quedan fichas. Volvé mañana o sumá con tu próxima compra.");
      let x = Math.random() * 100, p = null;
      const prem = maqPremiosCfg(cfg).filter((q) => q.titulo && q.chance > 0);
      if (forzar) p = prem.find((q) => q.id === forzar) || null;
      else for (const q of prem) { if (x < q.chance) { p = q; break; } x -= q.chance; }
      let code = null;
      if (p) {
        code = "MAQ-" + Math.random().toString(16).slice(2, 6).toUpperCase() + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
        db.maq.premios.unshift({ code, phone: ph, premio_id: p.id, titulo: p.titulo, tipo: p.tipo, valor: p.valor, saldo: p.tipo === "monto" ? p.valor : 0, estado: "activo", created_at: new Date().toISOString() });
      }
      dbSave(db);
      return { resultado: p ? p.id : "nada", titulo: p ? p.titulo : null, code, gratis: Math.max(0, maqDia(db) - j.gratis_usadas), fichas: j.fichas };
    },
    // migración 036: la gratis del día va por dispositivo; las fichas de compra, por número; sin número el premio queda pendiente
    async maqEstado2(dev, phone) {
      const db = dbLoad(), ph = normPhone(phone), d = maqDev(db, dev); dbSave(db);
      const pend = db.maq.premios.find((x) => x.dev === dev && x.estado === "pendiente" && maqVigente(x));
      return { gratis: Math.max(0, maqDia(db) - d.gratis_usadas), fichas: ph && db.maq.jug[ph] ? db.maq.jug[ph].fichas : 0,
        premios: ph ? db.maq.premios.filter((x) => x.phone === ph && x.estado === "activo" && maqVigente(x)).map(maqPub) : [], pendiente: pend ? maqPub(pend) : null };
    },
    async maqTirar2(dev, phone, forzar) {
      const db = dbLoad(), ph = normPhone(phone), cfg = db.settings.maquinita || {};
      if (cfg.activo === false) throw new Error("La maquinita está apagada por ahora");
      const d = maqDev(db, dev);
      if (d.gratis_usadas < maqDia(db)) d.gratis_usadas++;
      else if (ph && db.maq.jug[ph] && db.maq.jug[ph].fichas > 0) db.maq.jug[ph].fichas--;
      else throw new Error("No te quedan fichas. Volvé mañana o sumá con tu próxima compra.");
      let x = Math.random() * 100, p = null;
      const prem = maqPremiosCfg(cfg).filter((q) => q.titulo && q.chance > 0);
      if (forzar) p = prem.find((q) => q.id === forzar) || null;
      else for (const q of prem) { if (x < q.chance) { p = q; break; } x -= q.chance; }
      let code = null;
      if (p) {
        code = "MAQ-" + Math.random().toString(16).slice(2, 6).toUpperCase() + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
        db.maq.premios.unshift({ code, phone: ph || null, dev, premio_id: p.id, titulo: p.titulo, tipo: p.tipo, valor: p.valor, saldo: p.tipo === "monto" ? p.valor : 0, estado: ph ? "activo" : "pendiente", created_at: new Date().toISOString(), vence_at: new Date(Date.now() + MAQ_VENCE).toISOString() });
      }
      dbSave(db);
      return { resultado: p ? p.id : "nada", titulo: p ? p.titulo : null, code: ph ? code : null, pendiente: !!p && !ph, gratis: Math.max(0, maqDia(db) - d.gratis_usadas), fichas: ph && db.maq.jug[ph] ? db.maq.jug[ph].fichas : 0 };
    },
    async maqReclamar(dev, phone) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá tu celular");
      const ms = ((db.maq || {}).premios || []).filter((x) => x.dev === dev && x.estado === "pendiente" && maqVigente(x)), m = ms[0]; if (!m) throw new Error("No encontramos un premio para guardar (duran 48 hs)");
      ms.forEach((x) => Object.assign(x, { phone: ph, estado: "activo" })); maqJug(db, ph); dbSave(db);
      return maqPub(m);
    },
    async maqPremioCheck(code, phone) {
      const ph = normPhone(phone), x = ((dbLoad().maq || {}).premios || []).find((q) => q.code === String(code).trim().toUpperCase() && q.phone === ph);
      return x ? { ...maqPub(x), estado: x.estado === "activo" && !maqVigente(x) ? "vencido" : x.estado } : null;
    },
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
      const mcfg = db.settings.maquinita || {}, nf = Math.max(0, Math.min(50, mcfg.fichas_compra ?? 5));
      if (mcfg.activo !== false && nf > 0) { const j = maqJug(db, ph); j.fichas += nf; }
      selloResena(db, o);
      dbSave(db); return { phone: ph, sellos: c.sellos, canje, premio: club.premio };
    },
    async cancelOrder(id) {
      const db = dbLoad(), o = db.orders.find((x) => x.id === id);
      if (!o || o.status !== "pendiente") throw new Error("El pedido no está pendiente");
      o.status = "cancelado"; o.closed_at = new Date().toISOString();
      if (o.gift && !o.gift.devuelto) { const g = (db.giftcards || []).find((x) => x.code === o.gift.code); if (g) { g.saldo += o.gift.monto; g.estado = "activa"; } o.gift.devuelto = true; }
      if (o.maq && !o.maq.devuelto) { const m = ((db.maq || {}).premios || []).find((x) => x.code === o.maq.code); if (m) { if (m.tipo === "monto") m.saldo += o.maq.monto; m.estado = "activo"; } o.maq.devuelto = true; }
      (db.promo_usos || []).filter((u) => u.order_id === o.id && !u.devuelto).forEach((u) => { u.devuelto = true; const c = promoCod(db, u.code); if (c) c.usos = Math.max(0, (c.usos || 0) - 1); }); dbSave(db);
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
    async marcarPagado(id, pagado) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o) throw new Error("No encontramos ese pedido"); o.pagado_at = pagado ? o.pagado_at || new Date().toISOString() : null; dbSave(db); return o.pagado_at; },
    async setPago(id, pago) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o || o.status === "cancelado") throw new Error("Ese pedido ya no se puede cambiar"); o.pago = String(pago).trim().slice(0, 60); dbSave(db); return { pago: o.pago, caja: false }; },
    async usarNumeroWa(id) { const db = dbLoad(), o = db.orders.find((x) => x.id === id); if (!o || o.status !== "pendiente" || !o.wa_phone) throw new Error("El pedido ya no está pendiente o no tiene otro número"); o.phone = o.wa_phone; o.wa_phone = null; dbSave(db); return o.phone; },
    // consentimientos de marketing (migración 030): historial; vale la última fila por celular y canal
    async registrarConsentimiento(code, phone, canales, version) {
      const db = dbLoad(), ph = normPhone(phone), o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "pendiente"); if (!o) return;
      db.consents = db.consents || [];
      canales.filter((c) => ["whatsapp", "meta_ads"].includes(c) && !demoPuede(db, ph, c)).forEach((c) => db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "otorgado", origen: "checkout_web", aviso_version: version, order_id: o.id, created_at: new Date().toISOString() }));
      dbSave(db);
    },
    // casilla opcional de la maquinita (migración 035): sin pedido, solo con el celular
    async consentimientoMaquinita(phone, version) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá tu celular");
      db.consents = db.consents || [];
      if (!demoPuede(db, ph, "whatsapp")) db.consents.unshift({ phone: ph, canal: "whatsapp", finalidad: "novedades", estado: "otorgado", origen: "maquinita", aviso_version: version, created_at: new Date().toISOString() });
      dbSave(db);
    },
    // casillas del canje de la maquinita (migración 040): solo para el número que guardó un premio de este dispositivo
    async consentimientoMaquinita2(dev, phone, canales, version) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá tu celular");
      if (!((db.maq || {}).premios || []).some((x) => x.dev === dev && x.phone === ph)) return;
      db.consents = db.consents || [];
      canales.filter((c) => ["whatsapp", "meta_ads"].includes(c) && !demoPuede(db, ph, c)).forEach((c) => db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "otorgado", origen: "maquinita", aviso_version: version, created_at: new Date().toISOString() }));
      dbSave(db);
    },
    // solo demo: fichas de prueba para este dispositivo
    async maqSumarDemo(dev, n) { const db = dbLoad(), d = maqDev(db, dev); d.gratis_usadas -= n; dbSave(db); },
    // el equipo anota que el cliente aceptó (migración 050). Si se había dado de baja, no se toca: tiene que escribir ALTA
    async consentimientoPanel(phone, canales) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Número de celular inválido");
      db.consents = db.consents || []; const ok = [], baja = [];
      canales.filter((c) => ["whatsapp", "meta_ads"].includes(c)).forEach((c) => {
        const u = db.consents.find((x) => x.phone === ph && x.canal === c);
        if (u && u.estado === "otorgado") return; if (u) { baja.push(c); return; }
        db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "otorgado", origen: "panel", aviso_version: "panel-dicho", created_at: new Date().toISOString() }); ok.push(c);
      });
      dbSave(db); return { phone: ph, otorgados: ok, dados_de_baja: baja };
    },
    async bajaMarketing(phone, canal) {
      const db = dbLoad(), ph = normPhone(phone); if (!ph) throw new Error("Revisá el número: código de área + número, por ejemplo 223 347-1277.");
      db.consents = db.consents || [];
      ["whatsapp", "meta_ads"].filter((c) => (!canal || canal === c) && demoPuede(db, ph, c)).forEach((c) => db.consents.unshift({ phone: ph, canal: c, finalidad: c === "whatsapp" ? "novedades" : "publicidad", estado: "revocado", origen: sessionStorage.getItem("setto-demo-staff") ? "panel" : "preferencias_web", created_at: new Date().toISOString() }));
      dbSave(db);
    },
    async registrarOrigen(code, phone, origen) {
      const db = dbLoad(), ph = normPhone(phone), o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "pendiente"); if (!o || o.origen) return;
      const f = origen.first || {}, l = origen.last || {};
      Object.assign(o, { origen, first_touch_source: f.source, first_touch_campaign: f.campaign, last_touch_source: l.source, last_touch_campaign: l.campaign, landing_page: l.landing || f.landing, fbclid: l.fbclid || f.fbclid || null }); dbSave(db);
    },
    async crmCliente(phone) {
      const db = dbLoad(), ph = normPhone(phone), all = db.orders.filter((o) => o.phone === ph), ent = all.filter((o) => o.status === "entregado");
      const q = {}; ent.forEach((o) => (o.items || []).forEach((i) => { if (i.id && i.id !== "gift") q[i.id] = { id: i.id, nombre: i.nombre, qty: ((q[i.id] || {}).qty || 0) + (i.qty || 1) }; }));
      const pri = all.filter((o) => o.first_touch_source).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] || {}, ult = all.filter((o) => o.last_touch_source).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || {};
      return { phone: ph, compras: ent.length, total_gastado: ent.reduce((s, o) => s + (o.total || 0), 0), primera_compra: ent.map((o) => o.created_at).sort()[0] || null, ultima_compra: ent.map((o) => o.created_at).sort().pop() || null,
        favoritos: Object.values(q).sort((a, b) => b.qty - a.qty).slice(0, 3), first_touch_source: pri.first_touch_source || null, first_touch_campaign: pri.first_touch_campaign || null, last_touch_source: ult.last_touch_source || null, last_touch_campaign: ult.last_touch_campaign || null };
    },
    // campañas y Meta (migración 032): en modo demo se pueden armar borradores, pero no se manda nada
    async segmentosResumen() { const db = dbLoad(), z = { whatsapp: 0, meta_ads: 0 }; return { nuevos: z, recurrentes: z, fans_mochis: z, bebidas: z, inactivos: z, todos: z, clientes: db.customers.length }; },
    async listCampaigns() { return (dbLoad().campaigns || []).slice(0, 20); },
    async createCampaign(c) { const db = dbLoad(); db.campaigns = db.campaigns || []; const n = { id: "c" + Date.now(), estado: "borrador", total: 0, enviados: 0, fallidos: 0, created_at: new Date().toISOString(), ...c }; db.campaigns.unshift(n); dbSave(db); return n; },
    async updateCampaign(id, c) { const db = dbLoad(), x = (db.campaigns || []).find((y) => y.id === id); if (!x || x.estado !== "borrador") throw new Error("Esta campaña ya se mandó: no se puede editar"); Object.assign(x, c); dbSave(db); return x; },
    async deleteCampaign(id) { const db = dbLoad(), x = (db.campaigns || []).find((y) => y.id === id); if (!x || x.estado !== "borrador") throw new Error("Esta campaña ya se mandó: no se puede borrar"); db.campaigns = db.campaigns.filter((y) => y.id !== id); dbSave(db); },
    async sendCampaign() { throw new Error("En modo demo no se mandan mensajes de WhatsApp"); },
    // códigos de descuento (migración 053)
    async promoCheck(code, phone) { const db = dbLoad(), c = promoCod(db, code), err = promoProblema(db, code, normPhone(phone)); return c ? promoPub(c, db.promos.find((x) => x.id === c.promo_id), err) : { error: err }; },
    async listPromos() { const db = dbLoad(); return { promos: db.promos || [], codigos: (db.promo_codigos || []).filter((c) => !c.campaign_id && !c.automation_id).slice(0, 200) }; },
    async createPromo(p, code) {
      const db = dbLoad(); db.promos = db.promos || []; db.promo_codigos = db.promo_codigos || [];
      if (code && promoCod(db, code)) throw new Error("Ese código ya existe: elegí otro");
      const n = { id: uid(), activa: true, created_at: new Date().toISOString(), por_cliente: 1, tope: 0, minimo: 0, prefijo: "SETTO", ...p }; db.promos.unshift(n);
      if (code) db.promo_codigos.unshift({ code, promo_id: n.id, phone: null, usos: 0, vence_at: null, created_at: n.created_at });
      dbSave(db); return n;
    },
    async updatePromo(id, c) { const db = dbLoad(), p = (db.promos || []).find((x) => x.id === id); if (p) Object.assign(p, c); dbSave(db); return p; },
    async deletePromo(id) { const db = dbLoad(); if ((db.promo_usos || []).some((u) => u.promo_id === id)) throw new Error("Ya se usó en pedidos: pausala en vez de borrarla"); db.promos = db.promos.filter((x) => x.id !== id); db.promo_codigos = (db.promo_codigos || []).filter((x) => x.promo_id !== id); dbSave(db); },
    async promoCodigoNuevo(id, phone) {
      const db = dbLoad(), ph = normPhone(phone), p = (db.promos || []).find((x) => x.id === id); if (!ph) throw new Error("Revisá el celular"); if (!p) throw new Error("No encontramos esa promo");
      if (p.activa === false) throw new Error(`La promo "${p.nombre}" está pausada`);
      const ya = (db.promo_codigos || []).find((c) => c.promo_id === id && c.phone === ph && !c.usos && !c.campaign_id && !c.automation_id && (!c.vence_at || new Date(c.vence_at) > Date.now() + 864e5));
      if (ya) return { code: ya.code, vence_at: promoVence(ya, p), nuevo: false };
      const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let code; do { code = (p.prefijo || "SETTO") + "-" + Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join(""); } while (promoCod(db, code));
      const vence = p.dias ? [new Date(Date.now() + p.dias * 864e5).toISOString(), p.vence_at].filter(Boolean).sort()[0] : p.vence_at || null;
      db.promo_codigos.unshift({ code, promo_id: id, phone: ph, usos: 0, vence_at: vence, created_at: new Date().toISOString() }); dbSave(db);
      return { code, vence_at: vence, nuevo: true };
    },
    async promosResumen() {
      const db = dbLoad(), r = { promo: {}, campana: {}, automatica: {} };
      (db.promo_codigos || []).forEach((c) => { const x = (r.promo[c.promo_id] = r.promo[c.promo_id] || { codigos: 0, usados: 0, descontado: 0, entregados: 0, vendido: 0 }); x.codigos++; });
      (db.promo_usos || []).filter((u) => !u.devuelto).forEach((u) => { const x = r.promo[u.promo_id]; if (!x) return; const o = db.orders.find((y) => y.id === u.order_id); x.usados++; x.descontado += u.monto; if (o && o.status === "entregado") { x.entregados++; x.vendido += o.total; } });
      return r;
    },
    // plantillas de WhatsApp (Edge Function whatsapp-plantillas): en modo demo quedan "en revisión" en este navegador
    async listTemplates() { const db = dbLoad(); return db.templates || (db.templates = [{ nombre: "aviso_drop", idioma: "es_AR", estado: "APPROVED", categoria: "MARKETING", motivo: null, encabezado: "", pie: "",
      cuerpo: "Hola {{1}}, ya salió {{2}} de Setto, como te avisamos. Pedila en la web mientras dure el stock.", ejemplos: ["Isa", "la edición Halloween"],
      botones: [{ tipo: "QUICK_REPLY", texto: "No quiero más avisos" }, { tipo: "URL", texto: "Ver la edición" }] }]); },
    // campañas automáticas (migración 051): en modo demo se arman y se prenden, pero no sale nada
    async listAutomations() { return dbLoad().automations || []; },
    async createAutomation(a) { const db = dbLoad(); db.automations = db.automations || []; const n = { id: "a" + Date.now(), activa: false, created_at: new Date().toISOString(), ...a }; db.automations.unshift(n); dbSave(db); return n; },
    async updateAutomation(id, c) { const db = dbLoad(); const a = (db.automations || []).find((x) => x.id === id); if (a) Object.assign(a, c, c.activa && !a.activa ? { activa_desde: new Date().toISOString() } : {}); dbSave(db); return a; },
    async deleteAutomation(id) { const db = dbLoad(); db.automations = (db.automations || []).filter((x) => x.id !== id); dbSave(db); },
    async automationsResumen() { return {}; },
    async testAutomation() { throw new Error("En modo demo no se mandan mensajes de WhatsApp"); },
    async waGasto(atras) { return atras ? { moneda: "USD", total: 0, volumen: 0, gratis: 0, categorias: {}, dias: [] } : { moneda: "USD", total: 0.64, volumen: 23, gratis: 15, demo: true,
      categorias: { MARKETING: { volumen: 8, costo: 0.64 }, SERVICE: { volumen: 12, costo: 0 }, UTILITY: { volumen: 3, costo: 0 } },
      dias: [{ fecha: "2026-10-27", volumen: 9, costo: 0.24 }, { fecha: "2026-10-28", volumen: 6, costo: 0.16 }, { fecha: "2026-10-29", volumen: 8, costo: 0.24 }] }; },
    async createTemplate(p) { const db = dbLoad(); const l = await this.listTemplates(); if (l.some((t) => t.nombre === p.nombre)) throw new Error("Ya hay una plantilla con ese nombre. Usá otro (por ejemplo, sumale _v2)");
      db.templates = [{ nombre: p.nombre, idioma: p.idioma || "es_AR", estado: "PENDING", categoria: "MARKETING", motivo: null, ...window.SettoPlantillas.desdeEditor(p) }, ...l]; dbSave(db); return { ok: true, estado: "PENDING" }; },
    async syncAudiencias() { throw new Error("En modo demo no hay conexión con Meta"); },
    async crmActividad() { return { mensajes: [], sync: [] }; },
    async consentimientos(phone) { const ph = normPhone(phone); return (dbLoad().consents || []).filter((x) => x.phone === ph); },
    async marcarContacto(code, phone) { const db = dbLoad(), ph = normPhone(phone), o = db.orders.find((x) => x.code === code && x.phone === ph && x.status === "pendiente"); if (o && !o.contacto_at) { o.contacto_at = new Date().toISOString(); dbSave(db); } },
    onTrack(tracks, cb) { if (this._trk) return; this._trk = 1; window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); }); },
    async orderStatus(codes, phone) {
      const db = dbLoad(), ph = normPhone(phone), since = Date.now() - 3 * 864e5;
      return db.orders.filter((o) => o.phone === ph && codes.includes(o.code) && new Date(o.created_at) > since)
        .map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, cambio: o.cambio ? { estado: o.cambio.estado, resolucion: o.cambio.resolucion } : null, resena: (db.reviews || []).some((r) => r.order_id === o.id), ...selloResCampos(db, o) }));
    },
    async buscarPedido(phone, code) {
      const db = dbLoad(), ph = normPhone(phone), since = Date.now() - 2 * 864e5;
      return db.orders.filter((o) => o.status === "pendiente" && new Date(o.created_at) > since && (code ? o.code === code : ph && o.phone === ph)).slice(-3).reverse()
        .map((o) => ({ code: code ? o.code : "STT-••" + o.code.slice(-2), etapa: o.etapa || "recibido", modo: o.modo, created_at: o.created_at }));
    },
    async trackStatus(tracks) {
      const db = dbLoad();
      return db.orders.filter((o) => o.track && tracks.includes(o.track)).map((o) => ({ code: o.code, status: o.status, etapa: o.etapa || "recibido", modo: o.modo, retiro: o.retiro, total: o.total, created_at: o.created_at, sellos: o.sellos || 0, track: o.track, phone: o.phone, cambio: o.cambio ? { estado: o.cambio.estado, resolucion: o.cambio.resolucion } : null, resena: (db.reviews || []).some((r) => r.order_id === o.id), ...selloResCampos(db, o) }));
    },
    async pushSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async pushDesuscribir() {},
    async dropSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async dropAnotarWa(tel, nombre) { const ph = normPhone(tel); if (!ph) throw new Error("Revisá el número: código de área + número, por ejemplo 223 347-1277."); if (!String(nombre || "").trim()) throw new Error("Poné tu nombre para el mensaje");
      const db = dbLoad(); db.drop_wa = (db.drop_wa || []).filter((x) => x.phone !== ph).concat({ phone: ph, nombre: String(nombre).trim().slice(0, 40) }); dbSave(db); },
    async dropDesanotarWa(tel) { const db = dbLoad(); db.drop_wa = (db.drop_wa || []).filter((x) => x.phone !== normPhone(tel)); dbSave(db); },
    async dropDesuscribir() {},
    async dropAvisos() { const n = (dbLoad().drop_wa || []).length; return { suscriptos: n, whatsapp: n, push: 0, avisado: null }; },
    async dropAvisar() { throw new Error("En modo demo no hay notificaciones"); },
    async equipoPushSuscribir() { throw new Error("En modo demo no hay notificaciones"); },
    async equipoPushDesuscribir() {},
    async equipoPushActivo() { return false; },
    async equipoPushQuien() { return null; },
    async equipoSocios() { return []; },
    async createReviewTrack(track, rating, texto, foto, instagram) { const o = dbLoad().orders.find((x) => x.track === track); if (!o) throw new Error("No encontramos ese pedido"); return this.createReview(o.code, o.phone, rating, texto, foto, instagram); },
    async uploadReviewPhoto(blob) { return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); },
    async productRatings() {
      const db = dbLoad(), out = {};
      (db.reviews || []).filter((r) => r.estado === "aprobada").forEach((r) => { const o = db.orders.find((x) => x.id === r.order_id); if (!o) return;
        [...new Set(o.items.filter((i) => !["envio", "premio", "maquinita", "gift", "codigo"].includes(i.id)).map((i) => i.id))].forEach((id) => { const a = (out[id] = out[id] || { s: 0, cantidad: 0 }); a.s += r.rating; a.cantidad++; }); });
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
      db.reviews.unshift({ id: uid(), order_id: o.id, phone: ph, nombre: o.nombre, rating, texto: String(texto || "").trim() || null, foto: foto || null, instagram: ig.toLowerCase() || null, estado: "aprobada", revisada: false, created_at: new Date().toISOString() }); selloResena(db, o); dbSave(db);
    },
    async publicReviews() {
      const ok = ordenRv(dbLoad().reviews || []).filter((r) => r.estado === "aprobada");
      const nom = (n) => { const [a, b] = String(n).trim().split(/\s+/); return a.charAt(0).toUpperCase() + a.slice(1) + (b ? " " + b[0].toUpperCase() + "." : ""); };
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null,
        items: ok.filter((r) => r.texto || r.foto).slice(0, 12).map((r) => { const o = dbLoad().orders.find((x) => x.id === r.order_id) || { items: [] };
          return { nombre: nom(r.nombre), rating: r.rating, texto: r.texto, foto: r.foto, instagram: r.instagram, fecha: r.created_at, pedido: [...new Set(o.items.filter((i) => !["envio", "premio", "maquinita", "gift", "codigo"].includes(i.id)).map((i) => i.nombre))] }; }) };
    },
    async listReviews() { return ordenRv(dbLoad().reviews || []).slice(0, 100); },
    async setReviewOrden(id, orden) { const db = dbLoad(), r = (db.reviews || []).find((x) => x.id === id); if (r) { r.orden = orden || null; dbSave(db); } },
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
      const db = dbLoad(), ok = ordenRv(db.reviews || []).filter((r) => r.estado === "aprobada"), por = {};
      ok.forEach((r) => (por[r.rating] = (por[r.rating] || 0) + 1));
      const nom = (n) => { const [a, b] = String(n).trim().split(/\s+/); return a.charAt(0).toUpperCase() + a.slice(1) + (b ? " " + b[0].toUpperCase() + "." : ""); };
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null, por_estrella: por,
        items: ok.slice(offset, offset + 50).map((r) => { const o = db.orders.find((x) => x.id === r.order_id) || { items: [] };
          return { nombre: nom(r.nombre), rating: r.rating, texto: r.texto, foto: r.foto, instagram: r.instagram, fecha: r.created_at, pedido: [...new Set(o.items.filter((i) => !["envio", "premio", "maquinita", "gift", "codigo"].includes(i.id)).map((i) => i.nombre))] }; }) };
    },
    async productReviews(id) {
      const db = dbLoad(), ok = (db.reviews || []).filter((r) => r.estado === "aprobada" && (db.orders.find((x) => x.id === r.order_id) || { items: [] }).items.some((i) => i.id === id)), por = {};
      ok.forEach((r) => (por[r.rating] = (por[r.rating] || 0) + 1));
      const all = await this.publicReviewsAll(0), keep = new Set(ok.map((r) => r.created_at));
      return { cantidad: ok.length, promedio: ok.length ? Math.round((ok.reduce((s, r) => s + r.rating, 0) / ok.length) * 10) / 10 : null, por_estrella: por, items: all.items.filter((x) => keep.has(x.fecha)).slice(0, 30) };
    },
    async setReviewEstado(id, estado) { const db = dbLoad(), r = (db.reviews || []).find((x) => x.id === id); if (r) { r.estado = estado; r.revisada = true; dbSave(db); } },
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
    // PedidosYa Envíos en modo demo: siempre simulado (mismas formas que la Edge Function pedidosya-envio)
    async pyaConfig() { const db = dbLoad(); return db.pya_cfg || { activo: false, simulado: true, prueba: true, nombre: "Setto", ciudad: "Mar del Plata", peso_kg: 1.5, volumen_cm3: 6000 }; },
    async savePyaConfig(c) { const db = dbLoad(); db.pya_cfg = { ...(db.pya_cfg || {}), ...c, simulado: true }; dbSave(db); },
    async pyaEnvio(accion, id, offerId) {
      const db = dbLoad(), o = db.orders.find((x) => x.id === id), c = db.pya_cfg || {}, now = Date.now(), iso = (m) => new Date(now + m * 60000).toISOString();
      if (!o) throw new Error("No encontramos el pedido");
      if (!c.activo) throw new Error("PedidosYa Envíos está apagado. Prendelo en Ajustes → PedidosYa Envíos");
      const e = o.pya || null, PASOS = ["CONFIRMED", "IN_PROGRESS", "PICKED_UP", "COMPLETED"];
      const hist = (st) => [...((e && e.historial) || []), { status: st, at: new Date(now).toISOString() }];
      if (accion === "cotizar") {
        if (!c.direccion || !c.telefono) throw new Error("Falta cargar la dirección y el teléfono de retiro en Ajustes → PedidosYa Envíos");
        if (e && e.estado === "confirmado") throw new Error("Este pedido ya tiene un envío pedido");
        const total = 2400 + ((o.direccion || "").length % 7) * 350;
        o.pya = { estado: "cotizado", simulado: true, prueba: !!c.prueba, estimate_id: "SIM-" + o.code, cotizado_at: iso(0),
          ofertas: [{ id: "SIM-EXP-" + o.code, modo: "EXPRESS", total, moneda: "ARS", desde: iso(30), hasta: iso(50), retiro: iso(12), limite: iso(10) }] };
      } else if (!e) throw new Error("Primero cotizá el envío");
      else if (accion === "confirmar") {
        const of = (e.ofertas || []).find((x) => x.id === offerId) || (e.ofertas || [])[0];
        o.pya = { ...e, estado: "confirmado", offer_id: of.id, precio: of.total, moneda: of.moneda, desde: of.desde, hasta: of.hasta, confirmado_at: iso(0),
          shipping_id: "SIM-" + o.code, codigo: String(100000 + (parseInt(o.code.replace(/\D/g, "") || "0", 10) % 900000)), status: "CONFIRMED", historial: hist("CONFIRMED"), actualizado: iso(0) };
      } else if (accion === "estado") {
        if (e.status !== "CANCELLED") { const st = PASOS[Math.min(3, Math.floor((now - Date.parse(e.confirmado_at)) / 120000))]; o.pya = { ...e, status: st, historial: st !== e.status ? hist(st) : e.historial, actualizado: iso(0) }; }
      } else if (accion === "cancelar") {
        if (["IN_PROGRESS", "NEAR_PICKUP", "PICKED_UP", "NEAR_DROPOFF"].includes(e.status)) throw new Error("El repartidor ya está en camino: para cancelar hay que hablar con soporte de PedidosYa");
        o.pya = e.estado === "cotizado" ? { ...e, estado: "cancelado" } : { ...e, estado: "cancelado", status: "CANCELLED", historial: hist("CANCELLED"), actualizado: iso(0) };
      }
      dbSave(db); return o.pya;
    },
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
      const arma = (filas, products) => { const settings = {}; filas.forEach((r) => (settings[r.key] = r.value)); return { settings, products }; };
      // primera carga: lo que ya pidió index.html en el <head>; si falló, se pide de nuevo acá
      const pre = window.SETTO_PRE; window.SETTO_PRE = null;
      if (pre) { try { const [filas, prods] = await Promise.all([pre.settings, pre.products]); return arma(filas, prods); } catch (_) {} }
      const [s, p] = await Promise.all([
        sb.from("settings").select("key,value"),
        sb.from("products").select("*").order("orden", { ascending: true }),
      ]);
      fail(s.error); fail(p.error);
      return arma(s.data, p.data);
    },
    // un ajuste suelto y fresco (los horarios pueden cambiar con la web abierta)
    async getSetting(key) { const { data, error } = await sb.from("settings").select("value").eq("key", key).maybeSingle(); fail(error); return data ? data.value : undefined; },
    // cuántos pedidos hay por turno (fecha + hora), sin datos de clientes; null si la función todavía no está en la base
    async turnosOcupados() { const { data, error } = await sb.rpc("turnos_ocupados"); return error ? null : data || []; },
    // Dashboard: pedidos web, entradas y gastos de la Caja y mochis vendidos (stock) desde un día. Si la Caja falla, sigue solo con los pedidos.
    async dashboard(desde) {
      const iso = desde.toISOString(), f = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`;
      const [o, m, c, s, it] = await Promise.all([
        sb.from("orders").select("id, code, phone, items, total, pago, modo, status, created_at").gte("created_at", iso).order("created_at").limit(3000),
        // con los productos de cada entrada (migración 048); si la base todavía no los tiene, sin ellos
        sb.from("caja_movimientos").select("fecha, tipo, monto, categoria_id, registro, items").in("tipo", ["entrada", "gasto"]).eq("estado", "activo").gte("fecha", f).limit(5000)
          .then((r) => (r.error ? sb.from("caja_movimientos").select("fecha, tipo, monto, categoria_id, registro").in("tipo", ["entrada", "gasto"]).eq("estado", "activo").gte("fecha", f).limit(5000) : r)),
        sb.from("caja_categorias").select("id, nombre"),
        sb.from("caja_stock_mov").select("item_id, delta, created_at").eq("motivo", "venta").eq("estado", "activo").gte("created_at", iso).limit(5000),
        sb.from("caja_stock_items").select("id, nombre"),
      ]);
      fail(o.error);
      return { orders: o.data || [], caja: m.error ? null : { movs: m.data || [], cats: c.data || [] }, stock: s.error ? null : { movs: s.data || [], items: it.data || [] } };
    },
    // Dashboard → Maquinita: todas las tiradas y premios (desde que arrancó). null si no hay acceso a las tablas.
    async maqStats() {
      const [t, p, u] = await Promise.all([
        sb.from("maq_tiradas").select("created_at, resultado, gratis, dev, phone").order("created_at").limit(20000),
        sb.from("maq_premios").select("id, titulo, estado, vence_at, created_at").limit(10000),
        sb.from("maq_premio_usos").select("premio_id, monto, devuelto").eq("devuelto", false).limit(10000),
      ]);
      if (t.error || p.error) return null;
      return { tiradas: t.data || [], premios: p.data || [], usos: u.error ? [] : u.data || [] };
    },
    async createOrder({ nombre, phone, items, retiro, pago, nota, modo, direccion, premio, gift, maq, codigo }) {
      // con código de descuento va por la v7 (migración 053); sin código, la v6 de siempre
      const { data, error } = await sb.rpc(codigo ? "create_order_v7" : "create_order_v6", {
        p_nombre: nombre, p_phone: phone, p_items: items.map((i) => ({ id: i.id, size: i.size || null, qty: i.qty, leche: i.leche || null, sin: i.sin || [], bebida: i.bebida || null, ...(i.mochis ? { mochis: i.mochis } : {}) })),
        p_retiro: retiro, p_pago: pago, p_nota: nota || null, p_modo: modo || "retiro", p_direccion: direccion || null, p_premio: premio || null, p_gift: gift || null, p_maq: maq || null,
        ...(codigo ? { p_codigo: codigo } : {}),
      });
      fail(error); return data;
    },
    async getCard(phone) { const { data, error } = await sb.rpc("get_card", { p_phone: phone }); fail(error); return data; },
    async maqEstado(phone) { const { data, error } = await sb.rpc("maq_estado", { p_phone: phone }); fail(error); return data; },
    async maqTirar(phone) { const { data, error } = await sb.rpc("maq_tirar", { p_phone: phone }); fail(error); return data; },
    async maqEstado2(dev, phone) { const { data, error } = await sb.rpc("maq_estado_v2", { p_dev: dev, p_phone: phone || null }); fail(error); return data; },
    async maqTirar2(dev, phone) { const { data, error } = await sb.rpc("maq_tirar_v2", { p_dev: dev, p_phone: phone || null }); fail(error); return data; },
    async maqReclamar(dev, phone) { const { data, error } = await sb.rpc("maq_reclamar", { p_dev: dev, p_phone: phone }); fail(error); return data; },
    async maqPremioCheck(code, phone) { const { data, error } = await sb.rpc("maq_premio_check", { p_code: code, p_phone: phone }); fail(error); return data; },
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
    // pagado o no: dato interno del equipo (migración 044)
    async marcarPagado(id, pagado) { const { data, error } = await sb.rpc("marcar_pagado", { p_id: id, p_pagado: !!pagado }); if (error && /marcar_pagado|function/i.test(error.message || "")) throw new Error("Falta activar “pagado” en Supabase (migración 044)"); fail(error); return data; },
    // corregir la forma de pago (llegó como tarjeta y pagaron por transferencia, etc.). Si ya estaba entregado,
    // el cobro de la Caja pasa a la cuenta que corresponde (efectivo o MP), igual que lo carga el trigger pedido_a_caja.
    async setPago(id, pago) {
      pago = String(pago).trim().slice(0, 60);
      const { data: o, error } = await sb.from("orders").update({ pago }).eq("id", id).neq("status", "cancelado").select("status, caja_mov_id").maybeSingle(); fail(error);
      if (!o) throw new Error("Ese pedido ya no se puede cambiar");
      if (o.status !== "entregado" || !o.caja_mov_id) return { pago, caja: false };
      const cuenta = /efectivo/i.test(pago) ? "efectivo" : "mp";
      const { data: m, error: e2 } = await sb.from("caja_movimientos").update({ cuenta_id: cuenta, editado_por: "Pedidos web" }).eq("id", o.caja_mov_id).eq("estado", "activo").neq("cuenta_id", cuenta).select("id"); fail(e2);
      return { pago, caja: !!(m && m.length), cuenta };
    },
    async usarNumeroWa(id) { const { data, error } = await sb.rpc("usar_numero_wa", { p_id: id }); fail(error); return data; },
    // el cliente abrió WhatsApp para mandar el pedido (migración 029; sin ella, no pasa nada)
    async marcarContacto(code, phone) { await sb.rpc("marcar_contacto", { p_code: code, p_phone: phone }); },
    // consentimientos de marketing (migración 030)
    async registrarConsentimiento(code, phone, canales, version) { const { error } = await sb.rpc("registrar_consentimiento", { p_code: code, p_phone: phone, p_canales: canales, p_version: version }); fail(error); },
    async consentimientoMaquinita(phone, version) { const { error } = await sb.rpc("consentimiento_maquinita", { p_phone: phone, p_version: version }); fail(error); },
    async consentimientoMaquinita2(dev, phone, canales, version) { const { error } = await sb.rpc("consentimiento_maquinita_v2", { p_dev: dev, p_phone: phone, p_canales: canales, p_version: version }); fail(error); },
    async consentimientoPanel(phone, canales) { const { data, error } = await sb.rpc("consentimiento_panel", { p_phone: phone, p_canales: canales }); fail(error); return data; },
    async bajaMarketing(phone, canal) { const { error } = await sb.rpc("baja_marketing", { p_phone: phone, p_canal: canal || null }); fail(error); },
    async registrarOrigen(code, phone, origen) { const { error } = await sb.rpc("registrar_origen", { p_code: code, p_phone: phone, p_origen: origen }); fail(error); },
    async crmCliente(phone) { const { data, error } = await sb.from("crm_clientes").select("*").eq("phone", normPhone(phone)).maybeSingle(); fail(error); return data; },
    async segmentosResumen() { const { data, error } = await sb.rpc("segmentos_resumen"); fail(error); return data; },
    async listCampaigns() { const { data, error } = await sb.from("marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(20); fail(error); return data || []; },
    async createCampaign(c) { const { data, error } = await sb.from("marketing_campaigns").insert({ ...c, estado: "borrador" }).select().single(); fail(error); return data; },
    // migración 055: solo borradores (una campaña mandada no se toca)
    async updateCampaign(id, c) {
      const { data, error } = await sb.from("marketing_campaigns").update(c).eq("id", id).eq("estado", "borrador").select();
      if (error && /permission|denied/i.test(error.message || "")) throw new Error("Falta activar editar campañas en Supabase (migración 055)");
      fail(error); if (!data || !data.length) throw new Error("Esta campaña ya se mandó o falta la migración 055: no se pudo editar"); return data[0];
    },
    async deleteCampaign(id) {
      const { data, error } = await sb.from("marketing_campaigns").delete().eq("id", id).eq("estado", "borrador").select("id");
      if (error && /permission|denied/i.test(error.message || "")) throw new Error("Falta activar borrar campañas en Supabase (migración 055)");
      fail(error); if (!data || !data.length) throw new Error("Esta campaña ya se mandó o falta la migración 055: no se pudo borrar");
    },
    // Edge Functions: las credenciales de Meta y WhatsApp viven solo ahí (secretos de Supabase)
    // la prueba viaja con el número normalizado (549223…), igual que en la base: así encuentra el nombre del cliente
    // códigos de descuento (migración 053)
    async promoCheck(code, phone) { const { data, error } = await sb.rpc("promo_check", { p_code: code, p_phone: phone || null }); fail(error); return data; },
    async listPromos() {
      const [p, c] = await Promise.all([sb.from("promos").select("*").order("created_at", { ascending: false }),
        sb.from("promo_codigos").select("code, promo_id, phone, usos, vence_at, created_at").is("campaign_id", null).is("automation_id", null).order("created_at", { ascending: false }).limit(200)]);
      if (p.error && /promos/.test(p.error.message || "")) throw new Error("Falta activar los códigos en Supabase (migración 053)");
      fail(p.error); fail(c.error); return { promos: p.data || [], codigos: c.data || [] };
    },
    async createPromo(p, code) {
      const { data, error } = await sb.from("promos").insert(p).select().single();
      if (error && /requiere|desde_at/.test(error.message || "")) throw new Error("Falta activar \"Solo con la compra de\" y \"Vale desde\" en Supabase (migración 054)");
      fail(error);
      if (code) {
        const r = await sb.from("promo_codigos").insert({ code, promo_id: data.id });
        if (r.error) { await sb.from("promos").delete().eq("id", data.id); throw new Error(/duplicate|unique/i.test(r.error.message || "") ? "Ese código ya existe: elegí otro" : cleanMsg(r.error.message)); }
      }
      return data;
    },
    async updatePromo(id, c) { const { data, error } = await sb.from("promos").update(c).eq("id", id).select().single(); fail(error); return data; },
    async deletePromo(id) { const { error } = await sb.from("promos").delete().eq("id", id); if (error && /foreign key|promo_usos/i.test(error.message || "")) throw new Error("Ya se usó en pedidos: pausala en vez de borrarla"); fail(error); },
    async promoCodigoNuevo(id, phone) { const { data, error } = await sb.rpc("promo_codigo_nuevo", { p_promo: id, p_phone: phone }); fail(error); return data; },
    async promosResumen() { const { data, error } = await sb.rpc("promos_resumen"); fail(error); return data || {}; },
    async sendCampaign(id, prueba) { return fn("whatsapp-campana", { campaign_id: id, prueba: prueba ? normPhone(prueba) || prueba : null }); },
    async listTemplates() { return (await fn("whatsapp-plantillas", { accion: "listar" })).plantillas || []; },
    async createTemplate(p) { return fn("whatsapp-plantillas", { accion: "crear", plantilla: p }); },
    async listAutomations() { const { data, error } = await sb.from("marketing_automations").select("*").order("created_at", { ascending: false }); fail(error); return data || []; },
    async createAutomation(a) { const { data, error } = await sb.from("marketing_automations").insert({ ...a, activa: false }).select().single(); fail(error); return data; },
    async updateAutomation(id, c) { const { data, error } = await sb.from("marketing_automations").update(c).eq("id", id).select().single(); fail(error); return data; },
    async deleteAutomation(id) { const { error } = await sb.from("marketing_automations").delete().eq("id", id); fail(error); },
    async automationsResumen() { const { data, error } = await sb.rpc("automaticas_resumen"); fail(error); return data || {}; },
    async waGasto(atras) { return fn("whatsapp-plantillas", { accion: "gasto", atras: atras || 0 }); },
    async testAutomation(id, prueba) { return fn("whatsapp-automaticas", { automation_id: id, prueba: normPhone(prueba) || prueba }); },
    async syncAudiencias() { return fn("meta-audiencias", {}); },
    async crmActividad() {
      const [m, s] = await Promise.all([sb.from("message_logs").select("*").eq("direccion", "entrante").order("created_at", { ascending: false }).limit(15),
        sb.from("marketing_sync_logs").select("*").order("created_at", { ascending: false }).limit(10)]);
      fail(m.error); fail(s.error); return { mensajes: m.data || [], sync: s.data || [] };
    },
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
    async dropAnotarWa(tel, nombre) { const { error } = await sb.rpc("drop_anotar_wa", { p_phone: tel, p_nombre: nombre }); fail(error); },
    async dropDesanotarWa(tel) { if (!tel) return; const { error } = await sb.rpc("drop_desanotar_wa", { p_phone: tel }); fail(error); },
    async dropDesuscribir(endpoint) { const { error } = await sb.rpc("drop_desuscribir", { p_endpoint: endpoint }); fail(error); },
    async dropAvisos() { const { data, error } = await sb.rpc("drop_avisos_info"); fail(error); return data; },
    async dropAvisar() { const { data, error } = await sb.rpc("drop_avisar"); fail(error); return data; },
    /* avisos al equipo en el panel: pedido nuevo, gift card, cambio resuelto, reseña (migración 027) */
    async equipoPushSuscribir(sub, quien) { const k = sub.toJSON().keys || {}; const { error } = await sb.rpc("staff_push_suscribir", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_quien: quien || null }); fail(error); },
    async equipoPushDesuscribir(endpoint) { const { error } = await sb.rpc("staff_push_desuscribir", { p_endpoint: endpoint }); fail(error); },
    async equipoPushActivo(endpoint) { const { data, error } = await sb.rpc("staff_push_activo", { p_endpoint: endpoint }); fail(error); return !!data; },
    async equipoPushQuien(endpoint) { const { data, error } = await sb.rpc("staff_push_quien", { p_endpoint: endpoint }); fail(error); return data; }, // null = apagado, "" = sin nombre
    async equipoSocios() { const { data, error } = await sb.from("caja_socios").select("nombre").eq("activo", true).order("nombre"); fail(error); return (data || []).map((x) => x.nombre); },
    async createReviewTrack(track, rating, texto, foto, instagram) { const { error } = await sb.rpc("create_review_track", { p_track: track, p_rating: rating, p_texto: texto || null, p_foto: foto || null, p_instagram: instagram || null }); fail(error); },
    async createReview(code, phone, rating, texto, foto, instagram) { const { error } = await sb.rpc("create_review_v2", { p_code: code, p_phone: phone, p_rating: rating, p_texto: texto || null, p_foto: foto || null, p_instagram: instagram || null }); fail(error); },
    async uploadReviewPhoto(blob) {
      const ext = (blob.type || "").includes("webp") ? "webp" : "jpg", path = `r/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await sb.storage.from("resenas").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false, cacheControl: "31536000" });
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
    async listReviews() { const { data, error } = await sb.from("reviews").select("*").order("orden", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(100); fail(error); return data; },
    async setReviewOrden(id, orden) { const { error } = await sb.from("reviews").update({ orden: orden || null }).eq("id", id); fail(error); },
    async setReviewEstado(id, estado) { const { error } = await sb.from("reviews").update({ estado, revisada: true }).eq("id", id); fail(error); },
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
    async pyaConfig() { const { data, error } = await sb.from("pedidosya_config").select("*").eq("id", 1).maybeSingle(); fail(error); return data || {}; },
    async savePyaConfig(c) { const { error } = await sb.from("pedidosya_config").update({ ...c, updated_at: new Date().toISOString() }).eq("id", 1); fail(error); },
    async pyaEnvio(accion, id, offerId) { return (await fn("pedidosya-envio", { accion, order_id: id, offer_id: offerId || null })).pya; },
    async uploadMedia(file, id) {
      const ext = ((file.name || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || (file.type.includes("webm") ? "webm" : "mp4");
      const path = `${id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("productos").upload(path, file, { contentType: file.type || "video/mp4", upsert: true, cacheControl: "31536000" });
      fail(error);
      return sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    },
    async uploadPhoto(blob, id) {
      const ext = (blob.type || "").includes("webp") ? "webp" : "jpg";
      const path = `${id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("productos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true, cacheControl: "31536000" /* el nombre lleva la hora: nunca se pisa */ });
      fail(error);
      return sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    },
    onOrders(cb) {
      sb.channel("orders-live").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => cb()).subscribe();
    },
  };

  window.SettoAPI = Object.assign({ DEMO, normPhone, prettyPhone, dropEstado }, DEMO ? demo : live);
})();
