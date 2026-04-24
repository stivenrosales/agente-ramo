import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Fuente: la pagina /compra-tu-auto es SSR con Angular 19 y embed el catalogo
// completo en un <script id="ng-state"> como JSON bajo la clave "buy-car-autos".
// La API REST (api.autosell.pe/api/v1/...) responde 403 sin token, asi que
// este HTML SSR es la fuente publica mas limpia. ~137 autos disponibles.
const LISTING_URL = "https://www.autosell.pe/compra-tu-auto";
const SITE = "https://www.autosell.pe";
const IMG_CDN = "https://autosell-imagenes.sfo3.cdn.digitaloceanspaces.com/autos";
const OUTPUT = resolve(process.cwd(), "data", "autosell-catalog.json");

interface RawAuto {
  idAuto: number;
  marca: string;
  modelo: string;
  version: string | null;
  color: string | null;
  carroceria: string | null;
  anioFabricacion: number | null;
  anioModelo: number | null;
  precioCompra: number;
  ultimoPrecioCompra: number | null;
  kilometraje: number | null;
  cilindrada: number | null;
  transmision: string | null;
  traccion: string | null;
  adicionales: string | null;
  combustible: string | null;
  fotoPrincipal: string | null;
  tag: string | null;
  estadoDes: string;
  servicios: string | null;
  swTresFilas: boolean;
  placa: string | null;
  idTienda: number;
}

interface CatalogProduct {
  id: number;
  title: string;
  handle: string;
  url: string;
  type: string;
  genero: "desconocido";
  tags: string[];
  price_min: number;
  price_max: number;
  image: string;
  colors: string[];
  sizes_available: string[];
  any_in_stock: boolean;
  description: string;
  marca: string;
  anio: number;
  km: number;
  transmision: string;
  combustible: string;
  carroceria: string;
  traccion: string;
  cilindrada: number;
  servicios: string;
}

interface Catalog {
  generated_at: string;
  source: string;
  count: number;
  products: CatalogProduct[];
}

function fmtKm(km: number | null): string {
  if (km == null) return "km no informado";
  return `${km.toLocaleString("es-PE")} km`;
}

function buildTitle(a: RawAuto): string {
  const partes = [a.marca, a.modelo, a.version].filter(Boolean);
  const anio = a.anioModelo ?? a.anioFabricacion;
  const titulo = partes.join(" ");
  return anio ? `${titulo} ${anio}` : titulo;
}

function buildDescription(a: RawAuto): string {
  const bits: string[] = [];
  if (a.carroceria) bits.push(a.carroceria);
  if (a.kilometraje != null) bits.push(fmtKm(a.kilometraje));
  if (a.transmision) bits.push(a.transmision);
  if (a.traccion) bits.push(a.traccion);
  if (a.combustible) bits.push(a.combustible);
  if (a.cilindrada) bits.push(`${a.cilindrada}cc`);
  if (a.color) bits.push(`color ${a.color.toLowerCase()}`);
  if (a.swTresFilas) bits.push("3 filas de asientos");
  if (a.adicionales) bits.push(a.adicionales);
  return bits.join(" · ");
}

function buildTags(a: RawAuto): string[] {
  const tags: string[] = [];
  if (a.marca) tags.push(a.marca);
  if (a.carroceria) tags.push(a.carroceria);
  if (a.transmision) tags.push(a.transmision);
  if (a.combustible) tags.push(a.combustible);
  if (a.traccion) tags.push(a.traccion);
  if (a.servicios) tags.push(a.servicios);
  if (a.swTresFilas) tags.push("7 asientos");
  return tags;
}

function normalize(a: RawAuto): CatalogProduct | null {
  if (a.estadoDes !== "DISPONIBLE") return null;
  if (!a.fotoPrincipal) return null;

  const anio = a.anioModelo ?? a.anioFabricacion ?? 0;
  return {
    id: a.idAuto,
    title: buildTitle(a),
    handle: String(a.idAuto),
    url: `${SITE}/info-auto/${a.idAuto}`,
    type: a.carroceria ?? "Auto",
    genero: "desconocido",
    tags: buildTags(a),
    price_min: a.precioCompra,
    price_max: a.precioCompra,
    image: `${IMG_CDN}/${a.idAuto}/${a.fotoPrincipal}`,
    colors: a.color ? [a.color] : [],
    sizes_available: [],
    any_in_stock: true,
    description: buildDescription(a),
    marca: a.marca,
    anio,
    km: a.kilometraje ?? 0,
    transmision: a.transmision ?? "",
    combustible: a.combustible ?? "",
    carroceria: a.carroceria ?? "",
    traccion: a.traccion ?? "",
    cilindrada: a.cilindrada ?? 0,
    servicios: a.servicios ?? "",
  };
}

async function fetchListing(): Promise<RawAuto[]> {
  const res = await fetch(LISTING_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (autosell-sync)" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const html = await res.text();

  const match = html.match(
    /<script id="ng-state" type="application\/json">(.+?)<\/script>/s,
  );
  if (!match) throw new Error("ng-state no encontrado en HTML");

  const data = JSON.parse(match[1]) as { "buy-car-autos"?: RawAuto[] };
  const autos = data["buy-car-autos"];
  if (!Array.isArray(autos)) throw new Error("buy-car-autos no es array");
  return autos;
}

async function main() {
  console.log("🚗 Descargando catalogo de Autosell (SSR ng-state)...");
  const raw = await fetchListing();
  console.log(`   ${raw.length} autos crudos recibidos.`);

  const products = raw
    .map(normalize)
    .filter((p): p is CatalogProduct => p !== null);

  console.log(
    `   ${products.length} disponibles (descartados ${raw.length - products.length} no-disponibles/sin foto).`,
  );

  const catalog: Catalog = {
    generated_at: new Date().toISOString(),
    source: LISTING_URL,
    count: products.length,
    products,
  };

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(catalog, null, 2), "utf-8");

  const sizeKb = (JSON.stringify(catalog).length / 1024).toFixed(1);
  console.log(`✅ Catalogo escrito en ${OUTPUT} (${sizeKb} KB)`);

  const byMarca = new Map<string, number>();
  for (const p of products) byMarca.set(p.marca, (byMarca.get(p.marca) ?? 0) + 1);
  console.log("\n📊 Resumen por marca:");
  [...byMarca.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([m, n]) => console.log(`   ${n.toString().padStart(3)}  ${m}`));

  const byCarroceria = new Map<string, number>();
  for (const p of products)
    byCarroceria.set(p.carroceria, (byCarroceria.get(p.carroceria) ?? 0) + 1);
  console.log("\n📊 Resumen por carroceria:");
  [...byCarroceria.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`   ${n.toString().padStart(3)}  ${c || "(sin dato)"}`));
}

main().catch((err) => {
  console.error("❌ Sync fallo:", err);
  process.exit(1);
});
