// Cliente de Supabase con service_role y chequeos de acceso para las Edge Functions del CRM.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const env = (k: string) => Deno.env.get(k) ?? "";
export const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
export const VERSION = env("META_GRAPH_VERSION") || "v23.0";

export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...CORS } });

// llamadas desde la base (triggers): misma clave que push-pedido, guardada en Vault
export async function hookValido(req: Request) {
  const { data } = await sb.rpc("push_config");
  return !!data?.push_hook_secret && req.headers.get("x-setto-hook") === data.push_hook_secret;
}

// llamadas desde el panel: usuario logueado que esté en la tabla staff
export async function esEquipo(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: st } = await sb.from("staff").select("user_id").eq("user_id", u.user.id).maybeSingle();
  return st ? u.user.id : null;
}

export async function graph(path: string, metodo: "GET" | "POST" | "DELETE", body?: unknown) {
  const token = env("META_ACCESS_TOKEN");
  const url = `https://graph.facebook.com/${VERSION}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error?.error_user_msg || data.error?.message || `Meta respondió ${r.status}`);
  return data;
}

export const logSync = (tipo: "capi" | "audiencia", ref: string, estado: "ok" | "error" | "omitido", registros = 0, detalle = "") =>
  sb.from("marketing_sync_logs").insert({ tipo, ref, estado, registros, detalle: detalle.slice(0, 500) });
