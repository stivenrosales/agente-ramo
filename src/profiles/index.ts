import { ACTIVE_PROFILE } from "./active.js";
import { ramoProfile } from "./ramo.js";
import { demoProfile } from "./demo.js";
import { ventasProfile } from "./ventas.js";
import type { AgentProfile, ProfileId } from "./types.js";

const registry: Record<ProfileId, AgentProfile> = {
  ramo: ramoProfile,
  demo: demoProfile,
  ventas: ventasProfile,
};

export function getActiveProfile(): AgentProfile {
  return registry[ACTIVE_PROFILE];
}

export type { AgentProfile, ProfileId } from "./types.js";
