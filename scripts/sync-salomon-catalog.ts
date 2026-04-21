import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const STORE = "https://www.salomonstore.com.pe";
const OUTPUT = resolve(process.cwd(), "data", "salomon-catalog.json");

interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  available: boolean;
}

interface ShopifyImage {
  src: string;
  position: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type: string;
  vendor: string;
  tags: string[];
  body_html: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: { name: string; position: number; values: string[] }[];
}

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

function stripHtml(html: string, maxLen = 500): string {
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

function inferGenero(
  tags: string[],
  vendor: string,
  title: string,
): CatalogProduct["genero"] {
  const hay = [...tags, vendor, title].join(" ").toLowerCase();
  const tieneHombre = /\bhombre\b|\bmasculino\b/.test(hay);
  const tieneMujer = /\bmujer\b|\bfemenino\b|\bfemenina\b/.test(hay);
  if (tieneHombre && tieneMujer) return "unisex";
  if (/\bunisex\b/.test(hay)) return "unisex";
  if (tieneHombre) return "hombre";
  if (tieneMujer) return "mujer";
  return "desconocido";
}

function findSizeOption(
  options: ShopifyProduct["options"],
): { index: 1 | 2 | 3 } | null {
  const match = options.find((o) => /talla|size/i.test(o.name));
  if (!match) return null;
  return { index: match.position as 1 | 2 | 3 };
}

function findColorOption(
  options: ShopifyProduct["options"],
): { index: 1 | 2 | 3 } | null {
  const match = options.find((o) => /color/i.test(o.name));
  if (!match) return null;
  return { index: match.position as 1 | 2 | 3 };
}

function variantField(v: ShopifyVariant, idx: 1 | 2 | 3): string | null {
  if (idx === 1) return v.option1;
  if (idx === 2) return v.option2;
  return v.option3;
}

function normalize(p: ShopifyProduct): CatalogProduct | null {
  const anyInStock = p.variants.some((v) => v.available);
  if (!anyInStock) return null;

  const prices = p.variants.map((v) => parseFloat(v.price)).filter((n) => !Number.isNaN(n));
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  const sizeOpt = findSizeOption(p.options);
  const colorOpt = findColorOption(p.options);

  const sizesAvailable = new Set<string>();
  const colorsAll = new Set<string>();

  for (const v of p.variants) {
    if (colorOpt) {
      const c = variantField(v, colorOpt.index);
      if (c) colorsAll.add(c);
    }
    if (sizeOpt && v.available) {
      const s = variantField(v, sizeOpt.index);
      if (s) sizesAvailable.add(s);
    }
  }

  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: `${STORE}/products/${p.handle}`,
    type: p.product_type || "Otros",
    genero: inferGenero(p.tags, p.vendor, p.title),
    tags: p.tags.filter((t) => !/^Ropa|^Calzado|Hombre|Mujer|Unisex|Colecciones/i.test(t)),
    price_min: priceMin,
    price_max: priceMax,
    image: p.images[0]?.src ?? "",
    colors: [...colorsAll],
    sizes_available: [...sizesAvailable],
    any_in_stock: anyInStock,
    description: stripHtml(p.body_html),
  };
}

async function fetchAll(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let page = 1;
  while (true) {
    const url = `${STORE}/collections/all/products.json?limit=250&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed ${res.status} on page ${page}`);
    const json = (await res.json()) as { products: ShopifyProduct[] };
    if (!json.products.length) break;
    all.push(...json.products);
    page += 1;
    if (page > 20) break;
  }
  return all;
}

async function main() {
  console.log("📦 Descargando catálogo de Salomon Store Perú...");
  const raw = await fetchAll();
  console.log(`   ${raw.length} productos crudos recibidos.`);

  const products = raw
    .map(normalize)
    .filter((p): p is CatalogProduct => p !== null);

  console.log(
    `   ${products.length} con stock real (se descartaron ${raw.length - products.length} agotados).`,
  );

  const catalog: Catalog = {
    generated_at: new Date().toISOString(),
    source: `${STORE}/collections/all/products.json`,
    count: products.length,
    products,
  };

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(catalog, null, 2), "utf-8");

  const sizeKb = (JSON.stringify(catalog).length / 1024).toFixed(1);
  console.log(`✅ Catálogo escrito en ${OUTPUT} (${sizeKb} KB)`);

  const byType = new Map<string, number>();
  for (const p of products) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
  console.log("\n📊 Resumen por tipo:");
  [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => console.log(`   ${n.toString().padStart(3)}  ${t}`));
}

main().catch((err) => {
  console.error("❌ Sync falló:", err);
  process.exit(1);
});
