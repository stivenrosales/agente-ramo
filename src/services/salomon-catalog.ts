import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fuse from "fuse.js";

const CATALOG_PATH = resolve(process.cwd(), "data", "salomon-catalog.json");

export interface CatalogProduct {
  id: number;
  title: string;
  handle: string;
  url: string;
  type: string;
  genero: "hombre" | "mujer" | "unisex" | "desconocido";
  tags: string[];
  price_min: number;
  price_max: number;
  image: string;
  colors: string[];
  sizes_available: string[];
  any_in_stock: boolean;
  description: string;
}

export interface Catalog {
  generated_at: string;
  source: string;
  count: number;
  products: CatalogProduct[];
}

// ─── Capa 1: normalización ────────────────────────────────────────────────
const STOPWORDS = new Set([
  "de", "del", "la", "el", "las", "los", "un", "una", "unos", "unas",
  "para", "por", "con", "sin", "en", "al", "a", "o", "y", "u",
  "que", "mi", "tu", "su", "lo", "es", "soy", "me", "te", "se",
  "busco", "necesito", "quiero", "quisiera", "ando",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function singularize(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function normalizeQuery(q: string): string[] {
  return stripAccents(q.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map(singularize);
}

// ─── Capa 2: sinónimos de dominio outdoor ────────────────────────────────
// key = forma canónica; values = términos que deben expandirse al canónico
const SYNONYMS: Record<string, string[]> = {
  trail: ["montana", "cerro", "monte", "trocha", "sendero", "senderismo", "offroad", "ruta"],
  zapatilla: ["zapato", "calzado", "tenis", "tennis", "championes", "sneaker"],
  casaca: ["chaqueta", "chompa", "abrigo", "campera", "rompevientos"],
  impermeable: ["waterproof", "lluvia", "agua", "goretex", "gtx"],
  ligero: ["liviano", "light"],
  mochila: ["morral", "backpack", "bolso"],
  hidratacion: ["camelbak", "chaleco"],
  correr: ["corrida", "running", "run", "carrera"],
  trekking: ["hiking", "excursionismo", "caminata"],
  gorra: ["cachucha", "jockey"],
  media: ["calcetin", "calceta"],
  short: ["bermuda", "pantaloneta"],
  polo: ["remera", "camiseta", "tshirt"],
  pantalon: ["buzo", "lycra", "legging", "calza"],
};

const REVERSE_SYNONYMS = new Map<string, string>();
for (const [canonical, variants] of Object.entries(SYNONYMS)) {
  for (const v of variants) REVERSE_SYNONYMS.set(v, canonical);
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const t of tokens) {
    expanded.add(t);
    const canon = REVERSE_SYNONYMS.get(t);
    if (canon) expanded.add(canon);
    if (SYNONYMS[t]) for (const v of SYNONYMS[t]) expanded.add(v);
  }
  return [...expanded];
}

// ─── Detección de intención desde el query ──────────────────────────────
interface QueryIntent {
  genero: "hombre" | "mujer" | "unisex" | null;
  precio_max: number | null;
  tipo_hint: string | null;
  talla_hint: string | null;
}

function detectIntent(rawQuery: string): QueryIntent {
  const q = stripAccents(rawQuery.toLowerCase());

  let genero: QueryIntent["genero"] = null;
  if (/\b(hombre|masculino|caballero|varon)\b/.test(q)) genero = "hombre";
  else if (/\b(mujer|femenino|femenina|dama|chica)\b/.test(q)) genero = "mujer";

  let precio_max: number | null = null;
  const priceMatch = q.match(/(?:menos de|bajo|hasta|maximo|max)\s*(?:s\/\.?)?\s*(\d{2,5})/);
  if (priceMatch) precio_max = parseFloat(priceMatch[1]);

  let tipo_hint: string | null = null;
  if (/\btrail\b|\bmontana\b|\bcerro\b|\btrocha\b/.test(q)) tipo_hint = "trail";
  else if (/\btrekking\b|\bhiking\b|\bcaminata\b|\bexcursion/.test(q)) tipo_hint = "trekking";
  else if (/\bcasaca\b|\bchaqueta\b|\bchompa\b|\babrigo\b/.test(q)) tipo_hint = "casaca";
  else if (/\bmochila\b|\bbackpack\b/.test(q)) tipo_hint = "mochila";
  else if (/\burbano\b|\bcasual\b|\bdiario\b|\bcalle\b/.test(q)) tipo_hint = "urbano";
  else if (/\bgorra\b|\bcachucha\b|\bjockey\b/.test(q)) tipo_hint = "gorra";

  const tallaMatch = rawQuery.match(/\btalla\s*(\d{1,2}(?:\.\d)?|x{0,3}s|xs|s|m|l|xl|xxl)\b/i);
  const talla_hint = tallaMatch ? tallaMatch[1].toUpperCase() : null;

  return { genero, precio_max, tipo_hint, talla_hint };
}

// ─── Capa 3: Fuse.js sobre campos con texto expandido ───────────────────
interface IndexedProduct extends CatalogProduct {
  _search_title: string;
  _search_type: string;
  _search_tags: string;
  _search_colors: string;
  _search_description: string;
}

function buildSearchBlob(text: string): string {
  const tokens = normalizeQuery(text);
  const expanded = expandTokens(tokens);
  return [...new Set([...tokens, ...expanded])].join(" ");
}

function indexProduct(p: CatalogProduct): IndexedProduct {
  return {
    ...p,
    _search_title: buildSearchBlob(p.title),
    _search_type: buildSearchBlob(p.type),
    _search_tags: buildSearchBlob(p.tags.join(" ")),
    _search_colors: buildSearchBlob(p.colors.join(" ")),
    _search_description: buildSearchBlob(p.description),
  };
}

// ─── Lazy-load del catálogo + Fuse index ─────────────────────────────────
let _catalog: Catalog | null = null;
let _fuse: Fuse<IndexedProduct> | null = null;

function loadCatalog(): { catalog: Catalog; fuse: Fuse<IndexedProduct> } {
  if (_catalog && _fuse) return { catalog: _catalog, fuse: _fuse };

  const raw = readFileSync(CATALOG_PATH, "utf-8");
  const parsed: Catalog = JSON.parse(raw);
  const indexed = parsed.products.map(indexProduct);

  _catalog = parsed;
  _fuse = new Fuse(indexed, {
    keys: [
      { name: "_search_title", weight: 0.45 },
      { name: "_search_type", weight: 0.25 },
      { name: "_search_tags", weight: 0.15 },
      { name: "_search_description", weight: 0.1 },
      { name: "_search_colors", weight: 0.05 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 3,
  });

  return { catalog: _catalog, fuse: _fuse };
}

// ─── Capa 4: Re-ranking ─────────────────────────────────────────────────
function rerank(
  results: Array<{ item: IndexedProduct; score: number }>,
  intent: QueryIntent,
  explicit: { genero?: string | null; tipo?: string | null },
): Array<{ product: CatalogProduct; adjusted: number }> {
  const efectiveGenero = explicit.genero ?? intent.genero;
  const efectiveTipo = explicit.tipo ?? intent.tipo_hint;

  return results.map(({ item, score }) => {
    let adjusted = score; // menor es mejor en Fuse (0 = match perfecto)

    if (efectiveGenero) {
      if (item.genero === efectiveGenero) adjusted -= 0.15;
      else if (item.genero === "unisex") adjusted -= 0.05;
      else if (item.genero !== "desconocido") adjusted += 0.2;
    }

    if (efectiveTipo) {
      const typeNorm = stripAccents(item.type.toLowerCase());
      const hint = efectiveTipo.toLowerCase();
      if (typeNorm.includes(hint)) adjusted -= 0.2;
      else adjusted += 0.05;
    }

    if (item.sizes_available.length >= 4) adjusted -= 0.05;

    return { product: item, adjusted };
  });
}

// ─── API pública ─────────────────────────────────────────────────────────
export interface SearchArgs {
  query: string;
  genero?: "hombre" | "mujer" | "unisex" | null;
  tipo?: string | null;
  precio_max?: number | null;
  excluir_handles?: string[];
  limit?: number;
}

export interface SearchResult {
  product: CatalogProduct;
  score: number;
}

export function searchCatalog(args: SearchArgs): SearchResult[] {
  const { fuse } = loadCatalog();
  const limit = args.limit ?? 3;

  const tokens = normalizeQuery(args.query);
  const expanded = expandTokens(tokens);
  const searchText = expanded.join(" ");

  const { catalog } = loadCatalog();
  const raw: Array<{ item: IndexedProduct; score?: number }> = searchText
    ? fuse.search(searchText, { limit: 30 })
    : catalog.products.slice(0, 30).map((p) => ({
        item: indexProduct(p),
        score: 0.5,
      }));

  const intent = detectIntent(args.query);
  const excluded = new Set(args.excluir_handles ?? []);
  const efectivePrecioMax = args.precio_max ?? intent.precio_max;

  const reranked = rerank(
    raw
      .filter((r) => !excluded.has(r.item.handle))
      // Filtro HARD de precio: si el usuario dio un tope, nada por encima pasa.
      .filter((r) =>
        efectivePrecioMax === null
          ? true
          : r.item.price_min <= efectivePrecioMax,
      )
      .map((r) => ({ item: r.item, score: r.score ?? 1 })),
    intent,
    { genero: args.genero, tipo: args.tipo },
  );

  return reranked
    .sort((a, b) => a.adjusted - b.adjusted)
    .slice(0, limit)
    .map(({ product, adjusted }) => ({ product, score: adjusted }));
}

export function getCatalogMeta(): { count: number; generated_at: string } {
  const { catalog } = loadCatalog();
  return { count: catalog.count, generated_at: catalog.generated_at };
}
