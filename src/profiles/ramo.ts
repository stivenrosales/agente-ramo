import { buildSystemPrompt } from "../services/system-prompt.js";
import { createTools } from "../services/tools.js";
import type { AgentProfile } from "./types.js";

export const ramoProfile: AgentProfile = {
  id: "ramo",
  name: "Ramo LATAM — SAP Business One",
  llmModel: "google/gemini-3.1-flash-lite-preview",
  buildSystemPrompt,
  createTools: (ctx) => createTools(ctx.contactKey, ctx.conversationId),
};
