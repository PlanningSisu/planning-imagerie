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

// Compétences (js/16-gestion-personnel.js, person.competences) : catalogue PLUS LARGE que les 5
// spécialités officielles ci-dessus -- une compétence peut exister sans être une spécialité
// assignable à une vacation (ex. "Mammo", 10/08/2026 : aucune case n'a jamais "Mammo" comme
// spécialité propriétaire au sens de vacationSpecialites/SPECIALITE_ORDER, contrairement à Digestif/
// Uro/Gynéco/Thorax). `COMPETENCE_EXTRA_LABELS` ne porte QUE le label -- une compétence n'a jamais
// de couleur/dégradé (voir orderedCompetences()/personTooltip()), donc pas besoin des champs
// bg/border/text de SPECIALITES pour ces clés-là.
//
// "Os" retirée du catalogue (11/08/2026, demande de Samir) : une vacation Os n'est de toute façon
// JAMAIS staffée (RG-011), donc une compétence "Os" (cheat code RG-001, voir personSatisfiesSpecialite()
// dans js/07-validation-rg.js) ne pouvait jamais servir à rien -- pas un renommage, un vrai retrait.
// Aucune migration nécessaire : une personne qui avait déjà "os" dans son tableau `competences` (un
// seul cas réel en prod, déjà redondant avec sa vraie spécialité Os) le garde tel quel en storage,
// simplement ignoré partout désormais puisqu'absent de `COMPETENCE_ORDER` (même mécanisme silencieux
// que pour toute valeur qui sortirait un jour du catalogue -- voir orderedCompetences()).
//
// Digestif/Uro/Gynéco scindées Scan/IRM (11/08/2026, demande de Samir : "certains peuvent avoir la
// compétence Gynéco mais que pour le Scan (donc A et B) ou que pour l'IRM... ou les deux") -- Thorax
// et Mammo restent de simples compétences globales (pas demandé pour elles). Clé composée
// `"<spécialité>:<scan|irm>"` plutôt que 2 champs séparés sur `person` : reste un simple tableau de
// chaînes, donc `orderedCompetences()`/le rendu des cases à cocher (js/16-gestion-personnel.js,
// entièrement piloté par COMPETENCE_ORDER) fonctionnent SANS AUCUN changement de leur côté.
const COMPETENCE_SCAN_IRM_SPECIALITES = ["digestif", "uro", "gyneco"];
const COMPETENCE_SCOPE_LABELS = { scan: "Scan", irm: "IRM" };
const COMPETENCE_EXTRA_LABELS = { mammo: "Mammo" };
const COMPETENCE_ORDER = [
  ...COMPETENCE_SCAN_IRM_SPECIALITES.flatMap((spec) => [`${spec}:scan`, `${spec}:irm`]),
  "thorax",
  "mammo",
];
function competenceLabel(key) {
  if (key.includes(":")) {
    const [spec, scope] = key.split(":");
    const specLabel = (SPECIALITES[spec] && SPECIALITES[spec].label) || spec;
    return `${specLabel} (${COMPETENCE_SCOPE_LABELS[scope] || scope})`;
  }
  return (SPECIALITES[key] && SPECIALITES[key].label) || COMPETENCE_EXTRA_LABELS[key] || key;
}

// Quelle "portée" de compétence Scan/IRM une activité représente-t-elle, pour le cheat code RG-001 ?
// UNIQUEMENT ces 4 activités précises (Scan U/Echo U/ECN-1/ECN-2/Mammo exclues -- portée volontairement
// restreinte, comme demandé : "Scan (donc A et B)"/"IRM (1.5 et 3)", pas "tout ce qui y ressemble").
// `null` = cette activité n'est concernée par aucune des deux portées.
function competenceScopeForActivity(activityId) {
  if (activityId === "scan-a" || activityId === "scan-b") return "scan";
  if (activityId === "irm-15t" || activityId === "irm-3t") return "irm";
  return null;
}

