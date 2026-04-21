import { createCatalogSearch } from "./catalog-search.js";

// ─── Salomon (outdoor, trail, running, trekking) ──────────────────────
export const salomonCatalog = createCatalogSearch({
  catalogPath: "data/salomon-catalog.json",
  brandLabel: "Salomon",
  generoBoost: "fuerte",
  synonyms: {
    trail: ["montana", "cerro", "monte", "trocha", "sendero", "senderismo", "offroad", "ruta"],
    zapatilla: ["zapato", "calzado", "championes", "sneaker"],
    casaca: ["chaqueta", "chompa", "abrigo", "campera", "rompevientos"],
    impermeable: ["waterproof", "lluvia", "agua", "goretex", "gtx"],
    ligero: ["liviano", "light"],
    mochila: ["morral", "backpack"],
    hidratacion: ["camelbak", "chaleco"],
    correr: ["corrida", "running", "run", "carrera"],
    trekking: ["hiking", "excursionismo", "caminata"],
    gorra: ["cachucha", "jockey"],
    media: ["calcetin", "calceta"],
    short: ["bermuda", "pantaloneta"],
    polo: ["remera", "camiseta", "tshirt"],
    pantalon: ["buzo", "lycra", "legging", "calza"],
  },
  typeHints: [
    { pattern: /\btrail\b|\bmontana\b|\bcerro\b|\btrocha\b/, hint: "trail" },
    { pattern: /\btrekking\b|\bhiking\b|\bcaminata\b|\bexcursion/, hint: "trekking" },
    { pattern: /\bcasaca\b|\bchaqueta\b|\bchompa\b|\babrigo\b/, hint: "casaca" },
    { pattern: /\bmochila\b|\bbackpack\b/, hint: "mochila" },
    { pattern: /\burbano\b|\bcasual\b|\bdiario\b|\bcalle\b/, hint: "urbano" },
    { pattern: /\bgorra\b|\bcachucha\b|\bjockey\b/, hint: "gorra" },
  ],
});

// ─── Wilson (tenis, padel, basquet, volley, fitness) ──────────────────
// Vocabulario basado en el catálogo real: Wilson usa "paleta" (no "pala"),
// "raqueta" para tenis, "overgrip"/"reel"/"clay" en inglés técnico.
export const wilsonCatalog = createCatalogSearch({
  catalogPath: "data/wilson-catalog.json",
  brandLabel: "Wilson",
  generoBoost: "debil",
  synonyms: {
    // Padel canónico — el deporte Y el producto se indexan bajo "padel".
    // Wilson mezcla en el catálogo: type="PALETA" pero title="Pala de Padel".
    padel: ["paleta", "pala", "paddle", "pádel"],
    raqueta: ["racket", "raqueton"],
    pelota: ["bola", "ball"],
    overgrip: ["grip"],
    cuerda: ["encordado", "string", "hilo"],
    raquetero: ["bolso", "bag"],
    tenis: ["tennis"],
    clay: ["arcilla", "polvo"],
    zapatilla: ["zapato", "calzado"],
    mochila: ["backpack"],
    short: ["bermuda", "pantaloneta"],
    polo: ["camiseta", "remera", "tshirt"],
    rodillera: ["soporte", "knee"],
    tobillera: ["ankle"],
    basquet: ["basketball", "basket"],
    voley: ["volley", "volleyball"],
  },
  // Orden importa: más específico antes que más general.
  typeHints: [
    { pattern: /\bpaleta\b|\bpala\b|\bpadel\b|\bpaddle\b|\bpádel\b/, hint: "padel" },
    { pattern: /\bbeach\b/, hint: "beach" },
    { pattern: /\bovergrip\b/, hint: "overgrip" },
    { pattern: /\bcuerda\b|\bencordado\b|\bstring\b|\breel\b/, hint: "cuerda" },
    { pattern: /\braquetero\b/, hint: "raquetero" },
    { pattern: /\bpelota\b|\bbola\b|\bball\b/, hint: "pelota" },
    { pattern: /\braquet/, hint: "raqueta" },
    { pattern: /\btenis\b|\btennis\b/, hint: "tenis" },
    { pattern: /\bbasquet\b|\bbasketball\b|\bbasket\b/, hint: "basketball" },
    { pattern: /\bvoley\b|\bvolley\b|\bvolleyball\b/, hint: "volleyball" },
    { pattern: /\bfutbol americano\b|\bfootball\b/, hint: "american football" },
    { pattern: /\bmochila\b|\bbackpack\b/, hint: "mochila" },
    { pattern: /\brodillera\b|\btobillera\b|\bmu[ñn]equera\b|\bfaja\b/, hint: "medicinal" },
  ],
});
