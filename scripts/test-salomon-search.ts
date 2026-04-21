import { searchCatalog, getCatalogMeta } from "../src/services/salomon-catalog.js";

const meta = getCatalogMeta();
console.log(`\n📚 Catálogo: ${meta.count} productos (${meta.generated_at})\n`);

const queries: Array<{ label: string; args: Parameters<typeof searchCatalog>[0] }> = [
  { label: "zapatillas trail hombre 42", args: { query: "zapatillas trail hombre", genero: "hombre", tipo: "trail" } },
  { label: "casaca impermeable ligera", args: { query: "casaca impermeable ligera" } },
  { label: "mochila hidratacion 10L", args: { query: "mochila hidratacion correr" } },
  { label: "zapatillas urbanas negras mujer", args: { query: "zapatillas urbanas negras", genero: "mujer", tipo: "urbano" } },
  { label: "gorra running", args: { query: "gorra running" } },
  { label: "Speedcross", args: { query: "speedcross" } },
  { label: "correr en cerro terreno técnico", args: { query: "correr en cerro terreno tecnico", tipo: "trail" } },
  { label: "algo barato bajo 300 soles", args: { query: "zapatilla hombre", genero: "hombre", precio_max: 300 } },
];

for (const { label, args } of queries) {
  console.log(`🔎 Query: "${label}"`);
  const results = searchCatalog({ ...args, limit: 3 });
  if (results.length === 0) {
    console.log("   (sin resultados)\n");
    continue;
  }
  results.forEach((r, i) => {
    const p = r.product;
    console.log(
      `   ${i + 1}. [${r.score.toFixed(2)}] ${p.title} — ${p.type} — ${p.genero} — S/ ${p.price_min}`,
    );
  });
  console.log();
}
