import type { ProfileId } from "./types.js";

/**
 * ÚNICO punto de switch entre agentes.
 * Cambia esta constante, commitea y pushea → EasyPanel redeploy automático en ~30s.
 *
 *   "ramo"     → agente Ramo LATAM (SAP Business One) con tools de agendamiento.
 *   "demo"     → agente demostración (solo prompt, sin tools).
 *   "ventas"   → asistente multi-marca: Salomon Store Perú + Wilson Store Perú.
 *   "autosell" → asistente de venta consultiva: Autosell (autos seminuevos Lima).
 */
export const ACTIVE_PROFILE: ProfileId = "autosell";
