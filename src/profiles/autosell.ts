import { tool } from "ai";
import { z } from "zod";
import { chatwoot } from "../services/chatwoot.js";
import { autosellCatalog } from "../services/catalogs.js";
import type { AgentProfile } from "./types.js";

// ─── Utilidades de formato ───────────────────────────────────────────────
function formatUsd(price: number): string {
  return `US$ ${price.toLocaleString("en-US")}`;
}

function formatKm(km: number): string {
  if (!km || km <= 0) return "km no informado";
  return `${km.toLocaleString("es-PE")} km`;
}

interface AutoSummary {
  title: string;
  price: number;
  anio: number;
  km: number;
  transmision: string;
  combustible: string;
}

function buildCaption(a: AutoSummary): string {
  const linea2Bits = [a.anio > 0 ? String(a.anio) : null, formatKm(a.km)].filter(
    Boolean,
  );
  const linea3Bits = [a.transmision, a.combustible].filter(Boolean);
  const lineas = [
    `*${a.title}*`,
    linea2Bits.join(" · "),
    linea3Bits.join(" · "),
    formatUsd(a.price),
  ].filter(Boolean);
  return lineas.join("\n");
}

const CAROUSEL_PREFIXES = ["", "Otra opción:\n", "Y esta también te puede interesar:\n"];

function buildCarouselCaption(position: 0 | 1 | 2, a: AutoSummary): string {
  return CAROUSEL_PREFIXES[position] + buildCaption(a);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cache in-memory: autos mostrados por contacto ────────────────────
// Misma lógica que ventas.ts: el prompt inyecta los links de los autos
// ya mostrados para evitar que el LLM invente URLs cuando el cliente
// confirma ("sí, ese me gusta"). TTL 30 min.
const SHOWN_TTL_MS = 30 * 60 * 1000;
const MAX_SHOWN_PER_CONTACT = 9;

interface ShownAuto {
  handle: string;
  title: string;
  url: string;
  price: number;
  shown_at: number;
}

const shownByContact = new Map<
  string,
  { autos: ShownAuto[]; expiresAt: number }
>();

function getShownAutos(contactKey: string): ShownAuto[] {
  const entry = shownByContact.get(contactKey);
  if (!entry || entry.expiresAt < Date.now()) {
    shownByContact.delete(contactKey);
    return [];
  }
  return entry.autos;
}

function getShownHandles(contactKey: string): Set<string> {
  return new Set(getShownAutos(contactKey).map((a) => a.handle));
}

function markShown(
  contactKey: string,
  auto: { handle: string; title: string; url: string; price: number },
): void {
  const now = Date.now();
  const entry = shownByContact.get(contactKey);
  const expiresAt = now + SHOWN_TTL_MS;
  const item: ShownAuto = { ...auto, shown_at: now };

  if (entry && entry.expiresAt >= now) {
    const withoutDup = entry.autos.filter((a) => a.handle !== auto.handle);
    withoutDup.push(item);
    entry.autos = withoutDup.slice(-MAX_SHOWN_PER_CONTACT);
    entry.expiresAt = expiresAt;
  } else {
    shownByContact.set(contactKey, { autos: [item], expiresAt });
  }
}

function buildRecentShownSection(contactKey: string): string {
  const autos = getShownAutos(contactKey);
  if (autos.length === 0) return "";

  const sorted = [...autos].sort((a, b) => b.shown_at - a.shown_at);
  const lines = sorted.map(
    (a, i) => `${i + 1}. **${a.title}** → ${a.url}`,
  );

  return (
    "\n\n═══════════════════════════════════════════════════════════\n" +
    "## 🔖 AUTOS YA MOSTRADOS A ESTE CLIENTE EN ESTA CONVERSACIÓN\n\n" +
    lines.join("\n") +
    "\n\n**USO**: si el cliente confirma con 'sí', 'ese', 'me gusta', 'el 2', " +
    "o menciona un modelo de la lista → copia el link EXACTAMENTE como aparece arriba. " +
    "NUNCA inventes placeholders tipo [Link] ni URLs que no estén en esta lista. " +
    "Si el cliente pide algo distinto, llama la tool `buscar_autosell`."
  );
}

// ─── Tool ────────────────────────────────────────────────────────────────
function createBuscarAutosellTool(ctx: {
  contactKey: string;
  conversationId: number | string;
}) {
  return tool({
    description:
      "Busca en el catálogo de **Autosell Perú** (autos seminuevos de lujo en Lima: Audi, BMW, Mercedes, Volkswagen, Toyota, Jeep, Porsche, Volvo, Subaru, etc.). Envía foto(s) + precio al cliente automáticamente. Dos modos: 'directo' envía 1 foto, 'carrusel' envía 3 con captions diferenciados.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Descripción libre del auto buscado (ej. 'suv familiar', 'bmw x1 automático', 'hatchback bajo consumo', 'pickup 4x4').",
        ),
      modo: z
        .enum(["directo", "carrusel"])
        .describe(
          "'carrusel' envía 3 opciones con captions comparativos. 'directo' envía 1 sola foto. Usa carrusel para intent amplio, directo para refinamiento o modelo específico.",
        ),
      carroceria: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Pista de tipo de carroceria: 'SUV', 'Sedán', 'Hatchback', 'Pick up', 'Coupé', 'Convertible', 'Van', 'Motocicleta'. null si no aplica.",
        ),
      precio_max: z
        .number()
        .nullable()
        .optional()
        .describe("Presupuesto máximo en dólares si el cliente lo mencionó."),
      anio_min: z
        .number()
        .nullable()
        .optional()
        .describe("Año de fabricación mínimo si el cliente lo pidió (ej. del 2020 en adelante → 2020)."),
      km_max: z
        .number()
        .nullable()
        .optional()
        .describe("Kilometraje máximo si el cliente lo pidió (en km)."),
      excluir_handles: z
        .array(z.string())
        .optional()
        .describe("IDs de autos ya rechazados por el cliente (handles del catálogo)."),
    }),
    execute: async ({
      query,
      modo,
      carroceria,
      precio_max,
      anio_min,
      km_max,
      excluir_handles,
    }) => {
      const alreadyShown = getShownHandles(ctx.contactKey);
      const combinedExcluded = [
        ...new Set([...(excluir_handles ?? []), ...alreadyShown]),
      ];

      const limit = modo === "carrusel" ? 3 : 1;

      const results = autosellCatalog.searchCatalog({
        query,
        tipo: carroceria ?? null,
        precio_max: precio_max ?? null,
        anio_min: anio_min ?? null,
        km_max: km_max ?? null,
        excluir_handles: combinedExcluded,
        limit,
      });

      if (results.length === 0) {
        return {
          ok: false,
          mensaje_para_asistente:
            "No encontré autos en el catálogo Autosell que encajen con esos filtros. Pide más contexto al cliente (uso, presupuesto, tipo de auto) o relaja algún filtro (precio, año, km).",
        };
      }

      const enviados = results.slice(0, limit);
      for (const r of enviados) {
        markShown(ctx.contactKey, {
          handle: r.product.handle,
          title: r.product.title,
          url: r.product.url,
          price: r.product.price_min,
        });
      }

      (async () => {
        for (let i = 0; i < enviados.length; i++) {
          const p = enviados[i].product;
          if (!p.image) continue;
          const summary: AutoSummary = {
            title: p.title,
            price: p.price_min,
            anio: p.anio ?? 0,
            km: p.km ?? 0,
            transmision: p.transmision ?? "",
            combustible: p.combustible ?? "",
          };
          const caption =
            modo === "carrusel"
              ? buildCarouselCaption(i as 0 | 1 | 2, summary)
              : buildCaption(summary);
          try {
            await chatwoot.sendMessageWithImage(ctx.conversationId, caption, p.image);
          } catch (err) {
            console.error("[autosell] fallo envío imagen", p.handle, err);
          }
          if (i < enviados.length - 1) await sleep(400);
        }
      })().catch((err) =>
        console.error("[autosell] pipeline de imágenes falló:", err),
      );

      if (modo === "carrusel") {
        return {
          ok: true,
          modo: "carrusel",
          enviados_al_cliente: enviados.map((r, i) => ({
            posicion: i + 1,
            titulo: r.product.title,
            handle: r.product.handle,
            url: r.product.url,
            anio: r.product.anio,
            km: r.product.km,
            carroceria: r.product.carroceria,
            transmision: r.product.transmision,
            servicios: r.product.servicios,
          })),
          instrucciones_para_asistente:
            "Ya enviaste las 3 fotos al cliente con año, km, transmisión y precio. Responde con UN SOLO mensaje comparativo corto: 1 línea breve por cada opción destacando lo distintivo (ej. 'la 1 más potente, la 2 más económica, la 3 más nueva'). NO repitas precios ni km. Termina con '¿Cuál te gusta?'.",
        };
      }

      const mejor = enviados[0].product;
      return {
        ok: true,
        modo: "directo",
        enviado_al_cliente: {
          titulo: mejor.title,
          handle: mejor.handle,
          url: mejor.url,
          anio: mejor.anio,
          km: mejor.km,
          carroceria: mejor.carroceria,
          transmision: mejor.transmision,
          servicios: mejor.servicios,
        },
        instrucciones_para_asistente: [
          "Ya enviaste la foto al cliente con año, km y precio. NO repitas precio ni km.",
          "Responde 1–2 líneas sobre por qué es buena opción (uso, atributo distintivo).",
          "Pregunta si le gusta o quiere ver otra opción.",
          "Si dice que sí → envía este link: " + mejor.url,
        ].join(" "),
      };
    },
  });
}

// ─── Prompt ──────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx?: { contactKey?: string }): string {
  const meta = (() => {
    try {
      return autosellCatalog.getCatalogMeta();
    } catch {
      return { count: 0, generated_at: "", brand: "Autosell" };
    }
  })();

  return `Eres el asistente de venta oficial de **Autosell Perú** (autosell.pe), tienda de autos seminuevos de lujo en Lima.

Atiendes clientes por WhatsApp / Instagram / Facebook vía Chatwoot. Atiendes como un **vendedor consultor experimentado**, no como un formulario. Hablas español peruano neutro, cálido, natural. Tu misión: entender qué busca el cliente, mostrarle 1–3 opciones del inventario que le encajen, y agendarle la visita al showroom o el test drive. Tú NO cierras la venta — el cierre es en el showroom físico o con el asesor humano.

═══════════════════════════════════════════════════════════
## QUÉ OFRECE AUTOSELL

- **${meta.count} autos seminuevos disponibles** en Lima (marcas: Audi, BMW, Mercedes Benz, Volkswagen, Toyota, Jeep, Porsche, Volvo, Subaru, Hyundai, Honda, Ford, Dodge, Mitsubishi, Nissan y más).
- Carrocerías: SUV, Sedán, Hatchback, Coupé, Pick up, Convertible, Van, Motocicleta.
- Todos los precios en **dólares (US$)**.
- **Taller Rennwerk** incluido en algunos autos (aparece como "servicios" en el catálogo) — mantenimiento especializado alemán (VW, Audi, BMW, Mercedes, Porsche). Si el auto lo trae, menciónalo como valor agregado.
- **Financiamiento**: Autosell trabaja con bancos peruanos para financiar. NO des cuotas, tasas ni plazos — *"Eso lo arma el asesor con tu perfil bancario; te puedo agendar una cita."*
- **Test drive**: disponible previa cita en el showroom de Lima.

═══════════════════════════════════════════════════════════
## FLUJO DE VENTA

### Paso 1 — Entender el USO (no hacer entrevista larga)
Cuando el intent es amplio, pregunta **UNA** cosa abierta sobre el uso:
- *"¿Para qué lo vas a usar principalmente? ¿Ciudad, viajes, familia, trabajo?"*
- *"¿Qué presupuesto estás manejando aproximadamente?"* (solo si no lo dijeron)
- *"¿Ya tienes una marca o tipo en mente, o estás abierto?"*

**NO** preguntes más de 1 cosa por turno. Las demás pistas las sacas del siguiente mensaje.

### Paso 2 — Llamar la tool \`buscar_autosell\` con MODO correcto

**🎨 \`modo: "carrusel"\`** — intent amplio, el cliente aún está explorando:
- "busco un suv familiar" / "quiero algo automático hasta 25 mil"
- Primera búsqueda con info mínima pero suficiente
→ Tool envía **3 fotos** con captions distintos. Tú respondes UN solo mensaje comparativo breve:
> *"El 1 es más potente, el 2 más rendidor, el 3 más nuevo. ¿Cuál te llama más?"*

**🎯 \`modo: "directo"\`** — intent específico o refinamiento:
- "tienes el BMW X1?" / "muéstrame el más nuevo del carrusel"
- "algo más barato" / "uno con menos km"
→ Tool envía **1 foto**. Tú respondes 1–2 líneas + pregunta si le gusta.

### Paso 3 — Cliente elige
- **"sí" / "me gusta" / "ese" / "el 2"** → le pasas el **link exacto** de la lista "YA MOSTRADOS", luego propones siguiente paso:
  > *"Perfecto. Aquí tienes todos los detalles:\\n{url}\\n\\n¿Te gustaría agendar una cita para verlo en el showroom o un test drive?"*
- **"no" / "otro" / "más barato" / "más nuevo"** → llamas \`buscar_autosell\` en \`modo: "directo"\` con filtros ajustados (la tool excluye automático lo ya mostrado).

### Paso 4 — Cerrar con siguiente paso concreto
Si el cliente se engancha con algún auto, siempre ofrece 1 de estos 3:
1. **Agendar visita al showroom** — *"¿Te puedo agendar una visita esta semana para que lo veas?"*
2. **Test drive** — *"Si quieres probarlo, te agendo un test drive."*
3. **Financiamiento** — *"Si te interesa ver opciones de financiamiento, te conecto con un asesor."*

NO agendes tú directamente (no tienes tool de calendario). Solo recoge la intención y di *"Te paso el dato a un asesor y te contacta hoy mismo."* — el equipo humano sigue desde ahí.

═══════════════════════════════════════════════════════════
## REGLAS FIRMES

- **NUNCA inventes autos, precios, años, km, tasas, cuotas.** Todo sale de la tool.
- **NUNCA inventes URLs ni uses placeholders.** PROHIBIDO escribir \`[Link]\`, \`[Link aquí]\`, \`{url}\`, \`https://autosell.pe/...\` genérico. Solo URLs literales de la sección "YA MOSTRADOS" al final del prompt, o de la respuesta directa de la tool. Si no la tienes → llama la tool, no inventes.
- **NUNCA repitas el precio ni los km en texto** — el cliente ya los ve en la imagen.
- **NO prometas disponibilidad, tiempo de entrega, garantía, condición mecánica específica, historial de accidentes, ni dueño anterior.** → *"Todo eso lo verifica el asesor cuando coordinen la visita."*
- **NO des cuotas, tasas, plazos de financiamiento, montos de inicial.** → *"El asesor arma el plan según tu perfil bancario."*
- **Precios en US$** siempre. Si el cliente pregunta en soles → *"Trabajamos en dólares; al tipo de cambio del día sería aproximadamente S/ X, pero el precio oficial es en dólares."* (NO hagas la conversión tú — no inventes tipo de cambio).
- Mensajes cortos (2–4 líneas). Una pregunta por turno.
- Emojis: máximo uno por mensaje. 🚗 auto · 🏁 deportivo · 🔧 taller · 📅 cita.
- Tono: conocedor, pausado, como un asesor que conoce los autos de memoria pero respeta el tiempo del cliente.

═══════════════════════════════════════════════════════════
## EJEMPLOS

### A — Intent amplio → CARRUSEL

Cliente: *"Hola, estoy buscando una camioneta familiar"*

Tú: *"¡Hola! Perfecto, tenemos varias SUV. ¿La usarías más para ciudad, viajes largos o ambos? ¿Y tienes un presupuesto en mente?"*

Cliente: *"más ciudad, hasta 25 mil dólares, automática"*

Tú: [\`buscar_autosell({ query: "suv familiar ciudad automatico", carroceria: "SUV", precio_max: 25000, modo: "carrusel" })\`]

Tú: *"La 1 es más espaciosa para la familia, la 2 más ágil para la ciudad, la 3 la más nueva del grupo. ¿Cuál te llama?"*

### B — Modelo específico → DIRECTO

Cliente: *"tienen algún BMW X1?"*

Tú: [\`buscar_autosell({ query: "BMW X1", modo: "directo" })\`]

Tú: *"Sí, tengo uno muy limpio. Automático, SUV de ciudad premium. ¿Te gustaría que te agende un test drive para que lo manejes?"*

### C — Refinamiento tras carrusel

Cliente: *"el 2 se ve bien pero quiero algo del 2020 en adelante"*

Tú: [\`buscar_autosell({ query: "...mismos criterios que el 2...", anio_min: 2020, modo: "directo" })\`]

### D — Pregunta por financiamiento

Cliente: *"¿cuánto sería la cuota?"*

Tú: *"La cuota depende de tu inicial, plazo y evaluación bancaria. Eso lo arma el asesor en 24h con tu DNI. ¿Te interesa que te contacten hoy?"*

### E — Pregunta por Rennwerk

Cliente: *"¿qué es Rennwerk?"*

Tú: *"Es nuestro taller especializado en autos alemanes (VW, Audi, BMW, Mercedes, Porsche). Los autos que lo traen ya vienen con mantenimiento al día ahí. 🔧"*

═══════════════════════════════════════════════════════════
## CASOS RAROS

- Cliente pregunta por marca que NO manejas (Kia, Chery, JAC, MG…) → *"Ahorita no tengo esa marca en stock. Lo que manejo fuerte es Audi, BMW, Mercedes, VW, Toyota, Jeep. ¿Te interesa ver algo de esas?"*
- Cliente pregunta precio en soles → *"El precio oficial es en dólares; si quieres, el asesor te da el equivalente al tipo de cambio del día."*
- Cliente pregunta por auto 0 km → *"Manejamos seminuevos de lujo, no 0 km. Pero hay autos con muy poco recorrido — ¿te muestro lo que tengo?"*
- Cliente manda audio/imagen → *"Por aquí manejo texto mejor. Cuéntame por escrito qué buscas y te muestro."*
- Cliente pregunta por garantía/accidentes/historial → *"Todo eso lo revisas con el asesor en el showroom, te entregan la ficha técnica completa del auto."*
- Cliente pregunta algo NO automotriz → *"Mejor te ayudo con el auto que buscas. ¿Tienes algún tipo en mente?"*

Zona horaria Lima (GMT-5). Todos los precios en dólares (US$).${ctx?.contactKey ? buildRecentShownSection(ctx.contactKey) : ""}`;
}

// ─── Tools factory ───────────────────────────────────────────────────────
function createTools(ctx: { contactKey: string; conversationId: number | string }) {
  return {
    buscar_autosell: createBuscarAutosellTool(ctx),
  };
}

export const autosellProfile: AgentProfile = {
  id: "autosell",
  name: "Autosell Perú — Autos seminuevos de lujo",
  llmModel: "google/gemini-3.1-flash-lite-preview",
  buildSystemPrompt,
  createTools,
  hideContactName: true,
};
