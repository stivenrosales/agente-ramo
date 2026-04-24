import { autosellCatalog } from "../src/services/catalogs.js";

const meta = autosellCatalog.getCatalogMeta();
console.log(`\n📚 AUTOSELL: ${meta.count} autos (${meta.generated_at})\n`);

const tests: Array<{
  label: string;
  args: Parameters<typeof autosellCatalog.searchCatalog>[0];
}> = [
  { label: "suv familiar automático hasta 25k", args: { query: "suv familiar automatico", tipo: "SUV", precio_max: 25000 } },
  { label: "bmw x1", args: { query: "bmw x1" } },
  { label: "camioneta 4x4", args: { query: "camioneta 4x4" } },
  { label: "audi sedán", args: { query: "audi sedan", tipo: "Sedán" } },
  { label: "hatchback económico", args: { query: "hatchback economico", tipo: "Hatchback" } },
  { label: "pickup 4x4", args: { query: "pickup 4x4", tipo: "Pick up" } },
  { label: "mercedes 2018+", args: { query: "mercedes", anio_min: 2018 } },
  { label: "auto con pocos km (<50k)", args: { query: "auto", km_max: 50000 } },
  { label: "toyota automatico", args: { query: "toyota automatico" } },
  { label: "porsche", args: { query: "porsche" } },
];

for (const { label, args } of tests) {
  console.log(`🔎 ${label}`);
  const results = autosellCatalog.searchCatalog({ ...args, limit: 3 });
  if (results.length === 0) {
    console.log("   (sin resultados)\n");
    continue;
  }
  results.forEach((r, i) => {
    const p = r.product;
    const km = p.km != null ? `${p.km.toLocaleString()}km` : "?km";
    console.log(
      `   ${i + 1}. [${r.score.toFixed(2)}] [${p.anio}] ${p.title} — ${p.carroceria} — ${km} — US$${p.price_min}`,
    );
  });
  console.log();
}
