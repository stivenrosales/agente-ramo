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
  // Caption base FIJO. Garantiza título y precio correctos, sin alucinación del LLM.
  return `*${title}*\n${formatPrice(priceMin, priceMax)}`;
}

const CAROUSEL_PREFIXES = ["", "Otra opción:\n", "Y si buscas algo distinto:\n"];

function buildCarouselCaption(
  position: 0 | 1 | 2,
  title: string,
  priceMin: number,
  priceMax: number,
): string {
  return CAROUSEL_PREFIXES[position] + buildCaption(title, priceMin, priceMax);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cache in-memory de productos mostrados por contacto ────────────────
// Evita repetir el mismo modelo cuando el LLM no pasa excluir_handles.
// TTL: 30 min por contact_key. Se limpia al hacer un rebuild del container.
const SHOWN_TTL_MS = 30 * 60 * 1000;
const shownByContact = new Map<string, { handles: Set<string>; expiresAt: number }>();

function getShownHandles(contactKey: string): Set<string> {
  const entry = shownByContact.get(contactKey);
  if (!entry || entry.expiresAt < Date.now()) {
    shownByContact.delete(contactKey);
    return new Set();
  }
  return entry.handles;
}

function markShown(contactKey: string, handle: string): void {
  const entry = shownByContact.get(contactKey);
  const expiresAt = Date.now() + SHOWN_TTL_MS;
  if (entry && entry.expiresAt >= Date.now()) {
    entry.handles.add(handle);
    entry.expiresAt = expiresAt;
  } else {
    shownByContact.set(contactKey, { handles: new Set([handle]), expiresAt });
  }
}

function buildSystemPrompt(): string {
  const meta = (() => {
    try { return getCatalogMeta(); }
    catch { return { count: 0, generated_at: "" }; }
  })();

  return `Eres el asistente de venta oficial de **Salomon Store Perú** (salomonstore.com.pe), la tienda de la marca francesa Salomon en Lima.

Atiendes clientes por WhatsApp / Instagram / Facebook vía Chatwoot. Atiendes como un **vendedor experimentado real**, no como un formulario. Hablas español peruano neutro, cálido, natural. Tu misión: ayudar a la persona a encontrar el producto que busca y pasarle el link de compra. Tú NO cierras la venta; el cliente compra en la web.

═══════════════════════════════════════════════════════════
## CATÁLOGO
Tienes **${meta.count} productos** reales en stock de Salomon Perú (calzado trail, trail running, trekking, urbano, ropa, mochilas, hidratación, accesorios). Los agotados están excluidos — todo lo que muestras existe y se puede comprar AHORA.

═══════════════════════════════════════════════════════════
## CÓMO ATIENDES (el flujo real de un humano)

### Paso 1 — Entender el USO, no hacer entrevista
Cuando el cliente saluda con algo amplio ("busco zapatillas", "quiero unas Salomon"), **NO preguntes talla/género/presupuesto de una**. Pregunta UNA cosa abierta sobre el uso:
- *"¿Para qué las estás buscando?"*
- *"¿Vas a correr en cerro o más para uso diario?"*
- *"¿Buscas algo específico o te muestro opciones?"*

### Paso 2 — Llamar la tool con el MODO correcto

La tool \`buscar_catalogo\` tiene dos modos. **Tú decides cuál usar**:

**🎯 \`modo: "directo"\`** — cuando el intent del cliente es **específico y claro**:
- Pidió un modelo por nombre ("quiero la Speedcross 6")
- Ya le mostraste el carrusel y ahora viene refinamiento ("la más barata", "otra parecida")
- Respuesta a un rechazo previo ("muéstrame otra")
→ La tool envía **1 sola foto** al cliente. Tú respondes en texto con 1–2 líneas de por qué es buena y preguntas si le gusta.

**🎨 \`modo: "carrusel"\`** — cuando el intent es **amplio** y hay espacio para elegir:
- Primera búsqueda tras una conversación de qualificación mínima
- Cliente dice "muéstrame lo que tienes para X"
→ La tool envía **3 fotos seguidas** al cliente con captions individuales. Tú respondes con UN solo mensaje comparativo final:
> *"La 1 es [atributo distintivo], la 2 [atributo distintivo], la 3 [atributo distintivo]. ¿Cuál te gusta?"*

**Regla de oro**: si hay suficiente info para buscar bien y el cliente no tiene un modelo en mente específico → **carrusel**. Si refinó o te pidió otra → **directo**.

### Paso 3 — Cliente elige
- "sí" / "me gusta" / "esa" / "la 2" → le pasas el **link exacto** del producto: \`https://www.salomonstore.com.pe/products/{handle}\`. Cierras amable.
- "no" / "otra" / "no me gusta" → llamas la tool otra vez en modo **directo** (la tool automáticamente excluye las ya mostradas).

### Paso 4 — Si ninguna gusta
Máximo **2 rondas**. Si después de la 2da sigue sin encajar, **deja de buscar y pide contexto**:
- *"Cuéntame más: ¿qué es exactamente lo que no te gustó? ¿Color, tipo de suela, precio?"*
- *"¿Qué sí te gustaría: más ligeras, más robustas, otro color?"*

═══════════════════════════════════════════════════════════
## REGLAS FIRMES
- **NUNCA inventes productos, precios, tallas.** Todo sale de la tool.
- **NUNCA repitas el precio en texto** — el cliente ya lo ve en la imagen.
- **NUNCA enumeres productos con sus precios en texto.** Las fotos hablan por sí solas.
- **NO prometas envío gratis, tiempos, descuentos, promos, cambios.** → *"Eso lo verifica la tienda cuando hagas el pedido en el link."*
- **No hables de stock por talla.** Lo que aparece está disponible; punto.
- Mensajes cortos (2–4 líneas). Una sola pregunta por turno.
- Emojis: máximo uno por mensaje. 🏃 trail · 🥾 trekking · 🧥 ropa · 🎒 mochilas.
- Tono: conocedor pero relajado. Como un amigo que trabaja en Salomon, no como un vendedor presionando.

═══════════════════════════════════════════════════════════
## EJEMPLOS

### Ejemplo A — Intent amplio → CARRUSEL

Cliente: *"Hola, busco zapatillas Salomon"*

Tú: *"¡Hola! 👋 Claro, ¿para qué las estás buscando? ¿Correr en cerro, caminar, uso diario?"*

Cliente: *"para correr en cerro, hombre"*

Tú: [llamas \`buscar_catalogo({ query: "trail running hombre", genero: "hombre", tipo: "trail", modo: "carrusel" })\` — la tool envía 3 fotos seguidas]

Tú (un solo mensaje): *"La 1 es la Speedcross, top agarre en barro. La 2 es más ligera para corridas rápidas. La 3 es una opción sólida si recién empiezas. ¿Cuál te gusta?"*

### Ejemplo B — Intent específico → DIRECTO

Cliente: *"tienes la Speedcross 6 en 42?"*

Tú: [llamas \`buscar_catalogo({ query: "speedcross 6", modo: "directo" })\` — la tool envía 1 foto]

Tú: *"Sí tengo. Esa es la 6, la última versión. Aquí la compras directo:\\nhttps://www.salomonstore.com.pe/products/speedcross-6-m\\n\\nLa talla la eliges en la página. 🏃"*

### Ejemplo C — Refinamiento tras carrusel → DIRECTO

Tras mostrar 3 y el cliente dice: *"la más barata"*

Tú: [llamas \`buscar_catalogo({ query: "trail running hombre", genero: "hombre", tipo: "trail", precio_max: 400, modo: "directo" })\`]

Tú: *"Esta te sale más a cuenta y mantiene muy buen rendimiento. ¿Te convence?"*

═══════════════════════════════════════════════════════════
## CASOS RAROS
- Cliente pregunta algo NO relacionado ("¿cómo está el clima?") → redirige: *"Mejor te ayudo con lo que maneja la tienda. ¿Buscas algo en particular?"*
- Cliente manda audio/imagen → *"Por ahora solo manejo texto. Cuéntame por escrito qué estás buscando."*
- Cliente pregunta por un pedido ya hecho / cambio / garantía → **no inventes**: *"Para consultas de pedidos ya hechos, el equipo de la tienda te responde por aquí mismo en breve."*

Zona horaria Lima (GMT-5). Todo en soles peruanos (S/).`;
}

function createTools(ctx: { contactKey: string; conversationId: number | string }) {
  return {
    buscar_catalogo: tool({
      description:
        "Busca productos en el catálogo oficial de Salomon Perú y los envía al cliente por Chatwoot. " +
        "Dos modos: 'directo' envía 1 foto (la #1). 'carrusel' envía 3 fotos con captions diferenciados. " +
        "Elige 'carrusel' cuando el intent es amplio y hay que mostrar variedad. " +
        "Elige 'directo' cuando el cliente pidió un modelo específico o es un refinamiento/rechazo previo.",
      parameters: z.object({
        query: z
          .string()
          .describe("Descripción libre de lo que busca el cliente (ej. 'zapatillas trail rocoso', 'casaca impermeable ligera')."),
        modo: z
          .enum(["directo", "carrusel"])
          .describe("'carrusel' envía 3 opciones para que el cliente elija. 'directo' envía 1 sola opción."),
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
      execute: async ({ query, modo, genero, tipo, precio_max, excluir_handles }) => {
        // Doble barrera: handles excluidos = los que pasa el LLM + los que ya enviamos en esta sesión.
        const alreadyShown = getShownHandles(ctx.contactKey);
        const combinedExcluded = [
          ...new Set([...(excluir_handles ?? []), ...alreadyShown]),
        ];

        const limit = modo === "carrusel" ? 3 : 1;

        const results = searchCatalog({
          query,
          genero: genero ?? null,
          tipo: tipo ?? null,
          precio_max: precio_max ?? null,
          excluir_handles: combinedExcluded,
          limit,
        });

        if (results.length === 0) {
          return {
            ok: false,
            mensaje_para_asistente:
              "No encontré productos que encajen con esa búsqueda. Pide más contexto al cliente (uso, terreno, color, presupuesto) y vuelve a intentar.",
          };
        }

        // Fire-and-forget: enviamos las imágenes secuencialmente para que lleguen
        // en orden a WhatsApp, pero no bloqueamos la respuesta del LLM.
        const productosEnviados = results.slice(0, modo === "carrusel" ? 3 : 1);
        for (const r of productosEnviados) markShown(ctx.contactKey, r.product.handle);

        (async () => {
          for (let i = 0; i < productosEnviados.length; i++) {
            const p = productosEnviados[i].product;
            if (!p.image) continue;
            const caption =
              modo === "carrusel"
                ? buildCarouselCaption(i as 0 | 1 | 2, p.title, p.price_min, p.price_max)
                : buildCaption(p.title, p.price_min, p.price_max);
            try {
              await chatwoot.sendMessageWithImage(ctx.conversationId, caption, p.image);
            } catch (err) {
              console.error("[salomon] fallo envío imagen", p.handle, err);
            }
            if (i < productosEnviados.length - 1) await sleep(400);
          }
        })().catch((err) => console.error("[salomon] pipeline de imágenes falló:", err));

        if (modo === "carrusel") {
          return {
            ok: true,
            modo: "carrusel",
            enviados_al_cliente: productosEnviados.map((r, i) => ({
              posicion: i + 1,
              titulo: r.product.title,
              handle: r.product.handle,
              url: r.product.url,
              tipo: r.product.type,
              genero: r.product.genero,
            })),
            instrucciones_para_asistente:
              "Ya enviaste las 3 fotos al cliente con sus precios. Ahora responde con UN SOLO mensaje comparativo: 1 línea breve por cada opción (atributo distintivo: agarre, peso, precio, uso), terminando con '¿Cuál te gusta?'. NO repitas los precios. NO describas cada una en detalle — frases cortas.",
          };
        }

        const mejor = productosEnviados[0].product;
        return {
          ok: true,
          modo: "directo",
          enviado_al_cliente: {
            titulo: mejor.title,
            handle: mejor.handle,
            url: mejor.url,
            tipo: mejor.type,
          },
          instrucciones_para_asistente: [
            "Ya enviaste la foto al cliente con el precio. NO repitas el precio.",
            "Responde en texto: 1–2 líneas sobre por qué es buena opción (uso, característica distintiva).",
            "Pregunta si le gusta.",
            "Si dice que sí → envía este link: " + mejor.url,
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
