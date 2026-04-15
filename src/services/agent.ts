import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createTools } from "./tools.js";
import type { ChatMessage, Contact } from "../types.js";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

const MODEL = "google/gemini-3.1-flash-lite-preview";
const MAX_STEPS = 6;

function buildContactContext(contact: Contact | null): string {
  if (!contact) return "";

  const lines: string[] = ["", "---", "", "## FICHA DEL CONTACTO"];
  if (contact.name) lines.push(`Nombre: ${contact.name}`);
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
    "**IMPORTANTE**: este cliente ya te habló antes. NO vuelvas a pedir datos que ya están en la ficha. Salúdalo por su nombre.",
  );
  return lines.join("\n");
}

export const agent = {
  async chat(
    userMessage: string,
    history: ChatMessage[],
    contactKey: string,
    contact: Contact | null = null,
  ): Promise<string> {
    const messages = [
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: userMessage },
    ];

    const systemPrompt = buildSystemPrompt() + buildContactContext(contact);
    const tools = createTools(contactKey);

    const { text } = await generateText({
      model: openrouter(MODEL),
      system: systemPrompt,
      messages,
      tools,
      maxSteps: MAX_STEPS,
    });

    return text;
  },
};
