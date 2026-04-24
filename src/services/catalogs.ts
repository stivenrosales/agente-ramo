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

// ─── Autosell (autos seminuevos de lujo, Lima) ────────────────────────
// `type` del CatalogProduct mapea 1:1 a la carroceria (SUV, Sedán, Hatchback…).
// Las marcas canónicas se indexan como tokens dentro de tags+description para
// que Fuse las encuentre; los typeHints permiten rutear por carroceria cuando
// el cliente usa vocablos coloquiales peruanos ("camioneta" → SUV/Pick up).
export const autosellCatalog = createCatalogSearch({
  catalogPath: "data/autosell-catalog.json",
  brandLabel: "Autosell",
  generoBoost: "debil", // irrelevante: autos no tienen género; el boost nunca dispara.
  synonyms: {
    suv: ["camioneta", "4x4", "todoterreno"],
    sedan: ["auto", "sedán"],
    hatchback: ["compacto", "citycar"],
    pickup: ["pick", "pick-up", "camioneta de carga", "tolva"],
    coupe: ["coupé", "deportivo"],
    convertible: ["descapotable", "cabrio", "cabriolet"],
    automatico: ["automatica", "at", "tiptronic", "dsg"],
    manual: ["mecanico", "mecanica", "mt"],
    gasolina: ["bencina", "nafta"],
    diesel: ["diésel", "petrolero"],
    hibrido: ["híbrido", "hybrid"],
    electrico: ["eléctrico", "ev"],
    "mercedes benz": ["mercedes", "merce", "benz"],
    volkswagen: ["vw", "wolks", "volks"],
    toyota: ["toyo"],
    chevrolet: ["chevy"],
    // Marcas no-redundantes se auto-reconocen: Audi, BMW, Porsche, Volvo, etc.
  },
  typeHints: [
    // Orden importa: específico antes que general.
    { pattern: /\bpick\s*up\b|\btolva\b|\bpickup\b/, hint: "Pick up" },
    { pattern: /\bcoupe\b|\bcoupé\b|\bdeportivo\b/, hint: "Coupé" },
    { pattern: /\bconvertible\b|\bdescapotable\b|\bcabrio\b/, hint: "Convertible" },
    { pattern: /\bhatchback\b|\bcompacto\b|\bcitycar\b/, hint: "Hatchback" },
    { pattern: /\bsedan\b|\bsedán\b/, hint: "Sedán" },
    { pattern: /\bvan\b|\bminivan\b/, hint: "Van" },
    { pattern: /\bmoto\b|\bmotocicleta\b/, hint: "Motocicleta" },
    { pattern: /\bsuv\b|\bcamioneta\b|\b4x4\b|\btodoterreno\b/, hint: "SUV" },
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
