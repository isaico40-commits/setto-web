// Edge Function · whatsapp-plantillas (la llama el panel con la sesión del equipo, desde Campañas)
//   { accion: "listar" }            → plantillas de la cuenta de WhatsApp con su estado (APPROVED, PENDING, REJECTED…)
//   { accion: "crear", plantilla }  → la valida y la manda a Meta para aprobar (categoría marketing, siempre con "No quiero más novedades")
// No edita ni borra: en Meta un nombre borrado no se puede volver a usar, así que para cambiar una se hace otra.
// Secretos: META_ACCESS_TOKEN, SITE_URL (para el botón a la web). WA_WABA_ID es opcional (por defecto la cuenta de Setto).
import { env, esEquipo, graph, json, CORS } from "../_shared/supa.ts";
import { validarPlantilla, componentesPlantilla, plantillaParaPanel } from "../_shared/crm.ts";

const WABA = () => env("WA_WABA_ID").replace(/\D/g, "") || "1427186512680891";

async function listar() {
  const d = await graph(`${WABA()}/message_templates?fields=name,status,category,language,components,rejected_reason&limit=100`, "GET");
  return (d.data ?? []).map(plantillaParaPanel);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await esEquipo(req))) return json({ error: "Solo el equipo puede ver y crear plantillas" }, 401);
  if (!env("META_ACCESS_TOKEN")) return json({ error: "Faltan las credenciales de WhatsApp en los secretos de Supabase" }, 400);
  const { accion, plantilla } = await req.json().catch(() => ({}));
  try {
    if (accion === "listar") return json({ plantillas: await listar() });
    if (accion === "crear") {
      const errores = validarPlantilla(plantilla);
      if (plantilla?.link && !env("SITE_URL")) errores.push("Falta SITE_URL en los secretos de Supabase para el botón a la web");
      if (errores.length) return json({ error: errores.join(". ") }, 400);
      if ((await listar()).some((t: { nombre: string }) => t.nombre === plantilla.nombre)) return json({ error: "Ya hay una plantilla con ese nombre. Usá otro (por ejemplo, sumale _v2)" }, 409);
      const r = await graph(`${WABA()}/message_templates`, "POST", componentesPlantilla(plantilla, env("SITE_URL")));
      return json({ ok: true, id: r.id, estado: r.status, categoria: r.category });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: `Meta respondió: ${(e as Error).message}` }, 502);
  }
});
