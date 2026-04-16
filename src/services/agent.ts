import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";
import { getActiveProfile } from "../profiles/index.js";
import type { ChatMessage, Contact } from "../types.js";

export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

// Modelo por defecto si el profile no declara uno explícito (no debería pasar).
export const AGENT_MODEL = "google/gemini-3.1-flash-lite-preview";
const MAX_STEPS = 6;

function buildContactContext(
  contact: Contact | null,
  hideContactName = false,
): string {
  if (!contact) return "";

  const lines: string[] = ["", "---", "", "## FICHA DEL CONTACTO"];
  if (contact.name && !hideContactName) lines.push(`Nombre: ${contact.name}`);
  if (contact.empresa) lines.push(`Empresa: ${contact.empresa}`);
  if (contact.cargo) lines.push(`Cargo: ${contact.cargo}`);
  if (contact.ruc) lines.push(`RUC: ${contact.ruc}`);
  if (contact.email) lines.push(`Correo: ${contact.email}`);
  if (contact.phone) lines.push(`Teléfono: ${contact.phone}`);
  if (contact.necesidad) lines.push(`Necesidad: ${contact.necesidad}`);
  if (contact.modalidad) lines.push(`Modalidad preferida: ${contact.modalidad}`);
  if (contact.notes) lines.push(`Notas: ${contact.notes}`);

  if (lines.length === 4) return "";

  lines.push(
    "",
    "**IMPORTANTE**: este cliente ya te habló antes. NO vuelvas a pedir datos que ya están en la ficha. Saludalo por su nombre.",
  );
  return lines.join("\n");
}

export const agent = {
  async chat(
    userMessage: string,
    history: ChatMessage[],
    contactKey: string,
    conversationId: number | string,
    contact: Contact | null = null,
  ): Promise<string> {
    const profile = getActiveProfile();

    const messages = [
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: userMessage },
    ];

    // Detección estricta de [convenio] en cualquier mensaje del usuario de esta conversación.
    // Si nunca apareció, el prompt del perfil no debe exponer la lógica de descuento.
    const hasConvenio = [...history, { role: "user", content: userMessage }]
      .filter((m) => m.role === "user")
      .some((m) => /^\s*\[convenio\]/i.test(m.content));

    const systemPrompt =
      profile.buildSystemPrompt({ hasConvenio }) +
      buildContactContext(contact, profile.hideContactName);

    // Si el profile no tiene tools → conversación pura.
    const tools = profile.createTools
      ? profile.createTools({ contactKey, conversationId })
      : undefined;

    const { text } = await generateText({
      model: openrouter(profile.llmModel),
      system: systemPrompt,
      messages,
      tools,
      maxSteps: tools ? MAX_STEPS : 1,
    });

    return text;
  },
};
