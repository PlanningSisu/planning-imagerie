// ---------- Données de démo ----------

// Spécialités : couleur = spécialité, forme = grade (rectangle pour sénior, arrondi pour interne).
// "specialites: []" = interne socle (pas encore de spécialité).
// Les internes spécialisés ont deux spécialités -> chip en dégradé bicolore (voir chipVisual()).
const SPECIALITES = {
  digestif: { label: "Digestif", abbrev: "Dig", bg: "#dcfce7", border: "#22c55e", text: "#14532d" },
  uro: { label: "Uro", abbrev: "Uro", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  gyneco: { label: "Gynéco", abbrev: "Gyn", bg: "#fce7f3", border: "#ec4899", text: "#9d174d" },
  thorax: { label: "Thorax", abbrev: "Tho", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  os: { label: "Os", abbrev: "Os", bg: "#ffffff", border: "#64748b", text: "#1e293b" },
};
// Le fond teinté des cases "spécialité de vacation" (.tint-digestif etc.) est codé en dur dans
// style.css, aligné sur ces mêmes couleurs `bg` — pas de champ séparé ici pour éviter la duplication.

// Ordre canonique des spécialités : toujours affichées/dégradées dans cet ordre,
// quel que soit l'ordre de saisie (ex. "Gynéco + Thorax", jamais "Thorax + Gynéco").
const SPECIALITE_ORDER = ["digestif", "uro", "gyneco", "thorax", "os"];

