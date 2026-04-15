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
const MAX_STEPS = 5;

function buildContactContext(contact: Contact | null): string {
  if (!contact) return "";

  const lines: string[] = ["", "---", "", "## CONTACTO CONOCIDO"];
  if (contact.name) lines.push(`Nombre: ${contact.name}`);
  if (contact.phone) lines.push(`Teléfono: ${contact.phone}`);
  if (contact.email) lines.push(`Correo: ${contact.email}`);
  if (contact.preferred_sucursal)
    lines.push(`Sucursal preferida: ${contact.preferred_sucursal}`);
  if (contact.investment_plan)
    lines.push(`Plan de interés: ${contact.investment_plan}`);
  if (contact.motivation) lines.push(`Motivación: ${contact.motivation}`);
  if (contact.requirement) lines.push(`Requisito: ${contact.requirement}`);
  if (contact.notes) lines.push(`Notas: ${contact.notes}`);

  if (lines.length === 4) return ""; // no data

  lines.push("");
  lines.push(
    "**IMPORTANTE**: Este cliente YA te ha hablado antes. NO preguntes datos " +
      "que ya tenés en la ficha (nombre, correo, teléfono, etc.). Saludalo por " +
      "su nombre como a un conocido. Si volvió a escribir, probablemente quiere " +
      "seguir con algo que dejamos pendiente o tiene una nueva consulta.",
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
