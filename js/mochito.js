/* Mochito guía: acompaña el scroll, cambia de pose, muestra tips por sección
   y te lleva a comprar. Usa los PNG originales de Mochito (no se redibuja).
   Si la persona lo cierra (✕) no aparece hasta la próxima visita. Recorre un caminito con una parada por sección. */
(function () {
  if (document.body.dataset.page !== "home") return;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Antes el ✕ lo escondía para siempre en ese navegador; ahora vale solo para esta visita
  let off = false; try { localStorage.removeItem("setto-mochito-off"); off = sessionStorage.getItem("setto-mochito-off") === "1"; } catch (_) {}

  /* ---------- 1) Aparición suave de bloques al hacer scroll ---------- */
  const revealSel = "#especial .head, #sets .head, #carta .head, #pedir .head, #club .club > div, .stampcard, #faq .head, #resenas .head";
  const cardSel = "article.set, article.item, .cv, #resenas .rv, .faq-list > *";
  if (!RM && "IntersectionObserver" in window) {
    document.documentElement.classList.add("rv-on");
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("rv-in"); if (e.target.parentElement) e.target.parentElement.dataset.rvdone = "1"; io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    const watch = () => {
      document.querySelectorAll(revealSel).forEach((el) => { if (!el.dataset.rv) { el.dataset.rv = "1"; el.classList.add("rv-up"); io.observe(el); } });
      document.querySelectorAll(cardSel).forEach((el) => {
        if (el.dataset.rv) return; el.dataset.rv = "1";
        if (el.parentElement.dataset.rvdone) return; // re-render de una grilla ya vista: sin animar de nuevo
        const sib = Array.from(el.parentElement.children).indexOf(el) % 4;
        el.style.setProperty("--rv-d", sib * 70 + "ms"); el.classList.add("rv-up"); io.observe(el);
      });
    };
    watch(); new MutationObserver(watch).observe(document.querySelector("main"), { childList: true, subtree: true });
  }

  if (off) return;
  // Mochito arranca cuando terminó de cargar la página (portada incluida): sus dibujos no le restan velocidad a la primera foto
  const arrancar = () => {

  /* ---------- 2) Mochito ---------- */
  // Mochito animado por partes, recortado de los dibujos originales: quieto = mochito-run.png (parpadea); scrolleando = mochito-cup.png con el latte (corre)
  const el = document.createElement("div");
  el.className = "mito"; el.setAttribute("aria-live", "polite");
  el.innerHTML = `<div class="mito-bubble" hidden><p></p><div class="mito-acts"></div><button class="mito-x" aria-label="Ocultar a Mochito">✕</button></div>
    <button class="mito-btn" aria-label="Mochito: te llevo a pedir">
      <svg class="mito-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><circle class="p" cx="50" cy="50" r="46" pathLength="100"/></svg>
      <span class="mito-body"><span class="rig quieto"><i class="lg l"></i><i class="lg r"></i><i class="bd"></i><i class="ey"></i></span><span class="rig latte"><i class="lg l"></i><i class="lg r"></i><i class="bd"></i><i class="tz"></i></span></span>
      <span class="mito-shadow"></span>
      <span class="mito-tag" aria-hidden="true"></span>
    </button>`;
  document.body.appendChild(el);
  const btn = el.querySelector(".mito-btn"), body = el.querySelector(".mito-body"),
        bub = el.querySelector(".mito-bubble"), bubP = bub.querySelector("p"), bubA = bub.querySelector(".mito-acts"), ring = el.querySelector(".mito-ring .p");

  const items = () => { try { return JSON.parse(localStorage.getItem("setto-cart") || "[]").reduce((a, c) => a + (c.qty || 1), 0); } catch (_) { return 0; } };
  // Si Mochito te lleva a una sección y vos tocás o scrolleás en el camino, frena ahí: nunca pelea con tu dedo
  let auto = false, autoT = null;
  const soltar = () => { if (!auto) return; auto = false; scrollTo({ top: scrollY, behavior: "instant" }); };
  ["touchstart", "wheel", "keydown"].forEach((ev) => addEventListener(ev, soltar, { passive: true }));
  const go = (sel) => { const t = document.querySelector(sel); if (!t) return; auto = !RM; clearTimeout(autoT); autoT = setTimeout(() => (auto = false), 1500); t.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" }); };
  addEventListener("scrollend", () => (auto = false));
  // Un toque para frenar el scroll no cuenta como tocar a Mochito
  let lastMove = 0;
  const recien = () => performance.now() - lastMove < 450;
  const abrirPedido = () => { const b = document.getElementById("openCart"); if (b) b.click(); };
  const wa = () => { const a = document.querySelector("#navWa, a[href*='wa.me']"); if (a) window.open(a.href, "_blank", "noopener"); };

  // Tips por sección: texto corto + una acción
  const TIPS = {
    top:      { t: "¡Hola! Soy Mochito 👋 ¿Te llevo a los sets?", a: [["Ver sets", () => go("#sets")]] },
    especial:  { t: "Esto sale por tiempo limitado 👀", a: [] },
    sets:      { t: "Un set es bebida + mochi, y sale menos que por separado.", a: [] },
    maquinita: { t: "🎰 Esta es mi maquinita. ¡Probá suerte!", a: [["Tirar", () => document.getElementById("mqTirar")?.click()]] },
    votar:     { t: "¿Qué sabor querés probar? Dejá tu voto 🗳️", a: [] },
    carta:     { t: "¿Algo suelto? Tocá cualquier producto para elegir.", a: [] },
    pedir:     { t: "Si pedís por acá, sumás sellos del Setto Club 😉", a: [] },
    resenas:   { t: "Esto dicen quienes ya probaron Setto 💬", a: [] },
    regalo:    { t: "¿Para regalar? Las gift cards llegan por link 🎁", a: [] },
    giftcards: { t: "¿Para regalar? Las gift cards llegan por link 🎁", a: [["Regalar", () => document.getElementById("gchBuy")?.click()]] },
    club:      { t: "Cada pedido web suma un sello. ¡Con la tarjeta llena hay premio!", a: [] },
    stickers:  { t: "Llevame a tus chats: mis stickers son gratis 😄", a: [] },
    ubicacion: { t: "Si retirás, acá nos encontrás 📍", a: [] },
    faq:       { t: "¿Te quedó alguna duda? Escribinos.", a: [["WhatsApp", wa]] },
  };
  const cartTip = () => { const n = items(); return n ? { t: `Tenés ${n} ${n === 1 ? "cosa" : "cosas"} en tu pedido. ¿Lo terminamos?`, a: [["Ver mi pedido", abrirPedido]] } : null; };

  let bubT = null, seen = {};
  function say(tip, ms = 4800) {
    if (!tip || !PC.matches) return; // en celu Mochito no habla: solo recorre el camino
    bubP.textContent = tip.t;
    bubA.innerHTML = ""; (tip.a || []).forEach(([l, fn]) => { const b = document.createElement("button"); b.className = "mito-a"; b.textContent = l; b.onclick = () => { if (recien()) return; fn(); hideBub(); }; bubA.appendChild(b); });
    bub.hidden = false; requestAnimationFrame(() => bub.classList.add("on"));
    clearTimeout(bubT); bubT = setTimeout(hideBub, ms);
  }
  function hideBub() { bub.classList.remove("on"); clearTimeout(bubT); bubT = setTimeout(() => (bub.hidden = true), 220); }

  btn.addEventListener("click", () => {
    if (recien() || arrastro) return;
    if (!bub.hidden && bub.classList.contains("on")) { hideBub(); }
    if (items()) { abrirPedido(); return; }
    hop(); go("#sets");
  });
  el.querySelector(".mito-x").addEventListener("click", (e) => {
    e.stopPropagation(); hideBub(); el.classList.add("bye");
    try { sessionStorage.setItem("setto-mochito-off", "1"); } catch (_) {}
    path.remove(); el.style.removeProperty("--py"); el.style.removeProperty("--px");
    setTimeout(() => el.remove(), 400);
  });

  // Sección actual → tip apenas entrás (una vez por sección), aunque sigas scrolleando
  const SECS = Object.keys(TIPS).filter((k) => k !== "top").map((id) => document.getElementById(id)).filter(Boolean);
  let cur = "top", curT = null;

  // Caminito: un camino dibujado que serpentea en la esquina de abajo a la derecha (máximo media pantalla en PC
  // y 40% en celu).
  // Mochito lo recorre con el scroll y llega al final del camino al final de la página. Cada sección es una
  // parada (menos la edición especial, que se ve apenas entrás); pasa por ella justo cuando aparece su tip.
  // En PC solo las paradas se tocan; en celu no se toca nada del camino (no frena el dedo ni tapa botones).
  const PC = matchMedia("(min-width: 1024px)");
  const VUELTAS = 1.5;
  let ONDA = 16, M = 44, W = 88; // W = ancho de Mochito (88px, 66px en celu); M = la mitad
  const path = document.createElement("div");
  path.className = "mito-path"; path.setAttribute("aria-label", "Secciones de la página");
  path.innerHTML = `<svg class="mp-svg" aria-hidden="true"><g class="mp-piedras"></g><path class="mp-borde"/><path class="mp-tierra"/><path class="mp-raya"/><path class="mp-hecho" pathLength="1"/></svg><span class="mp-stops"></span>`;
  document.body.appendChild(path);
  const pSvg = path.querySelector("svg"), pHecho = path.querySelector(".mp-hecho"), pStops = path.querySelector(".mp-stops");
  let paradas = [], alto = 0;
  const curva = (t) => ONDA * Math.sin(t * Math.PI * 2 * VUELTAS); // corrimiento horizontal en el punto t (0 arriba, 1 abajo)
  const progreso = () => { const max = document.documentElement.scrollHeight - innerHeight; return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  function armarCamino() {
    W = innerWidth >= 761 ? 88 : 66; M = W / 2; ONDA = Math.round(W * 0.18); // mismas medidas que el CSS de Mochito
    path.classList.toggle("lift", el.classList.contains("lift"));
    const hb = Math.max(0, document.querySelector("header.top")?.getBoundingClientRect().bottom || 66);
    const piso = el.classList.contains("lift") ? 82 : innerWidth >= 761 ? 22 : 14;
    const H = Math.round(Math.min(innerHeight * (PC.matches ? 0.5 : 0.4), innerHeight - hb - piso - 16)); // nunca más de media pantalla (40% en celu)
    path.style.height = `${H}px`; alto = H - 2 * M;
    // Dibujo: borde, tierra, raya del medio y piedritas a los costados, sobre la misma curva
    let d = "";
    for (let i = 0; i <= 48; i++) { const t = i / 48; d += `${i ? "L" : "M"}${(M + curva(t)).toFixed(1)} ${(M + t * alto).toFixed(1)} `; }
    pSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    pSvg.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
    pSvg.querySelector(".mp-piedras").innerHTML = Array.from({ length: Math.floor(alto / 34) }, (_, i) => {
      const t = (i + 0.5) / Math.floor(alto / 34), lado = i % 2 ? 1 : -1;
      return `<circle cx="${(M + curva(t) + lado * 17).toFixed(1)}" cy="${(M + t * alto).toFixed(1)}" r="${i % 3 ? 2 : 2.8}"/>`;
    }).join("");
    const max = document.documentElement.scrollHeight - innerHeight;
    paradas = SECS.filter((sec) => sec.id !== "especial" && !sec.hidden && sec.offsetParent).map((sec) => {
      const top = sec.getBoundingClientRect().top + scrollY;
      return { id: sec.id, p: max > 0 ? Math.min(1, Math.max(0, (top - innerHeight * 0.6) / max)) : 0, nombre: (sec.querySelector("h2")?.textContent || sec.id).trim() };
    });
    pStops.innerHTML = paradas.map((s) => `<button type="button" class="mp-stop" style="top:${(M + s.p * alto).toFixed(1)}px;left:${(M + curva(s.p)).toFixed(1)}px" data-id="${s.id}" aria-label="Ir a ${s.nombre}"><span>${s.nombre}</span></button>`).join("");
    moverCamino();
  }
  function moverCamino() {
    if (!path.isConnected) return;
    const p = progreso();
    el.style.setProperty("--py", `${(-(1 - p) * alto).toFixed(1)}px`);
    el.style.setProperty("--px", `${curva(p).toFixed(1)}px`);
    pHecho.style.strokeDasharray = `${p.toFixed(4)} 1`;
    pStops.querySelectorAll(".mp-stop").forEach((b, i) => b.classList.toggle("ok", paradas[i] && p >= paradas[i].p - 0.002));
  }
  pStops.addEventListener("click", (e) => { const b = e.target.closest(".mp-stop"); if (b && !recien()) go("#" + b.dataset.id); });
  let caminoT = null; const reCamino = () => { clearTimeout(caminoT); caminoT = setTimeout(armarCamino, 200); };
  if ("ResizeObserver" in window) new ResizeObserver(reCamino).observe(document.body);
  addEventListener("resize", reCamino); PC.addEventListener?.("change", reCamino);
  function seccion() {
    const y = innerHeight * 0.6; let s = "top";
    SECS.forEach((sec) => { if (sec.hidden || !sec.offsetParent) return; const r = sec.getBoundingClientRect(); if (r.top < y && r.bottom > y) s = sec.id; });
    return s;
  }
  function entrar(s) {
    if (s === cur) return;
    cur = s; clearTimeout(curT);
    // Un ratito en la sección antes de hablar, así un scroll muy rápido no hace parpadear el globo
    curT = setTimeout(() => {
      if (s === "top" || seccion() !== s) return; // arriba de todo o en el pie no hay tip
      if (!seen[s]) { seen[s] = 1; say(s === "pedir" || s === "club" ? (cartTip() || TIPS[s]) : TIPS[s]); }
      else if (s === "faq" && items()) say(cartTip());
    }, 250);
  }

  // Física: mientras scrolleás corre (y se inclina con la velocidad); al frenar, pose según la sección
  let lastY = scrollY, vel = 0, moving = false, stopT = null, raf = null, t0 = performance.now();
  function pose(name) { el.classList.toggle("run", name === "run"); }
  function tick(now) {
    vel *= 0.9;
    const tilt = Math.max(-14, Math.min(14, vel * 0.6));
    const bob = moving ? Math.abs(Math.sin((now - t0) / 90)) * -7 : Math.sin((now - t0) / 700) * -3;
    body.style.transform = `translateY(${bob.toFixed(1)}px) rotate(${(moving ? tilt : 0).toFixed(1)}deg) scaleX(${dir})`;
    el.style.setProperty("--sh", (1 + bob / 30).toFixed(2));
    raf = requestAnimationFrame(tick);
  }
  let dir = 1;
  function onScroll() {
    const y = scrollY, dy = y - lastY; lastY = y;
    if (!auto) lastMove = performance.now();
    vel += dy * 0.25; if (Math.abs(dy) > 1) dir = dy > 0 ? 1 : -1;
    const max = document.documentElement.scrollHeight - innerHeight;
    ring.style.strokeDasharray = `${max > 0 ? Math.min(100, (y / max) * 100) : 0} 100`;
    moverCamino();
    const lift = el.classList.contains("lift");
    const subir = !!document.getElementById("mbar")?.classList.contains("on");
    if (lift !== subir) { el.classList.toggle("lift", subir); path.classList.toggle("lift", subir); reCamino(); }
    if (!moving && Math.abs(dy) > 2) { moving = true; pose("run"); }
    entrar(seccion());
    clearTimeout(stopT);
    stopT = setTimeout(() => { moving = false; pose("idle"); }, 260);
  }
  // Mochito como barra de scroll: lo agarrás con el dedo (o el mouse) y lo deslizás por el camino para recorrer el
  // sitio rápido. Solo atrapa los toques que empiezan sobre Mochito; el resto de la página scrollea normal.
  // Un toque sin arrastrar sigue siendo un click (te lleva a los sets o al pedido).
  const tag = el.querySelector(".mito-tag");
  let agarre = null, arrastro = false;
  btn.addEventListener("pointerdown", (e) => {
    if (e.button || !el.classList.contains("in") || alto <= 0) return;
    soltar(); arrastro = false;
    agarre = { id: e.pointerId, y: e.clientY, p: progreso(), activo: false };
  });
  btn.addEventListener("pointermove", (e) => {
    if (!agarre || e.pointerId !== agarre.id) return;
    const dy = e.clientY - agarre.y;
    if (!agarre.activo) {
      if (Math.abs(dy) < 6) return;
      agarre.activo = arrastro = true;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      el.classList.add("grab"); hideBub();
      if (e.pointerType === "touch") navigator.vibrate?.(8);
    }
    e.preventDefault();
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = Math.min(1, Math.max(0, agarre.p + dy / alto)); // 1:1 con el dedo: Mochito queda debajo
    scrollTo({ top: p * max, behavior: "instant" });
    const s = seccion(), nombre = s === "top" ? "Inicio" : (paradas.find((x) => x.id === s)?.nombre || "");
    if (tag.textContent !== nombre) tag.textContent = nombre;
    tag.classList.toggle("on", !!nombre);
  });
  const soltarMochito = (e) => {
    if (!agarre || e.pointerId !== agarre.id) return;
    const fue = agarre.activo; agarre = null;
    if (!fue) return;
    el.classList.remove("grab"); tag.classList.remove("on");
    // el click que llega justo después de soltar no cuenta
    setTimeout(() => (arrastro = false), 50);
  };
  btn.addEventListener("pointerup", soltarMochito);
  btn.addEventListener("pointercancel", soltarMochito);

  body.addEventListener("animationend", (e) => { if (e.animationName === "mitohop") body.classList.remove("hop"); });
  function hop() { if (RM) return; body.classList.remove("hop"); void body.offsetWidth; body.classList.add("hop"); }

  // Maquinita: una vez por día Mochito invita a tirar (solo si no hay nada en el pedido)
  const MQ = "setto-maq-invito", hoy = new Date().toISOString().slice(0, 10);
  let invitado = false; try { invitado = localStorage.getItem(MQ) === hoy; } catch (_) {}
  function invitar() {
    if (items()) return; // está armando un pedido: no lo distraemos
    if (moving || !bub.hidden) { setTimeout(invitar, 2500); return; } // espera a que Mochito esté libre
    say({ t: "🎰 ¿Probás suerte? Tenés una tirada gratis hoy.", a: [["Jugar", () => (window.SettoMaquinita ? window.SettoMaquinita() : (location.href = "/?maquinita"))]] }, 9000);
    try { localStorage.setItem(MQ, hoy); } catch (_) {}
  }
  if (!invitado) setTimeout(invitar, 6000);

  // No molesta cuando hay un panel abierto
  const watchOpen = () => path.classList.toggle("hide", el.classList.toggle("hide", ["drawer", "sheet"].some((id) => document.getElementById(id)?.classList.contains("on")) || !!document.querySelector(".allrev:not([hidden])")));
  new MutationObserver(watchOpen).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });

  // Cuando sumás algo al pedido, Mochito festeja
  let lastN = items();
  setInterval(() => { const n = items(); if (n > lastN) { hop(); say({ t: "¡Bien ahí! Sumado a tu pedido 🎉", a: [["Ver pedido", abrirPedido]] }, 3200); } lastN = n; }, 700);

  addEventListener("scroll", onScroll, { passive: true });
  if (!RM) raf = requestAnimationFrame(tick);
  setTimeout(() => { el.classList.add("in"); hop(); if (scrollY < 200) { seen.top = 1; say(TIPS.top, 5200); } }, 1400);
  onScroll();
  };
  if (document.readyState === "complete") arrancar(); else addEventListener("load", arrancar, { once: true });
})();
