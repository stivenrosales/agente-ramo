import type { AgentProfile } from "./types.js";

/**
 * Perfil DEMO — prompt duro, sin tools.
 *
 * Reemplaza el contenido de DEMO_PROMPT con el texto real cuando el usuario
 * entregue los documentos de la personalidad. Mientras tanto, este placeholder
 * responde de forma genérica para que la infra no rompa si alguien activa el
 * perfil antes de tener el prompt final.
 */
const DEMO_PROMPT = `
Eres un asistente virtual en modo DEMO.

Este perfil aún no tiene un prompt definitivo. Pide disculpas al usuario de forma
amable y dile que el bot está en configuración. Mantén respuestas cortas (1-2 líneas),
tono cálido y profesional en español neutro latinoamericano.

No inventes productos, servicios, precios ni personas. Si el usuario insiste, sugiérele
volver más tarde.
`;

export const demoProfile: AgentProfile = {
  id: "demo",
  name: "Demo — placeholder",
  llmModel: "google/gemini-3.1-flash-lite-preview",
  buildSystemPrompt: () => DEMO_PROMPT.trim(),
  // Sin createTools — el runtime correrá en modo conversación pura.
};
