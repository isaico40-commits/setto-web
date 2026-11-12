/*
  Local · pestaña "Horas": fichaje de entrada y salida del equipo (migración 064).
  - Un toque en tu nombre abre el turno; otro toque lo cierra.
  - Resumen de horas por persona en un período, con % del total y una cuenta de reparto (no se guarda).
  - Si alguien se olvidó de fichar: se corrige el turno o se carga entero. Nada se borra y cada cambio
    queda en fichajes_log (quién, cuándo, antes/después, motivo) y se ve en la lista con la marca "editado".
  Usa lo que expone js/local.js en window.SettoLocal.
*/
(function () {
  const L = window.SettoLocal; if (!L) return;
  const { sb, S, esc, toast, openSheet, closeSheet, fail, TZ } = L;
  const $ = (s, r = document) => r.querySelector(s);
  const LARGO = 16 * 3600e3; // un turno abierto más de 16 h se toma como "se olvidó de salir"

  const H = {
    ok: false, falta: false, cargando: true, socios: [], abiertos: [], turnos: [], logs: {},
    per: (() => { try { return localStorage.getItem("setto-horas-per") || "semana"; } catch (_) { return "semana"; } })(),
    desde: "", hasta: "", monto: "", busy: new Set(),
  };

  /* ---------- fechas en hora de Argentina (UTC−3, sin horario de verano) ---------- */
  const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const hm = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const isoAR = (fecha, hora) => new Date(`${fecha}T${hora}:00-03:00`).toISOString();
  const addDias = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const diaLargo = (f) => { const d = new Date(f + "T12:00:00Z"); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
  const dur = (min) => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")} min` : ""}` : `${m} min`; };
  const durCorta = (min) => { min = Math.max(0, Math.round(min)); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`; };
  const cuando = (iso) => `${diaLargo(ymd(new Date(iso)))} ${hm(iso)}`;

  function rango() {
    const hoy = ymd(new Date());
    if (H.per === "semana") { const dow = (new Date(hoy + "T12:00:00Z").getUTCDay() + 6) % 7; return [addDias(hoy, -dow), hoy]; }
    if (H.per === "mes") return [hoy.slice(0, 8) + "01", hoy];
    if (H.per === "pasado") { const ini = addDias(hoy.slice(0, 8) + "01", -1).slice(0, 8) + "01"; return [ini, addDias(hoy.slice(0, 8) + "01", -1)]; }
    const d = H.desde || hoy.slice(0, 8) + "01", h = H.hasta || hoy;
    return d <= h ? [d, h] : [h, d];
  }
  const nombre = (id) => (H.socios.find((s) => s.id === id) || {}).nombre || id;

  /* ---------- carga ---------- */
  async function cargar() {
    const [d, h] = rango();
    const desde = isoAR(d, "00:00"), hasta = isoAR(addDias(h, 1), "00:00");
    try {
      const [soc, ab, tu] = await Promise.all([
        sb.from("caja_socios").select("id,nombre,activo,orden").eq("activo", true).order("orden"),
        sb.from("fichajes").select("*").is("salida", null).eq("anulado", false),
        sb.from("fichajes").select("*").lt("entrada", hasta).or(`salida.is.null,salida.gt.${desde}`).order("entrada", { ascending: false }).limit(1000),
      ]);
      if (ab.error && /fichajes/.test(ab.error.message || "")) { H.falta = true; H.cargando = false; return; }
      H.socios = fail(soc) || []; H.abiertos = fail(ab) || []; H.turnos = fail(tu) || [];
      H.falta = false; H.ok = true;
    } catch (e) { toast(e.message); }
    H.cargando = false;
  }
  let reT;
  const recargar = () => { clearTimeout(reT); reT = setTimeout(async () => { await cargar(); if (S.view === "horas") view(); }, 250); };

  /* ---------- cuentas ---------- */
  function minutosEn(t, desde, hasta) {
    if (t.anulado) return 0;
    const a = Math.max(new Date(t.entrada).getTime(), desde), b = Math.min(t.salida ? new Date(t.salida).getTime() : Date.now(), hasta, Date.now());
    return Math.max(0, (b - a) / 60000);
  }
  function resumen() {
    const [d, h] = rango();
    const desde = new Date(isoAR(d, "00:00")).getTime(), hasta = new Date(isoAR(addDias(h, 1), "00:00")).getTime();
    const filas = H.socios.map((s) => {
      const ts = H.turnos.filter((t) => t.socio_id === s.id && !t.anulado);
      const min = ts.reduce((a, t) => a + minutosEn(t, desde, hasta), 0);
      const dias = new Set(ts.map((t) => ymd(new Date(t.entrada)))).size;
      return { s, min, turnos: ts.length, dias, editados: ts.filter((t) => t.editado).length };
    });
    const tot = filas.reduce((a, f) => a + f.min, 0);
    return { filas, tot, d, h };
  }

  /* ---------- vista ---------- */
  function cardHtml(s) {
    const ab = H.abiertos.find((t) => t.socio_id === s.id);
    const vieja = ab && Date.now() - new Date(ab.entrada).getTime() > LARGO;
    const yo = S.me === s.nombre;
    const est = !ab ? `<span class="fe">Afuera</span><em>Tocá para entrar</em>`
      : vieja ? `<span class="fe">Turno abierto desde ${esc(cuando(ab.entrada))}</span><em>Te olvidaste de salir · corregir</em>`
      : `<span class="fe">Adentro desde ${hm(ab.entrada)} · <b class="num">${dur((Date.now() - new Date(ab.entrada)) / 60000)}</b></span><em>Tocá para salir</em>`;
    return `<button class="fc ${ab ? (vieja ? "olvido" : "in") : "out"}" data-fhm="${esc(s.id)}" ${H.busy.has(s.id) ? "disabled" : ""} aria-label="${esc(s.nombre)}: ${ab ? "fichar salida" : "fichar entrada"}">
      <i>${esc(s.nombre[0])}</i><b>${esc(s.nombre)}${yo ? ` <small>vos</small>` : ""}</b>${est}</button>`;
  }
  function turnoHtml(t) {
    const min = t.anulado ? 0 : ((t.salida ? new Date(t.salida) : Date.now()) - new Date(t.entrada)) / 60000;
    const otroDia = t.salida && ymd(new Date(t.salida)) !== ymd(new Date(t.entrada));
    return `<li class="${t.anulado ? "anul" : ""}"><button data-fht="${t.id}">
      <i>${esc(nombre(t.socio_id)[0])}</i>
      <span class="tn">${esc(nombre(t.socio_id))}<small class="num">${hm(t.entrada)} → ${t.salida ? hm(t.salida) + (otroDia ? " (+1)" : "") : "sigue adentro"}</small></span>
      ${t.anulado ? `<span class="ftag an">Anulado</span>` : t.origen === "manual" ? `<span class="ftag ed">✎ Cargado a mano</span>` : t.editado ? `<span class="ftag ed">✎ Editado</span>` : ""}
      <b class="num">${t.anulado ? "—" : durCorta(min)}</b></button></li>`;
  }
  function view() {
    const v = $("#view"); if (!v) return;
    if (H.falta) { v.innerHTML = `<div class="wrap horas"><h1 class="h1">Horas</h1><p class="muted">Para fichar falta correr <b>supabase/migrations/064_fichaje_horas.sql</b> en el SQL Editor de Supabase.</p></div>`; return; }
    if (H.cargando && !H.ok) { v.innerHTML = `<div class="loading">Cargando horas…</div>`; return; }
    const { filas, tot, d, h } = resumen();
    const monto = parseInt(String(H.monto).replace(/[^\d]/g, ""), 10) || 0;
    const porDia = new Map(); H.turnos.forEach((t) => { const k = ymd(new Date(t.entrada)); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(t); });
    v.innerHTML = `<div class="wrap horas">
      <section class="fich">
        <h1 class="h1">Fichar</h1>
        <p class="muted">Tocá tu nombre al llegar y otra vez al irte.</p>
        <div class="fcards">${H.socios.map(cardHtml).join("")}</div>
      </section>

      <section class="hres">
        <div class="hrh"><h2 class="h2">Horas trabajadas</h2>
          <div class="chips" role="tablist">${[["semana", "Esta semana"], ["mes", "Este mes"], ["pasado", "Mes pasado"], ["rango", "Elegir fechas"]].map(([k, l]) => `<button data-fhp="${k}" aria-pressed="${H.per === k}">${l}</button>`).join("")}</div></div>
        ${H.per === "rango" ? `<div class="hfechas"><label>Desde<input class="inp" type="date" id="fhD" value="${d}"></label><label>Hasta<input class="inp" type="date" id="fhH" value="${h}"></label></div>` : `<p class="muted hrango">${esc(diaLargo(d))} al ${esc(diaLargo(h))}</p>`}
        <div class="htab">${filas.map((f) => { const pc = tot ? (f.min / tot) * 100 : 0; return `<div class="hsrow">
            <span class="hq"><i>${esc(f.s.nombre[0])}</i><b>${esc(f.s.nombre)}</b><small>${f.dias} día${f.dias === 1 ? "" : "s"} · ${f.turnos} turno${f.turnos === 1 ? "" : "s"}${f.editados ? ` · ${f.editados} con cambios` : ""}</small></span>
            <span class="hh"><b class="num">${dur(f.min)}</b><small class="num">${pc.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</small></span>
            <span class="hbar"><span style="width:${pc.toFixed(2)}%"></span></span></div>`; }).join("")}
          <div class="hsrow tot"><span class="hq"><b>Total del equipo</b></span><span class="hh"><b class="num">${dur(tot)}</b></span></div>
        </div>
        <div class="hrep">
          <label>Repartir según estas horas <span class="mw">$<input class="inp num" id="fhMonto" inputmode="numeric" placeholder="Monto" value="${esc(H.monto)}" autocomplete="off"></span></label>
          <div class="hrep-r" id="fhRep">${repartoHtml(filas, tot, monto)}</div>
          <small class="muted">Es una cuenta de referencia: no se guarda ni toca la Caja.</small>
        </div>
      </section>

      <section class="hturnos">
        <div class="hrh"><h2 class="h2">Turnos</h2><button class="btn sm" data-fhnew>+ Cargar turno olvidado</button></div>
        ${porDia.size ? [...porDia].map(([k, ts]) => `<h3 class="fdia">${esc(diaLargo(k))}</h3><ul class="flist">${ts.map(turnoHtml).join("")}</ul>`).join("") : `<p class="muted">No hay turnos en este período.</p>`}
        <p class="kpinote">Los turnos no se borran. Si alguien corrige o carga un turno a mano, queda marcado y adentro se ve quién lo cambió, cuándo y qué decía antes.</p>
      </section>
    </div>`;
  }
  function repartoHtml(filas, tot, monto) {
    if (!monto || !tot) return "";
    // se reparte en pesos enteros y el redondeo se le suma al de más horas, así la suma da justo
    const partes = filas.map((f) => ({ n: f.s.nombre, v: Math.floor((monto * f.min) / tot) }));
    const resto = monto - partes.reduce((a, p) => a + p.v, 0);
    if (resto) { let mx = 0; filas.forEach((f, i) => { if (f.min > filas[mx].min) mx = i; }); partes[mx].v += resto; }
    return partes.map((p) => `<span><small>${esc(p.n)}</small><b class="num">$${p.v.toLocaleString("es-AR")}</b></span>`).join("");
  }

  /* ---------- hoja: corregir / cargar / historial ---------- */
  let F = null;
  function turnoSheet(t, aviso) {
    const ent = t ? new Date(t.entrada) : null;
    F = { id: t ? t.id : null, socio: t ? t.socio_id : (H.socios.find((s) => s.nombre === S.me) || H.socios[0] || {}).id, abierto: !!(t && !t.salida) };
    const fecha = ent ? ymd(ent) : ymd(new Date());
    const titulo = t ? `Turno de ${esc(nombre(t.socio_id))}` : "Cargar turno olvidado";
    openSheet(`<div class="sh"><h3>${titulo}</h3><button class="x" data-close aria-label="Cerrar">✕</button></div>
      ${aviso ? `<p class="faviso">${esc(aviso)}</p>` : ""}
      ${t ? `<p class="muted">${t.origen === "manual" ? "Cargado a mano" : "Fichado con el botón"} · ${esc(cuando(t.entrada))}${t.anulado ? ` · <b class="danger">Anulado: ${esc(t.anulado_motivo || "")}</b>` : ""}</p>`
        : `<div class="who-grid sm">${H.socios.map((s) => `<button data-fhs="${esc(s.id)}" aria-pressed="${F.socio === s.id}"><i>${esc(s.nombre[0])}</i>${esc(s.nombre)}</button>`).join("")}</div>`}
      ${t && t.anulado ? "" : `<div class="ftimes">
        <label>Día<input class="inp" type="date" id="fDia" value="${fecha}" max="${ymd(new Date())}"></label>
        <label>Entró<input class="inp num" type="time" id="fEnt" value="${ent ? hm(t.entrada) : ""}"></label>
        <label>Salió<input class="inp num" type="time" id="fSal" value="${t && t.salida ? hm(t.salida) : ""}" ${F.abierto ? `placeholder="sigue"` : ""}></label>
      </div>
      <p class="muted fnote" id="fDur">${F.abierto ? "Dejá “Salió” vacío si todavía está trabajando." : ""}</p>
      <label class="og">Motivo (opcional)<input class="inp" id="fMot" maxlength="200" placeholder="Ej.: me olvidé de fichar la salida"></label>
      <button class="btn solid big wide" data-fhsave>${t ? "Guardar corrección" : "Cargar turno"}</button>
      <p class="muted fnote">Queda registrado a nombre de <b>${esc(S.me || "—")}</b>, con la hora de antes y la nueva.</p>`}
      ${t ? `<div class="fhist" id="fHist"><p class="muted">Cargando historial…</p></div>` : ""}
      ${t && !t.anulado ? `<details class="anul"><summary>Anular este turno</summary><input class="inp" id="fAnMot" maxlength="200" placeholder="¿Por qué? (ej. se fichó dos veces)"><button class="btn sm" data-fhanular="${t.id}">Anular turno</button></details>` : ""}`);
    durPreview();
    if (t) historial(t.id);
  }
  function leerForm() {
    const dia = ($("#fDia") || {}).value, e = ($("#fEnt") || {}).value, s = ($("#fSal") || {}).value;
    if (!dia || !e) return { err: "Poné el día y la hora de entrada" };
    const entrada = isoAR(dia, e);
    let salida = null;
    if (s) { salida = isoAR(dia, s); if (salida <= entrada) salida = isoAR(addDias(dia, 1), s); } // salió después de medianoche
    else if (!F.abierto) return { err: "Poné la hora de salida" };
    return { entrada, salida };
  }
  function durPreview() {
    const el = $("#fDur"); if (!el || !F) return;
    const r = leerForm();
    if (r.err || !r.salida) { el.textContent = F.abierto ? "Dejá “Salió” vacío si todavía está trabajando." : ""; return; }
    const min = (new Date(r.salida) - new Date(r.entrada)) / 60000;
    el.innerHTML = `Turno de <b>${dur(min)}</b>${ymd(new Date(r.salida)) !== ymd(new Date(r.entrada)) ? " (sale al día siguiente)" : ""}`;
  }
  async function historial(id) {
    const r = await sb.from("fichajes_log").select("*").eq("fichaje_id", id).order("created_at");
    const box = $("#fHist"); if (!box || !F || F.id !== id) return;
    if (r.error) { box.innerHTML = `<p class="muted">${esc(r.error.message)}</p>`; return; }
    const par = (x) => (x ? `${x.entrada ? hm(x.entrada) : "?"} → ${x.salida ? hm(x.salida) : "…"}` : "");
    const txt = (l) => ({
      entrada: `fichó la entrada`, salida: `fichó la salida`, agregar: `cargó el turno a mano: ${par(l.despues)}`,
      editar: `cambió ${par(l.antes)} por ${par(l.despues)}${l.antes && l.despues && ymd(new Date(l.antes.entrada)) !== ymd(new Date(l.despues.entrada)) ? ` (antes era el ${diaLargo(ymd(new Date(l.antes.entrada)))})` : ""}`,
      anular: `anuló el turno`,
    })[l.accion] || l.accion;
    box.innerHTML = `<h4>Historial</h4><ol>${(r.data || []).map((l) => `<li class="${["editar", "agregar", "anular"].includes(l.accion) ? "cambio" : ""}"><b>${esc(l.quien)}</b> ${esc(txt(l))}${l.motivo ? ` · <em>“${esc(l.motivo)}”</em>` : ""}<small>${esc(cuando(l.created_at))}</small></li>`).join("")}</ol>`;
  }

  /* ---------- acciones ---------- */
  async function marcar(id) {
    if (!L.needMe()) return;
    const ab = H.abiertos.find((t) => t.socio_id === id);
    if (ab && Date.now() - new Date(ab.entrada).getTime() > LARGO) return turnoSheet(ab, `${nombre(id)} quedó con el turno abierto desde ${cuando(ab.entrada)}. Poné a qué hora salió y después fichá de nuevo.`);
    H.busy.add(id); view();
    try {
      const t = fail(await sb.rpc("fichaje_marcar", { p_socio: id, p_quien: S.me }));
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
      toast(t.salida ? `${nombre(id)} salió ${hm(t.salida)} · ${dur((new Date(t.salida) - new Date(t.entrada)) / 60000)}` : `${nombre(id)} entró ${hm(t.entrada)}`);
      await cargar();
    } catch (e) { toast(e.message); }
    H.busy.delete(id); view();
  }
  async function guardar(b) {
    if (!L.needMe() || !F) return;
    const r = leerForm(); if (r.err) return toast(r.err);
    if (!F.id && !F.socio) return toast("Elegí de quién es el turno");
    b.disabled = true;
    try {
      fail(await sb.rpc("fichaje_guardar", { p_id: F.id, p_socio: F.socio, p_entrada: r.entrada, p_salida: r.salida, p_motivo: ($("#fMot") || {}).value || null, p_quien: S.me }));
      toast(F.id ? "Turno corregido · queda en el historial" : "Turno cargado");
      closeSheet(); F = null; await cargar(); view();
    } catch (e) { toast(e.message); b.disabled = false; }
  }
  async function anular(id, b) {
    if (!L.needMe()) return;
    const mot = (($("#fAnMot") || {}).value || "").trim(); if (!mot) { toast("Contá por qué se anula"); const i = $("#fAnMot"); if (i) i.focus(); return; }
    b.disabled = true;
    try { fail(await sb.rpc("fichaje_anular", { p_id: id, p_motivo: mot, p_quien: S.me })); toast("Turno anulado"); closeSheet(); F = null; await cargar(); view(); }
    catch (e) { toast(e.message); b.disabled = false; }
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.fhm) return marcar(d.fhm);
    if (d.fhp) { H.per = d.fhp; try { localStorage.setItem("setto-horas-per", H.per); } catch (_) {} H.cargando = true; view(); return cargar().then(view); }
    if (d.fht) { const t = H.turnos.find((x) => x.id === d.fht); if (t) turnoSheet(t); return; }
    if (d.fhnew !== undefined) return turnoSheet(null);
    if (d.fhs && F) { F.socio = d.fhs; document.querySelectorAll("[data-fhs]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.fhs === F.socio))); return; }
    if (d.fhsave !== undefined) return guardar(b);
    if (d.fhanular) return anular(d.fhanular, b);
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (["fDia", "fEnt", "fSal"].includes(t.id)) return durPreview();
    if (t.id === "fhMonto") { H.monto = t.value; const { filas, tot } = resumen(); const box = $("#fhRep"); if (box) box.innerHTML = repartoHtml(filas, tot, parseInt(t.value.replace(/[^\d]/g, ""), 10) || 0); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fhD" || t.id === "fhH") { H[t.id === "fhD" ? "desde" : "hasta"] = t.value; cargar().then(view); }
  });

  window.SettoHoras = {
    view,
    async init() {
      await cargar(); if (S.view === "horas") view();
      if (!H.falta) sb.channel("local-horas").on("postgres_changes", { event: "*", schema: "public", table: "fichajes" }, recargar).subscribe();
      document.addEventListener("visibilitychange", () => { if (!document.hidden && S.view === "horas") recargar(); });
      setInterval(() => { const a = document.activeElement; if (S.view === "horas" && !document.hidden && !document.body.classList.contains("sheet-on") && !(a && a.closest && a.closest("#view input"))) view(); }, 30000); // minutos del turno en curso
    },
    recargar,
  };
})();
