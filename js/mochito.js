/* Mochito guía (solo en compu): queda quieto en la esquina, corre al scrollear y te lleva a comprar.
   Habla UNA sola vez por visita (un globo), así no tapa productos ni precios. En celu no aparece.
   Usa los PNG originales de Mochito (no se redibuja). Si la persona lo cierra (✕) no aparece hasta la próxima visita. */
(function () {
  if (document.body.dataset.page !== "home") return;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Antes el ✕ lo escondía para siempre en ese navegador; ahora vale solo para esta visita
  let off = false; try { localStorage.removeItem("setto-mochito-off"); off = sessionStorage.getItem("setto-mochito-off") === "1"; } catch (_) {}

  /* ---------- 1) Aparición suave de bloques al hacer scroll ---------- */
  const revealSel = "#especial .head, #sets .head, #carta .head, #pedir .head, #club .head, #club .club > div, .stampcard, #faq .head, #resenas .head";
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
  // En celu y tablet Mochito no aparece: en pantallas chicas cualquier cosa fija encima tapa productos
  const PC = matchMedia("(min-width: 1024px)");
  if (!PC.matches) return;
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
  // Un solo globo por visita (sessionStorage): el primero que toque, después Mochito queda callado
  const DIJO = "setto-mochito-dijo";
  const yaHablo = () => { try { return sessionStorage.getItem(DIJO) === "1"; } catch (_) { return false; } };
  function say(tip, ms = 4800) {
    if (!tip || !PC.matches || yaHablo()) return;
    try { sessionStorage.setItem(DIJO, "1"); } catch (_) {}
    bubP.textContent = tip.t;
    bubA.innerHTML = ""; (tip.a || []).forEach(([l, fn]) => { const b = document.createElement("button"); b.className = "mito-a"; b.textContent = l; b.onclick = () => { if (recien()) return; fn(); hideBub(); }; bubA.appendChild(b); });
    bub.hidden = false; requestAnimationFrame(() => bub.classList.add("on"));
    clearTimeout(bubT); bubT = setTimeout(hideBub, ms);
  }
  function hideBub() { bub.classList.remove("on"); clearTimeout(bubT); bubT = setTimeout(() => (bub.hidden = true), 220); }

  btn.addEventListener("click", () => {
    if (recien()) return;
    if (!bub.hidden && bub.classList.contains("on")) { hideBub(); }
    if (items()) { abrirPedido(); return; }
    hop(); go("#sets");
  });
  el.querySelector(".mito-x").addEventListener("click", (e) => {
    e.stopPropagation(); hideBub(); el.classList.add("bye");
    try { sessionStorage.setItem("setto-mochito-off", "1"); } catch (_) {}
    setTimeout(() => el.remove(), 400);
  });

  // Sección actual → tip apenas entrás (una vez por sección), aunque sigas scrolleando
  const SECS = Object.keys(TIPS).filter((k) => k !== "top").map((id) => document.getElementById(id)).filter(Boolean);
  let cur = "top", curT = null;

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
    const lift = el.classList.contains("lift");
    const subir = !!document.getElementById("mbar")?.classList.contains("on");
    if (lift !== subir) el.classList.toggle("lift", subir);
    if (!moving && Math.abs(dy) > 2) { moving = true; pose("run"); }
    entrar(seccion());
    clearTimeout(stopT);
    stopT = setTimeout(() => { moving = false; pose("idle"); }, 260);
  }
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
  const watchOpen = () => el.classList.toggle("hide", ["drawer", "sheet"].some((id) => document.getElementById(id)?.classList.contains("on")) || !!document.querySelector(".allrev:not([hidden])"));
  new MutationObserver(watchOpen).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });

  // Cuando sumás algo al pedido, Mochito festeja
  let lastN = items();
  setInterval(() => { const n = items(); if (n > lastN) { hop(); say({ t: "¡Bien ahí! Sumado a tu pedido 🎉", a: [["Ver pedido", abrirPedido]] }, 3200); } lastN = n; }, 700);

  addEventListener("scroll", onScroll, { passive: true });
  if (!RM) raf = requestAnimationFrame(tick);
  setTimeout(() => { el.classList.add("in"); hop(); if (scrollY < 200) { seen.top = 1; say(TIPS.top, 5200); } }, 1400);
  onScroll();
  };
  // y unos segundos después (o apenas la persona toca o scrollea), así sus dibujos no compiten con las fotos de arriba
  let listo = false; const ya = () => { if (listo) return; listo = true; arrancar(); };
  const despues = () => { setTimeout(ya, 3000); ["scroll", "touchstart", "pointerdown", "keydown"].forEach((ev) => addEventListener(ev, ya, { once: true, passive: true })); };
  if (document.readyState === "complete") despues(); else addEventListener("load", despues, { once: true });
})();
