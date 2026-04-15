/**
 * Test end-to-end: simula una conversación donde el cliente confirma la cita.
 * Verifica que el agente llame AMBAS tools: agendar_visita + crear_evento_calendar.
 *
 * NOTA: crea datos REALES en e-admin.mx y Google Calendar.
 */
import "dotenv/config";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../src/config.js";
import { buildSystemPrompt } from "../src/services/system-prompt.js";
import { createTools } from "../src/services/tools.js";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

const history = [
  { role: "user" as const, content: "Hola" },
  { role: "assistant" as const, content: "¡Hola! 👋 Bienvenido/a a Fitness Space.\nEstamos aquí para ayudarte a alcanzar tu mejor versión 💪\n¿Con quién tengo el gusto?" },
  { role: "user" as const, content: "Me llamo Carlos Prueba" },
  { role: "assistant" as const, content: "¡Qué gusto saludarte, Carlos! ¿En qué puedo ayudarte hoy?" },
  { role: "user" as const, content: "Quiero agendar una visita en Taxqueña" },
  { role: "assistant" as const, content: "¡Perfecto! ¿Qué día te gustaría visitar nuestra sucursal de Taxqueña?" },
  { role: "user" as const, content: "El lunes 14 de abril" },
  { role: "assistant" as const, content: "¡Genial! ¿A qué hora aproximadamente te gustaría llegar?" },
  { role: "user" as const, content: "A las 10 de la mañana" },
  { role: "assistant" as const, content: "Perfecto, queda apartado el lunes 14 de abril a las 10:00 👍\nPara confirmar tu visita, ¿me puedes compartir tu correo electrónico?" },
  { role: "user" as const, content: "carlos.prueba@gmail.com" },
  { role: "assistant" as const, content: "¡Gracias! ¿Me compartes tu número de teléfono para confirmar tu visita? 📱" },
  { role: "user" as const, content: "5512345678" },
  { role: "assistant" as const, content: "¿Cómo te gusta hacer tus inversiones para alcanzar tu mejor versión? 💪\n\nPlanes CDMX:\n• Semanal: $200\n• Mensualidad: $550\n• Pago oportuno: $450\n• Bimestre: $800\n• Trimestre: $1,300\n• Semestre: $2,500\n• Anualidad: $4,800\n\n+$50 de credencial" },
  { role: "user" as const, content: "Mensualidad" },
  { role: "assistant" as const, content: "¡Excelente! Ahora cuéntame, Carlos, ¿cuál es tu principal motivación para ir al gimnasio?" },
  { role: "user" as const, content: "Quiero bajar de peso y ganar masa muscular" },
  { role: "assistant" as const, content: "¡Me encanta! Y una última pregunta: ¿Qué tenemos que cumplir sí o sí para que elijas a Fitness Space como tu gimnasio?" },
  { role: "user" as const, content: "Que tenga buen equipo y buena atención" },
  { role: "assistant" as const, content: "¡Gracias por compartirlo, Carlos!\nDéjame confirmar tu visita:\n\n📆 Fecha: lunes 14 de abril de 2026\n🕐 Hora: 10:00 am\n📍 Sucursal: Taxqueña\n📧 Correo: carlos.prueba@gmail.com\n📱 Teléfono: 5512345678\n💰 Plan de interés: Mensualidad\n\n¿Todo está correcto?" },
];

console.log("🧪 Simulando confirmación del cliente...\n");
console.log("Historial: " + history.length + " mensajes");
console.log("Último mensaje del asistente: resumen de la cita");
console.log("Mensaje del usuario: 'Sí, todo correcto'\n");
console.log("━".repeat(60));

const { text, steps } = await generateText({
  model: openrouter("google/gemini-3.1-flash-lite-preview"),
  system: buildSystemPrompt(),
  messages: [
    ...history,
    { role: "user" as const, content: "Sí, todo correcto" },
  ],
  tools: createTools("test:carlos-prueba"),
  maxSteps: 5,
});

console.log("\n━".repeat(60));
console.log("\n📊 RESULTADOS:\n");

console.log("Steps realizados:", steps.length);
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  console.log(`\n--- Step ${i + 1} ---`);
  if (step.toolCalls?.length) {
    for (const tc of step.toolCalls) {
      console.log(`🔧 Tool: ${tc.toolName}`);
      console.log(`   Args: ${JSON.stringify(tc.args, null, 2).split("\n").join("\n   ")}`);
    }
  }
  if (step.toolResults?.length) {
    for (const tr of step.toolResults) {
      console.log(`📋 Result: ${JSON.stringify(tr.result)}`);
    }
  }
}

console.log("\n💬 Respuesta final al cliente:");
console.log(text);
