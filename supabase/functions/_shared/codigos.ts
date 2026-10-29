// Códigos de descuento en campañas y automáticas (migración 053).
// En las variables de la plantilla: {codigo} = código personal de cada destinatario, {vence} = hasta qué día vale (ej. "5/11").
import { sb } from "./supa.ts";

export const usaCodigo = (vars: unknown[]) => (vars || []).some((v) => /\{(codigo|vence)\}/.test(String(v)));

const dia = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

// variables con el código de esta persona ya puesto; genera (o reusa, si no lo usó) un código de la promo para ese celular
export async function variablesConCodigo(vars: string[], promoId: string | null, phone: string, ref: { campaign_id?: string; automation_id?: string }) {
  if (!usaCodigo(vars)) return { variables: vars };
  if (!promoId) return { error: "La plantilla usa {codigo} pero no tiene un código de descuento elegido" };
  const { data, error } = await sb.rpc("promo_codigo_nuevo", { p_promo: promoId, p_phone: phone, p_campaign: ref.campaign_id ?? null, p_automation: ref.automation_id ?? null });
  if (error || !data?.code) return { error: error?.message || "No se pudo generar el código" };
  if (vars.some((v) => String(v).includes("{vence}")) && !data.vence_at) return { error: "La plantilla usa {vence} pero el código no tiene vencimiento" };
  const vence = data.vence_at ? dia(data.vence_at) : "";
  return { variables: vars.map((v) => String(v).replace(/\{codigo\}/g, data.code).replace(/\{vence\}/g, vence)), code: data.code as string };
}
