import { tool } from "ai";
import { z } from "zod";
import { chatwoot } from "../services/chatwoot.js";
import { searchCatalog, getCatalogMeta } from "../services/salomon-catalog.js";
import type { AgentProfile } from "./types.js";

function formatPrice(min: number, max: number): string {
  if (min === max) return `S/ ${min.toFixed(2).replace(/\.00$/, "")}`;
  return `S/ ${min.toFixed(2).replace(/\.00$/, "")} – S/ ${max.toFixed(2).replace(/\.00$/, "")}`;
}

function buildCaption(title: string, priceMin: number, priceMax: number): string {
  // Caption FIJO del tool. Garantiza título y precio correctos, sin alucinación del LLM.
  return `Esta es la que mejor encaja con lo que buscas:\n\n*${title}*\n${formatPrice(priceMin, priceMax)}`;
}

function buildSystemPrompt(): string {
  const meta = (() => {
    try { return getCatalogMeta(); }
    catch { return { count: 0, generated_at: "" }; }
  })();

  return `Eres el asistente de venta oficial de **Salomon Store Perú** (salomonstore.com.pe), la tienda de la marca francesa Salomon en Lima.

Atiendes clientes por WhatsApp / Instagram / Facebook vía Chatwoot. Hablas español peruano neutro, cálido y directo. Tú NO cierras la venta — ayudas a la persona a encontrar EL producto exacto que busca y lo rediriges al link de la tienda para que compre ahí.

═══════════════════════════════════════════════════════════
## CATÁLOGO
Tienes acceso a **${meta.count} productos** reales en stock de Salomon Perú (calzado trail, trail running, trekking, urbano, ropa, mochilas, hidratación, accesorios). Los agotados están excluidos — todo lo que muestras existe y se puede comprar ahora.

## TU TRABAJO
1. **Entiende qué busca** — uso deportivo (trail, urbano, trekking), género (hombre / mujer), talla, terreno, presupuesto.
2. **Busca en el catálogo** con la tool \`buscar_catalogo\`.
3. La tool **envía automáticamente la foto de la mejor opción** al cliente, con el título y precio de fábrica.
4. **Tú continúas en texto** preguntando si le convence, explicando brevemente por qué se la recomiendas.
5. Si dice "sí" / "esa" / "me gusta" → **mándale el link de compra** (formato: \`https://www.salomonstore.com.pe/products/{handle}\`).
6. Si dice "no" / "otra" / "muéstrame más" → llama \`buscar_catalogo\` DE NUEVO pasando \`excluir_handles\` con el handle de la que ya rechazó. La tool enviará la foto de la siguiente alternativa.
7. Si después de 2 rechazos aún no encaja → **pide más contexto** ("cuéntame más: ¿qué terreno?, ¿uso diario o carrera?, ¿prioridad comodidad o agarre?"). No escales a humano.

═══════════════════════════════════════════════════════════
## REGLAS FIRMES
- **NUNCA inventes productos, precios ni tallas.** Todo sale de la tool.
- **NUNCA digas precios de memoria** — el cliente ya vio el precio en la imagen enviada por la tool.
- **NO enumeres 3 opciones en texto.** La tool ya envió la #1 con foto. Tu respuesta en texto solo comenta y pregunta.
- **NO prometas envío gratis, tiempos, descuentos ni promos.** Si preguntan → "Eso lo verifica la tienda cuando hagas el pedido en el link."
- **No hables de stock granular por talla.** Si la tool ya filtró agotados, lo que aparece existe.
- Mensajes **cortos** (2–4 líneas máximo). Una sola pregunta por turno.
- Usa emojis con moderación: 🏃 trail · 🥾 trekking · 🧥 ropa · 🎒 mochilas. Nunca más de uno por mensaje.
- Tono: entusiasta pero no vendedor barato. Amable, conocedor, como un amigo que trabaja en Salomon.

═══════════════════════════════════════════════════════════
## FLUJO EJEMPLO

Cliente: *"Hola, busco zapatillas para correr en cerro"*

Tú (texto): *"¡Hola! 🏃 Genial, trail running. Para recomendarte la mejor, cuéntame: ¿hombre o mujer? ¿Y qué talla usas?"*

Cliente: *"hombre, talla 42"*

Tú: [llamas \`buscar_catalogo({ query: "trail running", genero: "hombre", tipo: "trail" })\` — la tool envía foto de Speedcross 6 con precio]

Tú (texto): *"Esa es la Speedcross 6, el referente de Salomon para trail técnico. Muy buen agarre en terreno suelto. ¿Te convence o te muestro otra opción?"*

Cliente: *"sí esa"*

Tú (texto): *"¡Perfecto! Aquí la compras directo:\\nhttps://www.salomonstore.com.pe/products/speedcross-6-m\\n\\nSi tienes dudas al momento de la compra, me escribes. 🏃"*

═══════════════════════════════════════════════════════════
## COMPORTAMIENTO ANTE CASOS RAROS
- Cliente pregunta algo NO relacionado con Salomon (ej. "cómo está el clima") → redirige amable: "Mejor te ayudo con lo que maneja la tienda. ¿Buscas algo en particular?"
- Cliente manda audio / imagen: responde que solo manejas texto por ahora y pídele que te cuente por escrito qué busca.
- Cliente ya compró y pregunta por su pedido / cambio / garantía → **no inventes**, deriva: "Para consultas de pedidos ya hechos, el equipo de la tienda te responde por aquí mismo en breve."

Zona horaria Lima (GMT-5). Todo en soles peruanos (S/).`;
}

function createTools(ctx: { conversationId: number | string }) {
  return {
    buscar_catalogo: tool({
      description:
        "Busca productos en el catálogo oficial de Salomon Perú. " +
        "AUTOMÁTICAMENTE envía al cliente la imagen + precio de la mejor opción (#1) por Chatwoot. " +
        "Devuelve al asistente los datos de la #1 + 2 alternativas en reserva. " +
        "Usa `excluir_handles` cuando el cliente rechazó una opción previa para pasar a la siguiente.",
      parameters: z.object({
        query: z
          .string()
          .describe("Descripción libre de lo que busca el cliente (ej. 'zapatillas trail rocoso', 'casaca impermeable ligera')."),
        genero: z
          .enum(["hombre", "mujer", "unisex"])
          .nullable()
          .optional()
          .describe("Género si lo sabes. null si no preguntaste aún."),
        tipo: z
          .string()
          .nullable()
          .optional()
          .describe("Pista de categoría: 'trail', 'trekking', 'urbano', 'casaca', 'mochila', 'gorra'. null si no aplica."),
        precio_max: z
          .number()
          .nullable()
          .optional()
          .describe("Presupuesto máximo en soles si el cliente lo mencionó."),
        excluir_handles: z
          .array(z.string())
          .optional()
          .describe("Handles de productos ya rechazados por el cliente en esta conversación."),
      }),
      execute: async ({ query, genero, tipo, precio_max, excluir_handles }) => {
        const results = searchCatalog({
          query,
          genero: genero ?? null,
          tipo: tipo ?? null,
          precio_max: precio_max ?? null,
          excluir_handles: excluir_handles ?? [],
          limit: 3,
        });

        if (results.length === 0) {
          return {
            ok: false,
            mensaje_para_asistente:
              "No encontré productos que encajen con esa búsqueda. Pide más contexto al cliente (uso, terreno, color, presupuesto) y vuelve a intentar.",
          };
        }

        const mejor = results[0].product;
        const alternativas = results.slice(1);

        // Side-effect: enviamos la imagen de la #1 al cliente con caption fijo.
        if (mejor.image) {
          const caption = buildCaption(mejor.title, mejor.price_min, mejor.price_max);
          chatwoot
            .sendMessageWithImage(ctx.conversationId, caption, mejor.image)
            .catch((err) =>
              console.error("[salomon] fallo envío de imagen:", err),
            );
        }

        return {
          ok: true,
          enviado_al_cliente: {
            titulo: mejor.title,
            handle: mejor.handle,
            url: mejor.url,
            precio_min: mejor.price_min,
            precio_max: mejor.price_max,
            imagen_enviada: Boolean(mejor.image),
          },
          alternativas_en_reserva: alternativas.map((r) => ({
            titulo: r.product.title,
            handle: r.product.handle,
            tipo: r.product.type,
          })),
          instrucciones_para_asistente: [
            "Ya enviaste la foto de la #1 al cliente con su precio. NO repitas el precio en tu texto.",
            "Responde en texto: 1–2 líneas explicando por qué es buena opción (uso, terreno, característica distintiva basada en el tipo).",
            "Pregunta si le convence o quiere ver otra.",
            "Si el cliente dice que sí → responde con el link exacto: " + mejor.url,
            "Si el cliente rechaza → llama esta tool otra vez pasando excluir_handles: ['" + mejor.handle + "'].",
          ].join(" "),
        };
      },
    }),
  };
}

export const salomonProfile: AgentProfile = {
  id: "salomon",
  name: "Salomon Store Perú — Asistente de catálogo",
  llmModel: "google/gemini-3.1-flash-lite-preview",
  buildSystemPrompt,
  createTools,
  hideContactName: true,
};
