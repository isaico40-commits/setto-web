/*
  Costos: motor de cálculo compartido (Caja → Dashboard y Panel → descuentos y premios).
  Mismas reglas que js/caja-costos.js (migración 070):
  - Precio de un insumo = precio del paquete / lo que trae. Con fecha, el último cargado hasta ese día
    (si no había ninguno todavía, el primero), así el margen de un día usa los precios de ese día.
  - Costo por unidad de una receta = suma de ingredientes / (rinde × (1 − merma)).
  - Sets: bebida + mochi de la carta. Box de mochis: la suma de los mochis elegidos.
  Uso: const K = CostosCalc.crear(datos); K.en("2026-11-20").item(item) · K.en(null, { [insumo]: precioPorUnidad }).prod(p, "12 oz")
*/
(function () {
  const NO_PROD = ["envio", "premio", "maquinita", "gift", "codigo"];
  const esSet = (p) => p.categoria === "set" || (p.categoria === "especial" && p.formato === "set");
  const esBebida = (p) => p.categoria === "dirty" || (p.categoria === "especial" && p.formato === "dirty");
  const tamanos = (p) => (esSet(p) || esBebida(p) ? ["12 oz", "16 oz"] : [null]);
  const precioDe = (p, tam) => Number(tam ? p["precio_" + String(tam).slice(0, 2)] : p.precio) || 0;
  const enCarta = (p) => p.activo !== false && ["mochi", "dirty", "especial", "set"].includes(p.categoria);

  // datos = { ins, precios (historial completo de costo_precios), rec (activas), lin, prods }
  function crear(datos) {
    const ins = datos.ins || [], rec = datos.rec || [], lin = datos.lin || [], prods = datos.prods || [];
    const hist = {}; // insumo → precios ordenados de viejo a nuevo
    (datos.precios || []).forEach((p) => (hist[p.insumo_id] = hist[p.insumo_id] || []).push(p));
    Object.values(hist).forEach((l) => l.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.created_at) < String(b.created_at) ? -1 : 1)));
    const insPor = (id) => ins.find((i) => i.id === id);
    const recPor = (id) => rec.find((r) => r.id === id);
    const prodPor = (id) => prods.find((p) => p.id === id);
    const lineasDe = (rid) => lin.filter((l) => l.receta_id === rid).sort((a, b) => a.orden - b.orden);
    const recDe = (pid, tam) => rec.find((r) => r.tipo === "producto" && r.product_id === pid && (r.tamano || null) === (tam || null));
    const unidad = (p) => Number(p.precio) / Number(p.paquete);
    const precioEn = (iid, fecha) => {
      const l = hist[iid]; if (!l || !l.length) return null;
      if (!fecha) return l[l.length - 1];
      let r = l[0]; for (const p of l) { if (p.fecha <= fecha) r = p; else break; } return r;
    };
    const cache = {};
    // calculadora para un día (null = hoy) y, si hace falta, precios por unidad forzados (simulaciones y alertas)
    function en(fecha, over) {
      const key = (fecha || "hoy") + (over ? JSON.stringify(over) : "");
      if (cache[key]) return cache[key];
      const memo = {}, porProd = {};
      const precioU = (iid) => (over && over[iid] != null ? over[iid] : (() => { const p = precioEn(iid, fecha); return p ? unidad(p) : null; })());
      function recUnit(id, stack) {
        if (memo[id]) return memo[id];
        const r = recPor(id);
        if (!r) return { unit: null, total: 0, faltan: new Set(["una preparación borrada"]) };
        if (stack.includes(id)) return { unit: 0, total: 0, faltan: new Set() };
        let total = 0; const faltan = new Set();
        lineasDe(id).forEach((l) => {
          const q = Number(l.cantidad) || 0;
          if (l.insumo_id) { const pu = precioU(l.insumo_id); if (pu == null) faltan.add((insPor(l.insumo_id) || {}).nombre || "un insumo"); else total += q * pu; }
          else if (l.sub_id) { const s = recUnit(l.sub_id, [...stack, id]); s.faltan.forEach((f) => faltan.add(f)); if (s.unit != null) total += q * s.unit; }
        });
        const ef = Number(r.rinde) * (1 - (Number(r.merma) || 0) / 100);
        return (memo[id] = { total, unit: ef > 0 ? total / ef : null, faltan });
      }
      // costo de un producto en un tamaño; ok = receta completa con todos los precios
      function prod(p, tam, b, m) {
        if (typeof p === "string") p = prodPor(p);
        if (!p) return { cost: null, ok: false };
        if (esSet(p)) {
          tam = tam || "12 oz";
          const pb = prodPor(b || p.set_bebida), pm = prodPor(m || p.set_mochi);
          const cb = pb ? prod(pb, tam) : { cost: null, ok: false }, cm = pm ? prod(pm, null) : { cost: null, ok: false };
          return { cost: cb.cost != null || cm.cost != null ? (cb.cost || 0) + (cm.cost || 0) : null, ok: cb.ok && cm.ok };
        }
        if (esBebida(p)) tam = tam || "12 oz"; else tam = null;
        const k = p.id + "|" + (tam || "");
        if (porProd[k]) return porProd[k];
        const r = recDe(p.id, tam);
        if (!r) return (porProd[k] = { cost: null, ok: false });
        const c = recUnit(r.id, []);
        return (porProd[k] = { cost: c.faltan.size && !c.total ? null : c.unit, ok: !c.faltan.size && c.unit != null });
      }
      // un ítem vendido (pedido web, comanda del local o entrada de la Caja con productos)
      function item(i) {
        const q = Number(i.qty) || 0;
        if (!i || NO_PROD.includes(i.id)) return { cost: 0, ok: true, skip: true };
        const p = prodPor(i.id);
        if (!p) return { cost: null, ok: false };
        let c;
        if (Array.isArray(i.mochis) && i.mochis.length && !esSet(p)) { // box: los mochis que eligió
          const cs = i.mochis.map((id) => prod(id, null));
          c = { cost: cs.reduce((a, x) => a + (x.cost || 0), 0), ok: cs.every((x) => x.ok) };
        } else c = prod(p, i.size || null, i.bebida || null, esSet(p) && Array.isArray(i.mochis) ? i.mochis[0] : null);
        return { cost: c.cost == null ? null : c.cost * q, ok: c.ok && c.cost != null };
      }
      return (cache[key] = { precioU, prod, item });
    }
    // filas de la carta: cada producto en cada tamaño con su costo, precio y margen
    function carta(calc) {
      calc = calc || en(null);
      return prods.filter(enCarta).flatMap((p) => tamanos(p).map((t) => {
        const c = calc.prod(p, t), pr = precioDe(p, t);
        return { p, t, key: p.id + "|" + (t || ""), cost: c.cost, ok: c.ok, pr, m: c.ok && pr > 0 ? (pr - c.cost) / pr : null };
      }));
    }
    // productos de la carta que usan un insumo (directo o dentro de una preparación)
    function usaInsumo(iid) {
      const usa = {}, tiene = (rid, stack = []) => {
        if (usa[rid] != null) return usa[rid]; if (stack.includes(rid)) return false;
        return (usa[rid] = lineasDe(rid).some((l) => l.insumo_id === iid || (l.sub_id && tiene(l.sub_id, [...stack, rid]))));
      };
      return (p, t) => {
        if (esSet(p)) { const b = prodPor(p.set_bebida), m = prodPor(p.set_mochi); return (b && usaInsumoProd(b, t)) || (m && usaInsumoProd(m, null)); }
        return usaInsumoProd(p, t);
      };
      function usaInsumoProd(p, t) { const r = recDe(p.id, esBebida(p) ? t || "12 oz" : null); return !!r && tiene(r.id); }
    }
    // cada cambio de precio por unidad de cada insumo, del más nuevo al más viejo
    function cambios() {
      const out = [];
      Object.entries(hist).forEach(([iid, l]) => {
        for (let k = 1; k < l.length; k++) {
          const a = unidad(l[k - 1]), b = unidad(l[k]); if (!(a > 0)) continue;
          out.push({ id: l[k].id, insumo: insPor(iid) || { id: iid, nombre: "(borrado)" }, iid, antes: l[k - 1], ahora: l[k], pa: a, pb: b, d: (b - a) / a, ultimo: k === l.length - 1 });
        }
      });
      return out.sort((x, y) => (x.ahora.fecha < y.ahora.fecha ? 1 : x.ahora.fecha > y.ahora.fecha ? -1 : String(x.ahora.created_at) < String(y.ahora.created_at) ? 1 : -1));
    }
    return { en, carta, usaInsumo, cambios, insPor, prodPor, hist, precioEn, unidad };
  }

  // margen después de cobrar "cobra" por algo que cuesta "costo" (null si no hay datos)
  const margen = (cobra, costo) => (costo == null || !(cobra > 0) ? (costo > 0 ? -Infinity : null) : (cobra - costo) / cobra);
  // precio que recupera un margen: costo / (1 − m), redondeado para arriba a $100
  const precioPara = (costo, m) => Math.ceil(costo / (1 - m) / 100) * 100;

  // Costos fijos (alquiler, luz, gas…): cuánto % de cada venta se los lleva.
  //   fijos: [{monto, activo}] por mes · ventas: [{fecha 'AAAA-MM-DD', monto}] entradas de la Caja · hoy: 'AAAA-MM-DD'
  //   Facturación del mes = promedio por día de los últimos 28 días (sin contar hoy, y desde el primer día con ventas) × 30.
  function tasaFijos(fijos, ventas, hoy) {
    const total = (fijos || []).filter((f) => f.activo !== false).reduce((a, f) => a + (Number(f.monto) || 0), 0);
    const d = new Date(hoy + "T12:00:00"); d.setDate(d.getDate() - 28);
    const desde = d.toISOString().slice(0, 10);
    const vs = (ventas || []).filter((v) => v.fecha >= desde && v.fecha < hoy);
    if (!total) return { total: 0, mes: null, tasa: 0, dias: 0 };
    if (!vs.length) return { total, mes: null, tasa: null, dias: 0 };
    const ini = vs.reduce((a, v) => (v.fecha < a ? v.fecha : a), hoy);
    const dias = Math.max(1, Math.round((new Date(hoy + "T12:00:00") - new Date(ini + "T12:00:00")) / 864e5));
    const mes = (vs.reduce((a, v) => a + (Number(v.monto) || 0), 0) / dias) * 30;
    return { total, mes, tasa: mes > 0 ? total / mes : null, dias };
  }

  window.CostosCalc = { crear, margen, precioPara, esSet, esBebida, tamanos, precioDe, enCarta, NO_PROD, tasaFijos };
})();
