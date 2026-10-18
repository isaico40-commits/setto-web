// Edge Function · meta-capi
// La llama el trigger orders_capi (migración 032) cuando un pedido pasa a entregado: manda Purchase a Meta desde el servidor.
// Usa el mismo event_id que el pixel del navegador ("pedido-<código>"), así Meta la cuenta una sola vez.
// Solo manda si la persona aceptó el pixel al pedir (datos del navegador) o aceptó anuncios con su celular (celular cifrado).
// Secretos: META_ACCESS_TOKEN, META_PIXEL_ID; opcionales META_TEST_EVENT_CODE (para Probar eventos) y SITE_URL.
import { env, sb, hookValido, graph, logSync, json } from "../_shared/supa.ts";
import { eventoPurchase } from "../_shared/crm.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" || !(await hookValido(req))) return json({ error: "no autorizado" }, 401);
  const { order_id } = await req.json().catch(() => ({}));
  const { data: o } = await sb.from("orders").select("id,code,total,items,closed_at,phone,status,capi_at,landing_page,origen").eq("id", order_id).maybeSingle();
  if (!o || o.status !== "entregado" || o.capi_at) return json({ ok: true, omitido: "no corresponde" });
  if (!env("META_ACCESS_TOKEN") || !env("META_PIXEL_ID")) { await logSync("capi", o.code, "omitido", 0, "faltan credenciales"); return json({ ok: true, omitido: "faltan credenciales" }); }

  const { data: ads } = await sb.rpc("puede_contactar", { p_phone: o.phone, p_canal: "meta_ads" });
  const ev = await eventoPurchase(o, { px: !!o.origen?.px, ads: !!ads }, env("SITE_URL"));
  if (!ev) { await logSync("capi", o.code, "omitido", 0, "sin permiso de medición ni de anuncios"); return json({ ok: true, omitido: "sin permiso" }); }
  try {
    const test = env("META_TEST_EVENT_CODE");
    const r = await graph(`${env("META_PIXEL_ID")}/events`, "POST", { data: [ev], ...(test ? { test_event_code: test } : {}) });
    await sb.from("orders").update({ capi_at: new Date().toISOString() }).eq("id", o.id);
    await logSync("capi", o.code, "ok", r.events_received ?? 1, test ? "modo prueba" : "");
    return json({ ok: true });
  } catch (e) {
    await logSync("capi", o.code, "error", 0, (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 502);
  }
});
