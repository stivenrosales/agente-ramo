import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fuse from "fuse.js";

// ─── Tipos compartidos ───────────────────────────────────────────────────
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
  // Campos opcionales específicos del dominio automotriz (perfil autosell).
  // Las tiendas de ropa los dejan undefined.
  marca?: string;
  anio?: number;
  km?: number;
  transmision?: string;
  combustible?: string;
  carroceria?: string;
  traccion?: string;
  cilindrada?: number;
  servicios?: string;
}

export interface Catalog {
  generated_at: string;
  source: string;
  count: number;
  products: CatalogProduct[];
}

export interface SearchArgs {
  query: string;
  genero?: "hombre" | "mujer" | "unisex" | null;
  tipo?: string | null;
  precio_max?: number | null;
  /** Filtros hard específicos de autos. Sin efecto si el catálogo no los define. */
  anio_min?: number | null;
  km_max?: number | null;
  excluir_handles?: string[];
  limit?: number;
}

export interface SearchResult {
  product: CatalogProduct;
  score: number;
}

export interface CatalogConfig {
  /** Path relativo a process.cwd() del JSON generado por sync. */
  catalogPath: string;
  /** Label para logs, ej. "Salomon". */
  brandLabel: string;
  /** Diccionario de sinónimos: clave canónica → variantes. */
  synonyms: Record<string, string[]>;
  /** Detectores de tipo_hint basados en regex sobre el query normalizado. */
  typeHints: Array<{ pattern: RegExp; hint: string }>;
  /**
   * Peso del boost por género. Salomon usa "fuerte" (ropa por género marcada).
   * Wilson usa "debil" (género menos explícito en el catálogo).
   */
  generoBoost: "fuerte" | "debil";
}

// ─── Utilidades puras ─────────────────────────────────────────────────────
const SHARED_STOPWORDS = new Set([
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
    .filter((t) => t && !SHARED_STOPWORDS.has(t))
    .map(singularize);
}

// ─── Factory principal ───────────────────────────────────────────────────
export function createCatalogSearch(config: CatalogConfig) {
  const reverseSynonyms = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(config.synonyms)) {
    for (const v of variants) reverseSynonyms.set(v, canonical);
  }

  function expandTokens(tokens: string[]): string[] {
    const expanded = new Set<string>();
    for (const t of tokens) {
      expanded.add(t);
      const canon = reverseSynonyms.get(t);
      if (canon) expanded.add(canon);
      if (config.synonyms[t]) for (const v of config.synonyms[t]) expanded.add(v);
    }
    return [...expanded];
  }

  interface QueryIntent {
    genero: "hombre" | "mujer" | "unisex" | null;
    precio_max: number | null;
    tipo_hint: string | null;
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
    for (const { pattern, hint } of config.typeHints) {
      if (pattern.test(q)) {
        tipo_hint = hint;
        break;
      }
    }

    return { genero, precio_max, tipo_hint };
  }

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

  let _catalog: Catalog | null = null;
  let _fuse: Fuse<IndexedProduct> | null = null;

  function loadCatalog(): { catalog: Catalog; fuse: Fuse<IndexedProduct> } {
    if (_catalog && _fuse) return { catalog: _catalog, fuse: _fuse };

    const absPath = resolve(process.cwd(), config.catalogPath);
    const raw = readFileSync(absPath, "utf-8");
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
      useExtendedSearch: true,
    });

    return { catalog: _catalog, fuse: _fuse };
  }

  function rerank(
    results: Array<{ item: IndexedProduct; score: number }>,
    intent: QueryIntent,
    explicit: { genero?: string | null; tipo?: string | null },
    queryTokens: string[],
  ): Array<{ product: CatalogProduct; adjusted: number }> {
    const efectiveGenero = explicit.genero ?? intent.genero;
    const efectiveTipo = explicit.tipo ?? intent.tipo_hint;

    const generoMatchBoost = config.generoBoost === "fuerte" ? -0.15 : -0.07;
    const generoMismatchPenalty = config.generoBoost === "fuerte" ? 0.2 : 0.08;

    return results.map(({ item, score }) => {
      let adjusted = score;

      if (efectiveGenero) {
        if (item.genero === efectiveGenero) adjusted += generoMatchBoost;
        else if (item.genero === "unisex") adjusted -= 0.05;
        else if (item.genero !== "desconocido") adjusted += generoMismatchPenalty;
      }

      if (efectiveTipo) {
        // Chequeamos contra el blob expandido (incluye sinónimos), no el type raw.
        // Así hint "padel" matchea type "PALETA" (cuyo blob incluye "padel").
        const typeBlob = stripAccents(item._search_type.toLowerCase());
        const hint = stripAccents(efectiveTipo.toLowerCase());
        if (typeBlob.includes(hint)) adjusted -= 0.2;
        else adjusted += 0.05;
      }

      // Boost por COBERTURA de tokens del query en título+tipo.
      // Ej: "Blade 98" tiene 2 tokens. Producto "Raqueta Blade 98" cubre los 2 → boost grande.
      // "Gorra Blade III" cubre 1 → boost chico. Así el específico gana al genérico.
      if (queryTokens.length > 0) {
        const blob = `${item._search_title} ${item._search_type}`;
        const matched = queryTokens.filter((t) => t.length >= 2 && blob.includes(t)).length;
        const coverage = matched / queryTokens.length;
        adjusted -= coverage * 0.18;
      }

      if (item.sizes_available.length >= 4) adjusted -= 0.05;

      return { product: item, adjusted };
    });
  }

  function searchCatalog(args: SearchArgs): SearchResult[] {
    const { fuse, catalog } = loadCatalog();
    const limit = args.limit ?? 3;

    const tokens = normalizeQuery(args.query);
    const expanded = expandTokens(tokens);

    // Extended search OR: cada token es un sub-patrón independiente.
    // Así "paleta padel intermedio" busca "paleta" O "padel" O "intermedio",
    // no la frase completa como una unidad (que rompía el threshold).
    const orPattern = expanded.map((t) => `'${t}`).join(" | ");

    // Limit alto: Fuse es el candidate-generator, el reranker decide el top final.
    // Con OR de múltiples tokens, queremos margen para que productos con menos
    // tokens matching pero mejor cobertura de query original no queden fuera.
    const raw: Array<{ item: IndexedProduct; score?: number }> = orPattern
      ? fuse.search(orPattern, { limit: 60 })
      : catalog.products.slice(0, 60).map((p) => ({
          item: indexProduct(p),
          score: 0.5,
        }));

    const intent = detectIntent(args.query);
    const excluded = new Set(args.excluir_handles ?? []);
    const efectivePrecioMax = args.precio_max ?? intent.precio_max;

    const reranked = rerank(
      raw
        .filter((r) => !excluded.has(r.item.handle))
        .filter((r) =>
          efectivePrecioMax === null
            ? true
            : r.item.price_min <= efectivePrecioMax,
        )
        .filter((r) =>
          args.anio_min == null || r.item.anio == null
            ? true
            : r.item.anio >= args.anio_min,
        )
        .filter((r) =>
          args.km_max == null || r.item.km == null
            ? true
            : r.item.km <= args.km_max,
        )
        .map((r) => ({ item: r.item, score: r.score ?? 1 })),
      intent,
      { genero: args.genero, tipo: args.tipo },
      tokens,
    );

    return reranked
      .sort((a, b) => a.adjusted - b.adjusted)
      .slice(0, limit)
      .map(({ product, adjusted }) => ({ product, score: adjusted }));
  }

  function getCatalogMeta(): { count: number; generated_at: string; brand: string } {
    const { catalog } = loadCatalog();
    return {
      count: catalog.count,
      generated_at: catalog.generated_at,
      brand: config.brandLabel,
    };
  }

  return { searchCatalog, getCatalogMeta, loadCatalog };
}

export type CatalogSearch = ReturnType<typeof createCatalogSearch>;
