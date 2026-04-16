import type { Tool } from "ai";

export type ProfileId = "ramo" | "demo";

export interface ProfileContext {
  contactKey: string;
  conversationId: number | string;
}

export interface AgentProfile {
  id: ProfileId;
  name: string;
  llmModel: string;
  buildSystemPrompt: (ctx?: {
    /** Mensaje actual del usuario + historial disponible al momento de construir el prompt. */
    hasConvenio?: boolean;
  }) => string;
  /** Opcional. Si el perfil no expone tools, el runtime llama al LLM en modo conversación pura. */
  createTools?: (ctx: ProfileContext) => Record<string, Tool>;
  /**
   * Si true, el runtime excluye el campo "Nombre" de la ficha del contacto que se
   * inyecta al LLM. Útil para perfiles donde el nombre del WhatsApp del cliente
   * no debe usarse (ej. sales bots donde el cliente debe presentarse).
   */
  hideContactName?: boolean;
}
