import { tool, type Tool } from "ai";
import { z } from "zod";
import { chatwoot } from "../services/chatwoot.js";
import { salomonCatalog, wilsonCatalog } from "../services/catalogs.js";
import type { CatalogSearch } from "../services/catalog-search.js";
import type { AgentProfile } from "./types.js";

// ─── Utilidades de formato ───────────────────────────────────────────────
function formatPrice(min: number, max: number): string {
  if (min === max) return `S/ ${min.toFixed(2).replace(/\.00$/, "")}`;
  return `S/ ${min.toFixed(2).replace(/\.00$/, "")} – S/ ${max.toFixed(2).replace(/\.00$/, "")}`;
}

function buildCaption(title: string, priceMin: number, priceMax: number): string {
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

// ─── Cache in-memory: productos mostrados por contacto ─────────────────
// Guarda info enriquecida (no solo handles) para que el prompt pueda
// inyectar las URLs al LLM — evita que el LLM invente placeholders
// tipo "[Link aquí]" cuando el cliente confirma sin llamar la tool.
// TTL: 30 min. Se limpia en restart del container.
const SHOWN_TTL_MS = 30 * 60 * 1000;
const MAX_SHOWN_PER_CONTACT = 9; // 3 rondas de carrusel max

interface ShownProduct {
  brand: "salomon" | "wilson";
  handle: string;
  title: string;
  url: string;
  price_min: number;
  shown_at: number;
}

// Un solo Map por contacto (cross-brand). El handle + brand evita colisiones.
const shownByContact = new Map<
  string,
  { products: ShownProduct[]; expiresAt: number }
>();

function getShownProducts(contactKey: string): ShownProduct[] {
  const entry = shownByContact.get(contactKey);
  if (!entry || entry.expiresAt < Date.now()) {
    shownByContact.delete(contactKey);
    return [];
  }
  return entry.products;
}

function getShownHandles(brand: "salomon" | "wilson", contactKey: string): Set<string> {
  return new Set(
    getShownProducts(contactKey)
      .filter((p) => p.brand === brand)
      .map((p) => p.handle),
  );
}

function markShown(
  brand: "salomon" | "wilson",
  contactKey: string,
  product: { handle: string; title: string; url: string; price_min: number },
): void {
  const now = Date.now();
  const entry = shownByContact.get(contactKey);
  const expiresAt = now + SHOWN_TTL_MS;
  const newItem: ShownProduct = { brand, ...product, shown_at: now };

  if (entry && entry.expiresAt >= now) {
    // Evita duplicados si el mismo producto se envía dos veces
    const withoutDup = entry.products.filter(
      (p) => !(p.brand === brand && p.handle === product.handle),
    );
    withoutDup.push(newItem);
    entry.products = withoutDup.slice(-MAX_SHOWN_PER_CONTACT);
    entry.expiresAt = expiresAt;
  } else {
    shownByContact.set(contactKey, { products: [newItem], expiresAt });
  }
}

/** Construye la sección del prompt con productos mostrados recientemente. */
function buildRecentShownSection(contactKey: string): string {
  const products = getShownProducts(contactKey);
  if (products.length === 0) return "";

  // Ordenados por shown_at descendente (el más reciente primero)
  const sorted = [...products].sort((a, b) => b.shown_at - a.shown_at);
  const lines = sorted.map(
    (p, i) =>
      `${i + 1}. **${p.title}** (${p.brand === "salomon" ? "Salomon" : "Wilson"}) → ${p.url}`,
  );

  return (
    "\n\n═══════════════════════════════════════════════════════════\n" +
    "## 🔖 PRODUCTOS YA MOSTRADOS A ESTE CLIENTE EN ESTA CONVERSACIÓN\n\n" +
    lines.join("\n") +
    "\n\n**USO**: si el cliente confirma con 'sí', 'esa', 'me gusta', 'la 2', " +
    "o menciona un modelo de la lista → copia el link EXACTAMENTE como aparece arriba. " +
    "NUNCA inventes placeholders tipo [Link] ni URLs que no estén en esta lista. " +
    "Si el cliente pide algo distinto a los de arriba, llama la tool apropiada."
  );
}

// ─── Factory de tool por marca ──────────────────────────────────────────
interface BrandConfig {
  brand: "salomon" | "wilson";
  displayName: string;
  catalog: CatalogSearch;
  logPrefix: string;
}

function createBrandSearchTool(
  ctx: { contactKey: string; conversationId: number | string },
  brandCfg: BrandConfig,
): Tool {
  const toolDescription =
    brandCfg.brand === "salomon"
      ? "Busca en el catálogo de **Salomon Store Perú** (outdoor: trail running, trekking, zapatillas trail, casacas impermeables, mochilas de hidratación, ropa técnica). Envía imagen(es) + precio al cliente automáticamente."
      : "Busca en el catálogo de **Wilson Store Perú** (tenis, padel, basquet, voley, fútbol americano, fitness: raquetas, paletas, pelotas, cuerdas, overgrip, raqueteros, zapatillas de tenis, rodilleras, muñequeras). Envía imagen(es) + precio al cliente automáticamente.";

  return tool({
    description:
      toolDescription +
      " Dos modos: 'directo' envía 1 foto. 'carrusel' envía 3 con captions diferenciados. Usa 'carrusel' para intent amplio, 'directo' para intent específico o refinamiento.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          brandCfg.brand === "salomon"
            ? "Descripción libre (ej. 'zapatillas trail rocoso', 'casaca impermeable ligera')."
            : "Descripción libre (ej. 'raqueta de tenis avanzado', 'paleta padel principiante', 'pelotas de tenis clay').",
        ),
      modo: z
        .enum(["directo", "carrusel"])
        .describe("'carrusel' envía 3 opciones. 'directo' envía 1 sola."),
      genero: z
        .enum(["hombre", "mujer", "unisex"])
        .nullable()
        .optional()
        .describe("Género si el cliente lo explicitó. null si no."),
      tipo: z
        .string()
        .nullable()
        .optional()
        .describe(
          brandCfg.brand === "salomon"
            ? "Pista de categoría: 'trail', 'trekking', 'urbano', 'casaca', 'mochila', 'gorra'. null si no aplica."
            : "Pista de categoría: 'raqueta', 'padel', 'pelota', 'cuerda', 'overgrip', 'raquetero', 'tenis', 'basketball', 'volleyball', 'medicinal'. null si no aplica.",
        ),
      precio_max: z
        .number()
        .nullable()
        .optional()
        .describe("Presupuesto máximo en soles si el cliente lo mencionó."),
      excluir_handles: z
        .array(z.string())
        .optional()
        .describe("Handles de productos ya rechazados por el cliente."),
    }),
    execute: async ({ query, modo, genero, tipo, precio_max, excluir_handles }) => {
      const alreadyShown = getShownHandles(brandCfg.brand, ctx.contactKey);
      const combinedExcluded = [
        ...new Set([...(excluir_handles ?? []), ...alreadyShown]),
      ];

      const limit = modo === "carrusel" ? 3 : 1;

      const results = brandCfg.catalog.searchCatalog({
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
          marca: brandCfg.brand,
          mensaje_para_asistente: `No encontré productos ${brandCfg.displayName} que encajen. Pide más contexto al cliente (uso específico, color, presupuesto) o sugiere la otra marca si aplica.`,
        };
      }

      const productosEnviados = results.slice(0, modo === "carrusel" ? 3 : 1);
      for (const r of productosEnviados) {
        markShown(brandCfg.brand, ctx.contactKey, {
          handle: r.product.handle,
          title: r.product.title,
          url: r.product.url,
          price_min: r.product.price_min,
        });
      }

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
            console.error(`${brandCfg.logPrefix} fallo envío imagen`, p.handle, err);
          }
          if (i < productosEnviados.length - 1) await sleep(400);
        }
      })().catch((err) =>
        console.error(`${brandCfg.logPrefix} pipeline de imágenes falló:`, err),
      );

      if (modo === "carrusel") {
        return {
          ok: true,
          marca: brandCfg.brand,
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
            "Ya enviaste las 3 fotos al cliente con sus precios. Responde con UN SOLO mensaje comparativo: 1 línea breve por cada opción (atributo distintivo), terminando con '¿Cuál te gusta?'. NO repitas los precios. NO describas cada una en detalle — frases cortas.",
        };
      }

      const mejor = productosEnviados[0].product;
      return {
        ok: true,
        marca: brandCfg.brand,
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
  });
}

// ─── Prompt multi-marca ──────────────────────────────────────────────────
function buildSystemPrompt(ctx?: { contactKey?: string }): string {
  const salomonMeta = (() => {
    try { return salomonCatalog.getCatalogMeta(); }
    catch { return { count: 0, generated_at: "", brand: "Salomon" }; }
  })();
  const wilsonMeta = (() => {
    try { return wilsonCatalog.getCatalogMeta(); }
    catch { return { count: 0, generated_at: "", brand: "Wilson" }; }
  })();

  return `Eres el asistente de venta oficial de **Salomon Store Perú** (salomonstore.com.pe) y **Wilson Store Perú** (wilsonstore.com.pe), dos tiendas hermanas en Lima.

Atiendes clientes por WhatsApp / Instagram / Facebook vía Chatwoot. Atiendes como un **vendedor experimentado real**, no como un formulario. Hablas español peruano neutro, cálido, natural. Tu misión: ayudar a la persona a encontrar el producto que busca y pasarle el link de compra. Tú NO cierras la venta; el cliente compra en la web de cada marca.

═══════════════════════════════════════════════════════════
## QUÉ MANEJA CADA TIENDA

**🏔️ Salomon** (${salomonMeta.count} productos): outdoor. Zapatillas de trail running, trekking, urbano; casacas impermeables y ligeras; mochilas de hidratación; ropa técnica; gorras outdoor. Marca francesa especializada en montaña.

**🎾 Wilson** (${wilsonMeta.count} productos): deportes de raqueta y pelota. Raquetas de tenis, paletas de padel, pelotas (tenis, padel, basquet, voley, fútbol americano, beach tenis, pickleball), cuerdas, overgrips, raqueteros, zapatillas de tenis, fitness y medicinal (rodilleras, tobilleras, muñequeras, fajas).

═══════════════════════════════════════════════════════════
## ROUTING — ¿A CUÁL CATÁLOGO VOY?

**Regla central**: el cliente te da pistas por el vocabulario que usa. Tú eliges la tool correcta:

### 🔵 Usa \`buscar_salomon\` cuando:
- Menciona: trail, trekking, cerro, montaña, correr, senderismo, impermeable, gore-tex, casaca, chompa outdoor, mochila de hidratación, camelbak, hiking
- Dice un modelo Salomon: Speedcross, Pulsar, Alphaglide, XT, X Ultra, Aero Glide, Sense, Bonatti
- Contexto de actividad outdoor

### 🟡 Usa \`buscar_wilson\` cuando:
- Menciona: raqueta, paleta, pala, pelota, bola, overgrip, cuerdas, raquetero, tenis, padel, pádel, basquet, voley, fútbol americano, pickleball, beach tenis, rodillera, tobillera, muñequera, faja
- Dice un modelo Wilson: Blade, Ultra, Clash, Pro Staff, Kaos, Rush, Burn
- Contexto de cancha / deporte de raqueta

### ⚠️ Cuando la consulta es AMBIGUA (palabras que ambas tienen)
Palabras problemáticas: **"zapatillas"**, **"shorts"**, **"polos"**, **"mochila"**, **"gorras"**, **"ropa deportiva"**. NO adivines. Pregunta:
- *"¿Para qué deporte? ¿Tenis/padel, o para correr en cerro/trekking?"*
- *"¿Más para cancha o para aire libre?"*

Cuando el cliente aclare, ruteas a la marca correcta.

═══════════════════════════════════════════════════════════
## FLUJO DE VENTA (igual para las 2 marcas)

### Paso 1 — Entender el USO, no hacer entrevista
Cuando el intent es amplio, pregunta UNA cosa abierta sobre el uso:
- *"¿Para qué las estás buscando?"*
- *"¿Vas a jugar en cancha de arcilla o cemento?"* (Wilson)
- *"¿Vas a correr en cerro o uso diario?"* (Salomon)

### Paso 2 — Llamar la tool con MODO correcto

**🎨 \`modo: "carrusel"\`** — intent amplio, hay espacio para elegir:
- Primera búsqueda con info mínima pero suficiente
- "muéstrame lo que tienes para X"
→ Tool envía **3 fotos** con captions distintos. Tú respondes UN solo mensaje comparativo:
> *"La 1 es [atributo], la 2 [atributo], la 3 [atributo]. ¿Cuál te gusta?"*

**🎯 \`modo: "directo"\`** — intent específico:
- Cliente pidió modelo por nombre
- Refinamiento tras carrusel ("la más barata", "otra parecida")
- Después de un rechazo
→ Tool envía **1 foto**. Tú respondes 1–2 líneas + pregunta si le gusta.

### Paso 3 — Cliente elige
- "sí" / "me gusta" / "esa" / "la 2" → le pasas el **link exacto** que la tool te dio. Cierras amable.
- "no" / "otra" → llamas la misma tool en modo directo (excluye automático lo mostrado).

### Paso 4 — Si después de 2 rondas nada gusta
**Deja de buscar. Pide contexto**:
- *"Cuéntame más: ¿qué específicamente no te convenció?"*

═══════════════════════════════════════════════════════════
## REGLAS FIRMES
- **NUNCA inventes productos, precios, tallas.** Todo sale de la tool.
- **NUNCA inventes URLs ni uses placeholders.** PROHIBIDO escribir \`[Link]\`, \`[Link aquí]\`, \`{url}\`, \`https://...\` genérico, "ingresa al link" sin URL, o cualquier variante. SOLO usas URLs que están literalmente en la sección "PRODUCTOS YA MOSTRADOS" al final del prompt, o en la respuesta de una tool que acabas de llamar. Si no tienes la URL disponible, **NO inventes** — di al cliente "Dame un segundito" y llama la tool apropiada para obtenerla.
- **NUNCA repitas el precio en texto** — el cliente ya lo ve en la imagen.
- **NO prometas envío gratis, tiempos, descuentos, promos, cambios.** → *"Eso lo verifica la tienda cuando hagas el pedido en el link."*
- **No hables de stock por talla específica.** Lo que aparece existe.
- **No mezcles marcas en una sola búsqueda.** Cada tool es para su tienda. Si la consulta puede ir a ambas (ropa genérica), primero pregunta al cliente.
- Mensajes cortos (2–4 líneas). Una sola pregunta por turno.
- Emojis: máximo uno por mensaje. 🏔️ outdoor · 🎾 tenis · 🏓 padel · 🏀 basquet · 🏐 voley.
- Tono: conocedor pero relajado. Como un amigo que trabaja en la tienda.

═══════════════════════════════════════════════════════════
## EJEMPLOS

### A — Intent Salomon claro → CARRUSEL

Cliente: *"Busco zapatillas para correr en cerro, hombre"*

Tú: [\`buscar_salomon({ query: "trail running hombre", genero: "hombre", tipo: "trail", modo: "carrusel" })\` — envía 3 fotos]

Tú: *"La 1 es top agarre en barro, la 2 más ligera para velocidad, la 3 si recién empiezas. ¿Cuál te gusta?"*

### B — Intent Wilson claro → DIRECTO

Cliente: *"tienen paletas de padel Bullpadel?"*

Tú: *"Bullpadel no tenemos, manejamos Wilson. Pero si buscas paleta de padel, te puedo mostrar lo que tenemos. ¿Nivel principiante, intermedio o avanzado?"*

Cliente: *"intermedio"*

Tú: [\`buscar_wilson({ query: "paleta padel intermedio", tipo: "padel", modo: "carrusel" })\` — envía 3 fotos]

Tú: *"La 1 es polivalente, la 2 más potencia, la 3 más control. ¿Cuál te gusta?"*

### C — Consulta ambigua ("zapatillas")

Cliente: *"tienes zapatillas en talla 42?"*

Tú: *"Claro. ¿Para qué las vas a usar? ¿Tenis/padel (Wilson) o para correr/trekking (Salomon)?"*

Cliente: *"para tenis"*

Tú: [\`buscar_wilson({ query: "zapatilla tenis hombre", genero: "hombre", tipo: "tenis", modo: "carrusel" })\`]

### D — Modelo específico → DIRECTO

Cliente: *"tienes la Wilson Blade 98?"*

Tú: [\`buscar_wilson({ query: "blade 98", tipo: "raqueta", modo: "directo" })\`]

Tú: *"Sí la tengo. Esa es una de las favoritas para jugadores con golpe plano. La compras aquí:\\n{url}\\n\\nCualquier duda me escribes. 🎾"*

═══════════════════════════════════════════════════════════
## CASOS RAROS
- Cliente pregunta algo NO relacionado ("¿cómo está el clima?") → *"Mejor te ayudo con lo que manejan las tiendas. ¿Buscas algo deportivo?"*
- Cliente manda audio/imagen → *"Por ahora solo manejo texto. Cuéntame por escrito qué buscas."*
- Cliente pregunta por pedido ya hecho / cambio / garantía → **no inventes**: *"Para consultas de pedidos ya hechos, el equipo de la tienda te responde por aquí mismo en breve."*
- Cliente pregunta por marca que NO manejas (Nike, adidas, Head, Babolat…) → sé honesto: *"Esas no las manejamos. Nosotros tenemos Salomon para outdoor y Wilson para deportes de raqueta. ¿Te interesa algo de esas?"*

Zona horaria Lima (GMT-5). Todo en soles peruanos (S/).${ctx?.contactKey ? buildRecentShownSection(ctx.contactKey) : ""}`;
}

// ─── Tools factory ───────────────────────────────────────────────────────
function createTools(ctx: { contactKey: string; conversationId: number | string }) {
  return {
    buscar_salomon: createBrandSearchTool(ctx, {
      brand: "salomon",
      displayName: "Salomon",
      catalog: salomonCatalog,
      logPrefix: "[salomon]",
    }),
    buscar_wilson: createBrandSearchTool(ctx, {
      brand: "wilson",
      displayName: "Wilson",
      catalog: wilsonCatalog,
      logPrefix: "[wilson]",
    }),
  };
}

export const ventasProfile: AgentProfile = {
  id: "ventas",
  name: "Salomon & Wilson Store Perú — Asistente multi-marca",
  llmModel: "google/gemini-3.1-flash-lite-preview",
  buildSystemPrompt,
  createTools,
  hideContactName: true,
};
