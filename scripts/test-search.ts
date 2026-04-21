import { salomonCatalog, wilsonCatalog } from "../src/services/catalogs.js";

function runTests(label: string, catalog: typeof salomonCatalog, queries: Array<{ label: string; args: Parameters<typeof catalog.searchCatalog>[0] }>) {
  const meta = catalog.getCatalogMeta();
  console.log(`\n═════════════════════════════════════════════════════`);
  console.log(`📚 ${label}: ${meta.count} productos (${meta.generated_at})`);
  console.log(`═════════════════════════════════════════════════════\n`);

  for (const { label: qLabel, args } of queries) {
    console.log(`🔎 "${qLabel}"`);
    const results = catalog.searchCatalog({ ...args, limit: 3 });
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
}

runTests("SALOMON", salomonCatalog, [
  { label: "zapatillas trail hombre 42", args: { query: "zapatillas trail hombre", genero: "hombre", tipo: "trail" } },
  { label: "casaca impermeable ligera", args: { query: "casaca impermeable ligera" } },
  { label: "Speedcross", args: { query: "speedcross" } },
  { label: "bajo 300 soles", args: { query: "zapatilla hombre", genero: "hombre", precio_max: 300 } },
]);

runTests("WILSON", wilsonCatalog, [
  { label: "raqueta tenis avanzado", args: { query: "raqueta tenis avanzado", tipo: "raqueta" } },
  { label: "paleta padel intermedio", args: { query: "paleta padel intermedio", tipo: "padel" } },
  { label: "pala de padel", args: { query: "pala de padel" } }, // argentino → debe matchear paleta
  { label: "pelotas de tenis", args: { query: "pelotas tenis", tipo: "pelota" } },
  { label: "Wilson Blade 98", args: { query: "blade 98" } },
  { label: "overgrip", args: { query: "overgrip" } },
  { label: "rodillera", args: { query: "rodillera soporte", tipo: "medicinal" } },
  { label: "zapatillas tenis hombre", args: { query: "zapatilla tenis hombre", genero: "hombre", tipo: "tenis" } },
  { label: "raquetero", args: { query: "bolso para raquetas" } },
]);
