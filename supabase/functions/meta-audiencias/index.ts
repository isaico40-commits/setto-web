// Edge Function · meta-audiencias (la llama el panel con la sesión del equipo)
// Mantiene un público personalizado de Meta por segmento ("Setto · <segmento>") con los clientes que aceptaron anuncios.
// Suma los nuevos y saca a quienes se dieron de baja o ya no entran en el segmento. Los celulares viajan cifrados (SHA-256).
// Secretos: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (solo números).
import { env, sb, esEquipo, graph, logSync, json, CORS } from "../_shared/supa.ts";
import { hashCelular, diferencia, tandas } from "../_shared/crm.ts";

const SEGMENTOS = ["todos", "nuevos", "recurrentes", "fans_mochis", "bebidas", "inactivos"];

async function publico(cuenta: string, seg: string) {
  const nombre = `Setto · ${seg}`;
  const l = await graph(`act_${cuenta}/customaudiences?fields=id,name&limit=200`, "GET");
  const ya = (l.data ?? []).find((a: { name: string }) => a.name === nombre);
  if (ya) return ya.id as string;
  const n = await graph(`act_${cuenta}/customaudiences`, "POST", { name: nombre, subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY",
    description: `Clientes de Setto del segmento "${seg}" que aceptaron anuncios con su celular. Lo actualiza la web.` });
  return n.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await esEquipo(req))) return json({ error: "Solo el equipo puede sincronizar" }, 401);
  const cuenta = env("META_AD_ACCOUNT_ID").replace(/\D/g, "");
  if (!env("META_ACCESS_TOKEN") || !cuenta) return json({ error: "Faltan las credenciales de Meta en los secretos de Supabase" }, 400);
  const res: Record<string, unknown> = {};
  for (const seg of SEGMENTOS) {
    try {
      const { data: lista, error } = await sb.rpc("segmento_clientes", { p_segmento: seg, p_canal: "meta_ads" });
      if (error) throw new Error(error.message);
      const deseados = await Promise.all(((lista ?? []) as { phone: string }[]).map((x) => hashCelular(x.phone)));
      const { data: act } = await sb.from("audience_members").select("phone_hash").eq("audiencia", seg);
      const { sumar, sacar } = diferencia(deseados, (act ?? []).map((x: { phone_hash: string }) => x.phone_hash));
      if (!sumar.length && !sacar.length) { res[seg] = { sumados: 0, sacados: 0 }; continue; }
      const id = await publico(cuenta, seg);
      for (const t of tandas(sumar, 5000)) {
        await graph(`${id}/users`, "POST", { payload: { schema: ["PHONE"], data: t.map((h) => [h]) } });
        await sb.from("audience_members").upsert(t.map((h) => ({ audiencia: seg, phone_hash: h })));
      }
      for (const t of tandas(sacar, 5000)) {
        await graph(`${id}/users`, "DELETE", { payload: { schema: ["PHONE"], data: t.map((h) => [h]) } });
        await sb.from("audience_members").delete().eq("audiencia", seg).in("phone_hash", t);
      }
      await logSync("audiencia", seg, "ok", sumar.length + sacar.length, `+${sumar.length} −${sacar.length}`);
      res[seg] = { sumados: sumar.length, sacados: sacar.length };
    } catch (e) {
      await logSync("audiencia", seg, "error", 0, (e as Error).message);
      res[seg] = { error: (e as Error).message };
    }
  }
  return json({ ok: true, segmentos: res });
});
