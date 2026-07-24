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

// ---------- Import en masse (coller une liste type "Gestion Personnel") ----------
// Format attendu, tolérant : un en-tête de grade ("Seniors"/"Internes"), puis des en-têtes de
// spécialité ("Dig", "Uro"...), puis une personne par ligne ("Prénom Nom" + reste ignoré : statut,
// remarques entre parenthèses...). Tout le superflu est ignoré silencieusement.

const GRADE_ALIASES = {
  senior: "senior",
  seniors: "senior",
  interne: "interne",
  internes: "interne",
};

const SPECIALITE_ALIASES = {
  dig: "digestif",
  digestif: "digestif",
  digestifs: "digestif",
  uro: "uro",
  urologie: "uro",
  gyn: "gyneco",
  gyneco: "gyneco",
  gynecologie: "gyneco",
  tho: "thorax",
  thorax: "thorax",
  os: "os",
  osseux: "os",
  socle: "__socle__",
};

// Enlève les accents et met en minuscules, pour reconnaître "Gynéco"/"GYNECO"/"gyneco" indifféremment.
function normalizeToken(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function matchGradeHeader(line) {
  return GRADE_ALIASES[normalizeToken(line)] || null;
}

// Renvoie un tableau de spécialités si la ligne est un en-tête de spécialité (ex. "Dig", "Dig/Uro",
// "Socle"), sinon null. "Socle" seul renvoie un tableau vide (interne pas encore spécialisé).
function matchSpecialiteHeader(line) {
  const parts = line
    .split(/[+/,&]| et /i)
    .map(normalizeToken)
    .filter(Boolean);
  if (parts.length === 0) return null;
  const resolved = parts.map((p) => SPECIALITE_ALIASES[p]);
  if (resolved.some((r) => !r)) return null;
  if (resolved.includes("__socle__")) return resolved.length === 1 ? [] : null;
  return [...new Set(resolved)];
}

// RG-016 (24/07/2026) : reconnaît une ligne "Hors Sisu" auto-suffisante, ex.
// "VILTART Sylvain - Hors sisu sénior OS" ou juste "MAAREK Kevin - Hors Sisu" -- indépendante des
// en-têtes de grade/spécialité en cours (pas besoin d'un bloc "Seniors"/"Internes" au-dessus,
// contrairement au format historique). Découpe sur le PREMIER " - " : tout avant = le nom, tout
// après = à analyser pour grade/spécialité. Ne matche que sur le mot-clé "hors" seul (pas "hors
// sisu" en entier) -- tolère une coquille comme "Hors siso" rencontrée dans un cas réel, sans avoir
// besoin de distance de Levenshtein ici (le mot "hors" seul seul suffit à ne jamais matcher une
// ligne normale par accident).
function matchHorsSisuLine(line) {
  const idx = line.indexOf(" - ");
  if (idx === -1) return null;
  const namePart = line.slice(0, idx).trim();
  const restTokens = line.slice(idx + 3).split(/[\s-]+/).map(normalizeToken).filter(Boolean);
  if (!restTokens.includes("hors")) return null;

  let grade = null;
  if (restTokens.includes("senior") || restTokens.includes("seniors")) grade = "senior";
  else if (restTokens.includes("interne") || restTokens.includes("internes")) grade = "interne";

  const specialite = restTokens.map((t) => SPECIALITE_ALIASES[t]).find((s) => s && s !== "__socle__") || null;

  return { namePart, grade, specialite };
}

// Découpe un nom brut au format ARI (voir aussi ariNameTokenSet() dans la section import ARI) en
// {prenom, nom} -- nécessaire ici (contrairement à l'import ARI) car on CRÉE une nouvelle personne,
// pas juste une comparaison insensible à l'ordre. Heuristique en 3 temps, du plus fiable au moins
// fiable :
// 1. Un seul mot (ex. "Sassoui-Abdelhakim") : coupé sur le tiret si possible (mieux qu'un prénom
//    vide, qui casserait l'affichage -- ex. person.prenom[0] -- un peu partout dans l'appli).
// 2. Au moins un mot TOUT EN MAJUSCULES : c'est le nom de famille (ARI écrit indifféremment
//    "NOM Prénom" ou "Prénom NOM"), le reste = prénom.
// 3. Aucune casse distinctive (ex. "Sajust de Bergues de Escalup Aurore") : le dernier mot = prénom
//    (cas réel confirmé), le reste = nom -- convention la plus fréquente pour un nom de famille
//    composé avec particule.
function splitAriStyleName(namePart) {
  const tokens = namePart.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const hyphenParts = tokens[0].split("-");
    if (hyphenParts.length >= 2) {
      return { prenom: hyphenParts[0], nom: hyphenParts.slice(1).join("-") };
    }
    return { prenom: tokens[0], nom: tokens[0] };
  }
  const isAllCaps = (t) => t === t.toUpperCase() && t !== t.toLowerCase();
  const capsTokens = tokens.filter(isAllCaps);
  const normalTokens = tokens.filter((t) => !isAllCaps(t));
  if (capsTokens.length > 0 && normalTokens.length > 0) {
    return { nom: capsTokens.join(" "), prenom: normalTokens.join(" ") };
  }
  return { prenom: tokens[tokens.length - 1], nom: tokens.slice(0, -1).join(" ") };
}

// Analyse le texte collé et renvoie { results, ignored }. results = personnes détectées, avec un
// flag "duplicate" si quelqu'un du même nom existe déjà (pour ne pas le recréer par mégarde).
function parseBulkStaffText(text) {
  const lines = text.split(/\r?\n/);
  let currentGrade = null;
  let currentSpecialites = null;
  const results = [];
  const ignored = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const grade = matchGradeHeader(line);
    if (grade) {
      currentGrade = grade;
      currentSpecialites = null;
      return;
    }

    const specs = matchSpecialiteHeader(line);
    if (specs !== null) {
      currentSpecialites = specs;
      return;
    }

    // RG-016 : ligne "Hors Sisu" auto-suffisante -- indépendante de currentGrade/currentSpecialites,
    // reconnue même sans en-tête "Seniors"/"Internes" au-dessus (voir matchHorsSisuLine()).
    const horsSisuMatch = matchHorsSisuLine(line);
    if (horsSisuMatch) {
      const { prenom, nom } = splitAriStyleName(horsSisuMatch.namePart);
      const specialites = horsSisuMatch.specialite ? [horsSisuMatch.specialite] : [];
      const duplicate = state.staff.some(
        (p) => normalizeToken(p.prenom) === normalizeToken(prenom) && normalizeToken(p.nom) === normalizeToken(nom)
      );
      results.push({ prenom, nom, grade: horsSisuMatch.grade, specialites, horsSisu: true, duplicate, include: !duplicate });
      return;
    }

    if (!currentGrade) {
      ignored.push(rawLine);
      return;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      ignored.push(rawLine);
      return;
    }

    const prenom = tokens[0];
    const nom = tokens[1];
    const specialites = currentSpecialites !== null ? currentSpecialites : [];
    const duplicate = state.staff.some(
      (p) => normalizeToken(p.prenom) === normalizeToken(prenom) && normalizeToken(p.nom) === normalizeToken(nom)
    );

    results.push({ prenom, nom, grade: currentGrade, specialites, duplicate, include: !duplicate });
  });

  return { results, ignored };
}

function orderedSpecialites(person) {
  return [...(person.specialites || [])].sort(
    (a, b) => SPECIALITE_ORDER.indexOf(a) - SPECIALITE_ORDER.indexOf(b)
  );
}

// Clé de regroupement : "socle" pour les internes sans spécialité, sinon "digestif-uro" etc.
function specialiteKey(person) {
  const specs = orderedSpecialites(person);
  return specs.length ? specs.join("-") : "socle";
}

// Départage alphabétique par NOM de famille en priorité (pas le prénom -- changé le 22/07/2026 sur
// demande explicite de Samir), prénom en second recours si même nom.
function compareNomPrenom(personA, personB) {
  const byNom = personA.nom.localeCompare(personB.nom, "fr");
  return byNom !== 0 ? byNom : personA.prenom.localeCompare(personB.prenom, "fr");
}

// Trie les personnes pour que tous les mêmes profils de spécialité(s) soient les uns sous les
// autres, dans l'ordre canonique des spécialités. Les socles (0 spécialité) sont relégués en dernier.
// À profil de spécialité(s) égal, on départage par ordre alphabétique du nom de famille.
function compareSpecialiteKeys(personA, personB) {
  const a = orderedSpecialites(personA);
  const b = orderedSpecialites(personB);
  if (a.length === 0 && b.length === 0) return compareNomPrenom(personA, personB);
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] !== undefined ? SPECIALITE_ORDER.indexOf(a[i]) : -1;
    const bi = b[i] !== undefined ? SPECIALITE_ORDER.indexOf(b[i]) : -1;
    if (ai !== bi) return ai - bi;
  }
  return compareNomPrenom(personA, personB);
}

// Même tri que le panneau Personnel : grade d'abord (séniors avant internes), puis regroupé par
// profil de spécialité(s) dans l'ordre canonique (voir compareSpecialiteKeys -- socle toujours en
// dernier), alphabétique par prénom au sein d'un même groupe. Réutilisé tel quel par la vue
// Personnel du planning principal (renderPersonnelRows()) depuis le 22/07/2026 -- Samir veut
// "sensiblement la même chose que la vue personnel à droite", pas un tri par nom de famille séparé
// (un premier jet allait dans ce sens le même jour, retiré aussitôt corrigé).
function compareStaffOrder(personA, personB) {
  // RG-016 (23/07/2026) : les personnes "Hors Sisu" passent toujours tout en bas, triées entre
  // elles par ordre alphabétique pur (nom puis prénom) -- pas de regroupement par grade/spécialité,
  // qu'elles n'ont pas forcément (voir regles-gestion.md).
  if (!!personA.horsSisu !== !!personB.horsSisu) return personA.horsSisu ? 1 : -1;
  if (personA.horsSisu) return compareNomPrenom(personA, personB);
  if (personA.grade !== personB.grade) return personA.grade === "senior" ? -1 : 1;
  return compareSpecialiteKeys(personA, personB);
}

// Rendu d'une ligne de la liste déroulante personnalisée : fond coloré plein pour sénior/socle
// (une seule couleur possible), fond blanc + abréviations des 2 spés entre parenthèses pour
// les internes à double spécialité (pas de fond bicolore net possible sans dégradé).
function personOptionRow(person) {
  const specs = orderedSpecialites(person);
  if (specs.length === 2) {
    const abbrevs = specs
      .map((s) => `<span style="color:${SPECIALITES[s].text};">${SPECIALITES[s].abbrev}</span>`)
      .join(", ");
    return { html: `${person.prenom} ${person.nom} (${abbrevs})`, style: "background-color:#ffffff;color:#1f2937;" };
  }
  if (specs.length === 1) {
    const c = SPECIALITES[specs[0]];
    return { html: `${person.prenom} ${person.nom}`, style: `background-color:${c.bg};color:${c.text};` };
  }
  return { html: `${person.prenom} ${person.nom}`, style: "background-color:#f1f5f9;color:#334155;" };
}

// État (non persisté) des blocs repliés/dépliés dans le panneau Personnel.
const staffPanelCollapsed = {
  seniors: false,
  internes: false,
  internesSpecialises: false,
  internesSocle: false,
  horsSisu: false,
};

// Vue du tableau principal : "modalite" (lignes = vacations, défaut) ou "personnel"
// (lignes = personnel, on y voit où chacun est posté). Bascule via le bouton d'en-tête.
let currentView = "modalite";

// Mode "Trame" (24/07/2026, remplace l'ancien bouton "Spécialités Vacations" isolé -- déplacé à
// côté d'"Aujourd'hui" dans la topbar, voir index.html) : regroupe 2 sous-vues structurelles
// (indépendantes de la semaine affichée) sous un même mode plein-écran, mutuellement exclusif avec
// Congés/Stats comme avant -- editingTrame joue exactement le rôle qu'avait editingVacationSpecs
// seul jusqu'ici. trameView choisit la sous-vue affichée : "specs" = ancienne vue "Spécialités
// Vacations" (comportement inchangé), "personnel" = nouvelle "Trame Personnel" (RG-017, planning de
// base récurrent, voir renderTramePersonnelView() plus bas). Non persisté (comme currentView).
let editingTrame = false;
let trameView = "personnel"; // "specs" | "personnel" -- "personnel" par défaut à l'ouverture (demande de Samir le 24/07/2026)
// Dérivées, recalculées en tête de render() -- gardées comme variables à part (plutôt que
// remplacées partout par `editingTrame && trameView === "specs"`) pour ne pas devoir toucher tout
// le reste du code qui consultait déjà editingVacationSpecs avant l'existence du mode Trame.
let editingVacationSpecs = false;
let editingTramePersonnel = false;

// Vue congés (bouton dédié dans la topbar, mutuellement exclusive avec editingTrame --
// les deux remplacent le contenu principal, voir render()). Trimestre/année affichés, non persistés
// (comme currentView) : on repart du trimestre courant à chaque rechargement.
let editingConges = false;
let congesYear = new Date().getFullYear();
let congesQuarter = currentQuarter(new Date());

// Vue Stats (24/07/2026, bouton dédié) : 3e mode plein-écran, mutuellement exclusif avec
// editingTrame/editingConges (voir render()). Pas d'état de navigation propre -- utilise
// directement la semaine déjà sélectionnée (state.weekOffset) comme le reste de l'appli.
let editingStats = false;

// Focus jour / demi-journée (24/07/2026) : cliquer sur l'en-tête d'un jour (ou d'un créneau précis
// sous ce jour) dans le tableau principal filtre le panneau Personnel (#staffList) pour ne montrer
// que les personnes PRÉSENTES ce jour-là (RG-014 : ni congé ni repos de garde) ET PAS DÉJÀ POSTÉES
// sur ce jour/créneau. `creneauId: null` = jour entier (les 3 créneaux comptent comme "posté" s'ils
// ont ne serait-ce qu'une assignation) ; `creneauId` renseigné = seul ce créneau précis compte.
// Non persisté (comme currentView) -- state transitoire d'UI, remis à zéro au rechargement.
// Un second clic sur exactement la même cible (même day + même creneauId) l'annule -- voir
// toggleStaffFocusFilter().
let staffFocusFilter = null;

// Filtres du panneau Personnel : OR à l'intérieur d'une catégorie, ET entre les deux catégories.
// grades: "senior" | "interne". specialites: "digestif"|"uro"|"gyneco"|"thorax"|"socle".
// Réutilisés tels quels par la vue Congés (colonnes filtrées par les mêmes puces, voir 6.x
// CLAUDE.md) -- volontairement le même state partagé, pas une copie, pour rester cohérent
// entre les deux vues sans dupliquer la logique de filtre.
// showHorsSisu (23/07/2026) : bascule à part, PAS un 3e Set -- sémantique différente des deux
// autres catégories (qui RESTREIGNENT la liste quand actives). Ici, par défaut les personnes
// "Hors Sisu" sont invisibles PARTOUT où personMatchesFilters() fait la loi ; cocher la puce les
// RÉVÈLE en plus du reste, ça ne cache pas les autres. Voir RG-016 (regles-gestion.md).
const staffFilters = {
  grades: new Set(),
  specialites: new Set(),
  showHorsSisu: false,
};

function personMatchesFilters(person) {
  if (person.horsSisu && !staffFilters.showHorsSisu) return false;
  if (staffFilters.grades.size > 0 && !staffFilters.grades.has(person.grade)) return false;
  if (staffFilters.specialites.size > 0) {
    const specs = person.specialites || [];
    const matchesAny = [...staffFilters.specialites].some((token) => {
      if (token === "socle") return specs.length === 0;
      return specs.includes(token);
    });
    if (!matchesAny) return false;
  }
  return true;
}

// Jeu de démo exhaustif : 2 séniors par spécialité, quelques internes socle,
// et 2 internes par combinaison possible de 2 spécialités (les 6 combinaisons de digestif/uro/gyneco/thorax).
// Noms délibérément fictifs (thème Kaamelott, sans rapport avec le vrai personnel du service) --
// ne JAMAIS y mettre de vrais noms : ce fichier est du CODE, potentiellement publié/partagé, alors
// que la vraie liste du service vit uniquement dans state.staff (persisté via le fichier partagé/
// localStorage, jamais dans le code -- voir CLAUDE.md §4/§4.1). Retiré le 22/07/2026 après avoir
// découvert que les noms précédents ("Anne Bernard", "Julien Moreau"...) étaient en réalité ceux de
// vrais médecins du service, glissés ici par erreur -- ne jamais répéter cette confusion.
const DEMO_STAFF = [
  { id: "s1", prenom: "Arthur", nom: "de Bretagne", grade: "senior", specialites: ["digestif"] },
  { id: "s2", prenom: "Léodagan", nom: "de Carmélide", grade: "senior", specialites: ["digestif"] },
  { id: "s3", prenom: "Bohort", nom: "de Bletois", grade: "senior", specialites: ["uro"] },
  { id: "s4", prenom: "Yvain", nom: "de Cornouaille", grade: "senior", specialites: ["uro"] },
  { id: "s5", prenom: "Gauvain", nom: "d'Orcanie", grade: "senior", specialites: ["gyneco"] },
  { id: "s6", prenom: "Calogrenant", nom: "du Lac", grade: "senior", specialites: ["gyneco"] },
  { id: "s7", prenom: "Perceval", nom: "de Galles", grade: "senior", specialites: ["thorax"] },
  { id: "s8", prenom: "Karadoc", nom: "de Vannes", grade: "senior", specialites: ["thorax"] },

  { id: "i1", prenom: "Guethenoc", nom: "de Bretagne", grade: "interne", specialites: [] },
  { id: "i2", prenom: "Sacripant", nom: "de Cornouaille", grade: "interne", specialites: [] },
  { id: "i3", prenom: "Grüdü", nom: "de Bretagne", grade: "interne", specialites: [] },

  { id: "i4", prenom: "Merlin", nom: "Ambrosius", grade: "interne", specialites: ["digestif", "uro"] },
  { id: "i5", prenom: "Elias", nom: "de Kelliwic'h", grade: "interne", specialites: ["digestif", "uro"] },
  { id: "i6", prenom: "Séli", nom: "de Carmélide", grade: "interne", specialites: ["digestif", "gyneco"] },
  { id: "i7", prenom: "Venec", nom: "de Bretagne", grade: "interne", specialites: ["digestif", "gyneco"] },
  { id: "i8", prenom: "Demetra", nom: "de Bretagne", grade: "interne", specialites: ["digestif", "thorax"] },
  { id: "i9", prenom: "Angharad", nom: "de Cornouaille", grade: "interne", specialites: ["digestif", "thorax"] },
  { id: "i10", prenom: "Mevanwi", nom: "de Carmélide", grade: "interne", specialites: ["uro", "gyneco"] },
  { id: "i11", prenom: "Dolman", nom: "de Bretagne", grade: "interne", specialites: ["uro", "gyneco"] },
  { id: "i12", prenom: "Loth", nom: "d'Orcanie", grade: "interne", specialites: ["uro", "thorax"] },
  { id: "i13", prenom: "Bragan", nom: "de Bretagne", grade: "interne", specialites: ["uro", "thorax"] },
  { id: "i14", prenom: "Guenièvre", nom: "de Carmélide", grade: "interne", specialites: ["gyneco", "thorax"] },
  { id: "i15", prenom: "Doxesme", nom: "de Bretagne", grade: "interne", specialites: ["gyneco", "thorax"] },
];

const ACTIVITIES = [
  { id: "scan-u", nom: "Scan U", urgence: true },
  { id: "echo-u", nom: "Echo U", urgence: true },
  { id: "scan-b", nom: "Scan B", group: "scan-start" },
  { id: "scan-a", nom: "Scan A", group: "scan-end" },
  { id: "irm-15t", nom: "IRM 1.5 T", group: "irm-start" },
  { id: "irm-3t", nom: "IRM 3 T", group: "irm-end" },
  { id: "ecn-1", nom: "ECN 1", group: "ecn-start" },
  { id: "ecn-2", nom: "ECN 2", group: "ecn-end" },
  { id: "mammo", nom: "Mammo" },
  { id: "bureau", nom: "Bureau" },
];

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
// RG-012 : "astreinte" est un créneau global (colonne affichée tous les jours, pour toutes les
// activités) mais dont l'usage réel est réservé à Scan U -- voir isCreneauApplicable() ci-dessous.
// Ajouté comme 3e créneau plutôt que rowspan/colspan sur mesure pour garder le tableau simple
// (mêmes lignes/colonnes pour toutes les modalités, cases "non applicables" grisées ailleurs).
const CRENEAUX = [
  { id: "matin", label: "Matin" },
  { id: "astreinte", label: "Astreinte" },
  { id: "apres-midi", label: "Après-midi" },
];

// Seule Scan U utilise le créneau "astreinte" ; pour toute autre activité, cette case n'existe pas
// fonctionnellement (pas d'assignation, pas de spécialité/fermeture) -- voir regles-gestion.md RG-012.
function isCreneauApplicable(activityId, creneauId) {
  return creneauId !== "astreinte" || activityId === "scan-u";
}

const STORAGE_KEY = "planningAppState_v3";

// ---------- État ----------

// Le fichier partagé (voir section "Fichier partagé" plus bas) devient la donnée de PRODUCTION à
// partir du 22/07/2026, plus une donnée de dev jetable comme l'était le localStorage jusqu'ici (le
// renommage de clé _v1 -> _v2 -> _v3 se contentait de tout jeter à chaque refonte de structure, ce
// qui n'est plus acceptable une fois que de vraies données de service sont en jeu). Toute évolution
// future de la structure de state doit donc passer par une entrée de STATE_MIGRATIONS plutôt que de
// casser silencieusement les fichiers déjà écrits sur le drive ou déjà exportés en JSON.
const STATE_SCHEMA_VERSION = 2;

// Clé = version de départ, valeur = fonction qui transforme les données de cette version vers la
// version suivante (N -> N+1, jamais un saut direct). migrateState() les enchaîne jusqu'à
// STATE_SCHEMA_VERSION. Un fichier/export sans `schemaVersion` du tout (tout ce qui existait avant
// ce système) est traité comme version 0.
const STATE_MIGRATIONS = {
  // 0 -> 1 : introduction du champ schemaVersion lui-même -- aucune autre transformation de
  // structure n'est nécessaire, les champs listés dans PERSISTED_KEYS n'ont pas changé de forme.
  0: (data) => data,
  // 1 -> 2 : ajout de `trame` (RG-017, Trame Personnel, 24/07/2026) -- un nouveau champ, pas un
  // changement de forme d'un champ existant, mais on suit quand même la politique de migration
  // pour qu'un vieux fichier sans `trame` du tout reparte sur un objet vide plutôt que `undefined`.
  1: (data) => ({ ...data, trame: data.trame || {} }),
};

function migrateState(rawData) {
  let data = rawData;
  let version = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;
  // Fichier écrit par une version FUTURE de l'appli (schemaVersion supérieure à ce que ce code sait
  // lire) -- sans ce garde-fou, la boucle ci-dessous ne s'exécute simplement pas et retournerait les
  // données telles quelles avec un schemaVersion RÉTROGRADÉ à STATE_SCHEMA_VERSION, masquant le
  // problème au lieu de le signaler (bug réel trouvé en testant le 22/07/2026). Refuser explicitement
  // plutôt que de charger des données dont la forme n'est pas garantie compatible avec ce code.
  if (version > STATE_SCHEMA_VERSION) {
    throw new Error(`Ce fichier a été enregistré par une version plus récente de l'application (schéma v${version}, cette version ne connaît que jusqu'à v${STATE_SCHEMA_VERSION}). Mets à jour l'application avant de l'ouvrir.`);
  }
  while (version < STATE_SCHEMA_VERSION) {
    const migrate = STATE_MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`Migration manquante pour passer de la version ${version} à la suivante -- fichier corrompu ou trop récent (généré par une version future de l'appli) ?`);
    }
    data = migrate(data);
    version += 1;
  }
  return { ...data, schemaVersion: STATE_SCHEMA_VERSION };
}

// Liste unique des champs réellement persistés (fichier partagé, cache localStorage ET export/import
// JSON manuels -- un seul endroit à mettre à jour si un nouveau champ de state doit être persisté,
// pour ne jamais en oublier un dans l'un des trois chemins). Délibérément SANS `activities` (piloté
// par le code, jamais par des données utilisateur -- voir CLAUDE.md §4) ni `schemaVersion` (ajouté à
// part par buildPersistedState()).
const PERSISTED_KEYS = ["staff", "assignments", "vacationSpecialites", "fermetures", "conges", "gardes", "trame", "weekOffset"];

function buildPersistedState() {
  const data = { schemaVersion: STATE_SCHEMA_VERSION };
  PERSISTED_KEYS.forEach((key) => { data[key] = state[key]; });
  return data;
}

// Applique un objet de données (fichier partagé, localStorage, ou import JSON manuel) au state en
// mémoire, après migration. Ne touche jamais state.activities, quoi que contienne rawData.
function applyPersistedState(rawData) {
  const data = migrateState(rawData);
  state.assignments = data.assignments || {};
  state.weekOffset = data.weekOffset || 0;
  state.vacationSpecialites = data.vacationSpecialites || {};
  state.fermetures = data.fermetures || {};
  state.conges = Array.isArray(data.conges) ? data.conges : [];
  state.gardes = Array.isArray(data.gardes) ? data.gardes : [];
  state.trame = data.trame || {};
  if (Array.isArray(data.staff) && data.staff.length > 0) {
    state.staff = data.staff;
  }
}

let state = {
  staff: DEMO_STAFF,
  activities: ACTIVITIES,
  assignments: {}, // key: `${weekKey}|${activityId}|${day}|${creneauId}` -> [staffId, ...]
  // Spécialité "propriétaire" d'une vacation (ex. Scan B le mardi matin = Gynéco), indépendante de
  // la semaine (structurel, change rarement) -> clé SANS le weekKey, voir vacationSpecKey().
  vacationSpecialites: {}, // key: `${activityId}|${day}|${creneauId}` -> "digestif"|"uro"|"gyneco"|"thorax"|"os"
  // Fermeture d'une vacation : à l'inverse de vacationSpecialites, c'est HEBDOMADAIRE (clé AVEC
  // weekKey, via cellKey() comme assignments) -- une vacation fermée cette semaine peut rouvrir la
  // semaine suivante sans rien reconfigurer. Bloque l'assignation (voir RG-010 dans regles-gestion.md).
  fermetures: {}, // key: cellKey(activityId, day, creneauId) -> true
  // Congés déclarés : données personnelles structurelles (comme staff/vacationSpecialites),
  // indépendantes de la semaine affichée -- voir 4.7 dans CLAUDE.md et quarterWeeks() plus bas.
  conges: [], // { id, staffId, dateDebut: "YYYY-MM-DD", dateFin: "YYYY-MM-DD" }
  // Gardes déclarées : structurelles comme conges (voir 4.8 dans CLAUDE.md), mais toujours un seul
  // jour (pas de notion de plage) -- pas encore exploitées par le moteur de validation, prévues
  // pour de futures RG (22/07/2026).
  gardes: [], // { id, staffId, date: "YYYY-MM-DD" }
  // Trame Personnel (RG-017, 24/07/2026) : planning de BASE récurrent d'une personne, structurel
  // comme vacationSpecialites (clé SANS weekKey, voir trameKey()) -- pas une semaine réelle, un
  // modèle qui sert de valeur par défaut pour la semaine actuelle et les semaines futures tant
  // qu'elles n'ont pas été explicitement modifiées cellule par cellule (voir effectiveAssignedIds()).
  trame: {}, // key: `${activityId}|${day}|${creneauId}` -> [staffId, ...]
  weekOffset: 0,
};

function loadState() {
  // Cache de démarrage rapide + filet de secours si aucun jeton GitHub n'est encore connecté
  // (voir tryAutoConnectGitHub() plus bas) -- plus jamais la source de vérité une fois connecté.
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      applyPersistedState(JSON.parse(raw));
    } catch (e) {
      console.warn("Impossible de charger l'état sauvegardé, utilisation des données de démo.", e);
    }
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistedState()));
  scheduleFileSave();
}

// ---------- Synchro GitHub (23/07/2026, remplace le fichier sur drive) ----------
// Remplace le localStorage comme SOURCE DE VÉRITÉ : les données vivent dans un fichier JSON du
// dépôt PRIVÉ planning-imagerie-data, lu/écrit directement via l'API GitHub (pas de File System
// Access API, pas de fichier local, pas de limite Chrome-only -- fonctionne sur tout navigateur).
// Le localStorage reste en place comme cache de démarrage rapide + filet de secours si aucun jeton
// n'est encore renseigné -- jamais comme source de vérité une fois connecté.
//
// Le jeton d'accès (PAT) n'est JAMAIS écrit dans ce fichier (qui est publié publiquement sur
// GitHub Pages) : l'utilisateur le colle une fois dans la modale, stocké uniquement dans le
// localStorage de son navigateur. Un jeton fine-grained scope au SEUL dépôt privé, permission
// "Contents: Read and write", limite le risque en cas de fuite.

const GITHUB_OWNER = "PlanningSisu";
const GITHUB_REPO = "planning-imagerie-data";
const GITHUB_FILE_PATH = "planning-imagerie.json";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN_KEY = "planningAppGitHubToken";

let githubFileSha = null; // sha du blob actuellement connu -- exigé par l'API pour toute écriture (évite d'écraser une modif faite ailleurs entre-temps).
let fileWriteTimer = null;
let fileWriteInFlight = false;
let fileWritePending = false; // une modif est arrivée PENDANT une écriture déjà en cours -- à rejouer une fois celle-ci terminée.
// Bug réel remonté par Samir le 24/07/2026 : "Réinitialiser le planning" (ou toute action utilisant
// confirm()) faisait réapparaître les affectations juste effacées. Cause -- confirm()/alert() sont
// des dialogues natifs qui déclenchent un blur/focus de la fenêtre ; l'événement "focus" (voir plus
// bas) ne peut s'exécuter qu'une fois le code synchrone du clic terminé (JS mono-thread), donc APRÈS
// que saveState() ait DÉJÀ programmé une écriture différée de 400ms (scheduleFileSave()) -- mais
// fileWriteInFlight/fileWritePending sont encore tous les deux `false` à ce moment précis (l'écriture
// n'a pas encore DÉMARRÉ). Le focus déclenchait donc un reloadFromGitHub() qui relisait l'ANCIEN
// contenu (pas encore écrasé par notre reset, toujours dans les 400ms d'attente) et l'appliquait
// par-dessus l'état tout juste réinitialisé. `hasUnflushedChange` comble ce trou : positionné de
// façon SYNCHRONE dès qu'un changement est programmé (avant que le focus différé ait pu s'exécuter),
// et retiré seulement après une écriture réussie ET sans changement plus récent en attente derrière.
let hasUnflushedChange = false;
let fileSyncStatus = "disconnected"; // "disconnected" | "ok" | "saving" | "error" | "invalid-token" | "conflict"

function getGitHubToken() {
  return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
}

function setGitHubToken(token) {
  localStorage.setItem(GITHUB_TOKEN_KEY, token);
}

function clearGitHubToken() {
  localStorage.removeItem(GITHUB_TOKEN_KEY);
}

// L'API GitHub encode le contenu en base64 -- atob()/btoa() seuls ne gèrent que du Latin1, pas
// l'UTF-8 (accents des noms de famille, ex. "Léodagan") -- passer par TextEncoder/TextDecoder pour
// un aller-retour fidèle.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function githubContentsRequest(method, body) {
  const token = getGitHubToken();
  return fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function readStateFromGitHub() {
  const res = await githubContentsRequest("GET");
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Jeton invalide ou sans accès à ce dépôt."), { code: "invalid-token" });
  if (!res.ok) throw new Error(`Lecture impossible (HTTP ${res.status}).`);
  const data = await res.json();
  githubFileSha = data.sha;
  return JSON.parse(base64ToUtf8(data.content));
}

async function writeStateToGitHub() {
  const body = {
    message: `Mise à jour du planning (${new Date().toISOString()})`,
    content: utf8ToBase64(JSON.stringify(buildPersistedState(), null, 2)),
    branch: GITHUB_BRANCH,
  };
  if (githubFileSha) body.sha = githubFileSha;
  const res = await githubContentsRequest("PUT", body);
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Jeton invalide ou sans accès à ce dépôt."), { code: "invalid-token" });
  if (res.status === 409) throw Object.assign(new Error("Le fichier a été modifié ailleurs entre-temps."), { code: "conflict" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Écriture impossible (HTTP ${res.status}).`);
  }
  const data = await res.json();
  githubFileSha = data.content.sha;
}

function fileSyncStatusLabel() {
  switch (fileSyncStatus) {
    case "ok": return "à jour";
    case "saving": return "enregistrement...";
    case "error": return "erreur d'enregistrement";
    case "invalid-token": return "jeton invalide";
    case "conflict": return "conflit -- recharger";
    default: return "non connecté";
  }
}

// Libellé court pour la pastille de la topbar (24/07/2026, demande de Samir : "Synchro :
// erreur d'enregistrement" prenait trop de place). fileSyncStatusLabel() reste la version complète
// -- utilisée dans la modale "Synchro GitHub" (`Statut : ...`), qui n'a pas cette contrainte de place.
function fileSyncStatusShortLabel() {
  switch (fileSyncStatus) {
    case "ok": return "À jour";
    case "saving": return "Enregistrement";
    case "error": return "Erreur";
    case "invalid-token": return "Jeton invalide";
    case "conflict": return "Conflit";
    default: return "Non connecté";
  }
}

function setFileSyncStatus(status) {
  fileSyncStatus = status;
  const el = document.getElementById("fileSyncStatus");
  if (!el) return;
  el.textContent = fileSyncStatusShortLabel();
  // Le préfixe "Synchro" a disparu du texte visible (trop long) mais reste accessible au survol,
  // avec le libellé complet -- pour ne pas perdre le contexte "c'est le statut de synchro GitHub".
  el.title = `Synchro GitHub : ${fileSyncStatusLabel()}`;
  el.className = "file-sync-status file-sync-" + status;
}

// Debounce (~400ms après la dernière modif) pour ne pas écrire à chaque action individuelle, +
// garde fileWriteInFlight/fileWritePending pour ne jamais avoir deux écritures concurrentes (une
// modif arrivant pendant une écriture en cours est rejouée juste après, jamais perdue).
function scheduleFileSave() {
  if (!getGitHubToken()) return; // pas connecté -- localStorage seul, rien à faire ici.
  hasUnflushedChange = true; // positionné en synchrone, avant même le délai de 400ms -- voir plus haut.
  clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(flushFileSave, 400);
}

async function flushFileSave() {
  if (!getGitHubToken()) return;
  if (fileWriteInFlight) {
    fileWritePending = true;
    return;
  }
  fileWriteInFlight = true;
  setFileSyncStatus("saving");
  try {
    await writeStateToGitHub();
    setFileSyncStatus("ok");
    // Ne retire le "changement non sauvegardé" que si rien de plus récent n'attend déjà derrière
    // (sinon la relance juste en dessous s'en chargera à SA propre réussite).
    if (!fileWritePending) hasUnflushedChange = false;
  } catch (err) {
    console.error("Échec de l'écriture vers GitHub :", err);
    setFileSyncStatus(err.code || "error");
    // hasUnflushedChange reste `true` : l'échec laisse un changement local toujours pas persisté,
    // un rechargement au focus ne doit surtout pas l'écraser avec l'ancien contenu.
  } finally {
    fileWriteInFlight = false;
    if (fileWritePending) {
      fileWritePending = false;
      flushFileSave();
    }
  }
}

// Connexion initiale : valide le jeton en tentant une lecture, puis remplace le state en mémoire
// par le contenu du dépôt -- ne JAMAIS écrire avant d'avoir lu, pour ne jamais écraser une version
// plus récente posée par un autre poste avant même de l'avoir consultée. Se nettoie elle-même en
// cas d'échec (retire le jeton invalide) plutôt que de compter sur l'appelant pour le faire.
async function connectGitHubToken(token) {
  setGitHubToken(token);
  try {
    const data = await readStateFromGitHub();
    applyPersistedState(data);
    setFileSyncStatus("ok");
    render();
  } catch (e) {
    clearGitHubToken();
    setFileSyncStatus("disconnected");
    throw e;
  }
}

function disconnectGitHub() {
  clearGitHubToken();
  githubFileSha = null;
  setFileSyncStatus("disconnected");
}

// Relit le contenu GitHub et remplace le state en mémoire -- pur rechargement, n'écrit jamais.
// Utilisé au démarrage (tryAutoConnectGitHub()), par le bouton "Recharger" de la modale, et
// automatiquement quand l'onglet reprend le focus (voir plus bas).
async function reloadFromGitHub() {
  if (!getGitHubToken()) return;
  const data = await readStateFromGitHub();
  applyPersistedState(data);
  render();
}

// Au démarrage : si un jeton a été enregistré lors d'une session précédente, tente une lecture
// silencieuse -- contrairement à l'ancien système de fichier local, aucun geste utilisateur n'est
// nécessaire ici (un simple jeton HTTP, pas une permission de navigateur), donc ça peut se faire
// automatiquement au chargement de la page, sans clic.
async function tryAutoConnectGitHub() {
  if (!getGitHubToken()) return;
  try {
    const data = await readStateFromGitHub();
    applyPersistedState(data);
    setFileSyncStatus("ok");
    render();
  } catch (e) {
    console.error("Impossible de lire le planning depuis GitHub.", e);
    setFileSyncStatus(e.code || "error");
  }
}

// Re-tente une lecture silencieuse quand l'onglet reprend le focus -- utile si l'autre poste a
// modifié le fichier pendant que cet onglet restait ouvert en arrière-plan. Ignoré si une écriture
// locale est en cours/en attente/programmée (hasUnflushedChange, voir sa déclaration plus haut --
// bug réel corrigé le 24/07/2026 : confirm()/alert() déclenchent un focus dont le traitement était
// jusque-là plus rapide que le début effectif de l'écriture différée de 400ms).
window.addEventListener("focus", () => {
  if (!getGitHubToken() || fileWriteInFlight || fileWritePending || hasUnflushedChange) return;
  reloadFromGitHub().catch((e) => console.warn("Rechargement au focus impossible.", e));
});

function openFileSyncModal() {
  document.getElementById("fileSyncModal").classList.remove("hidden");
  renderFileSyncModal();
}

function closeFileSyncModal() {
  document.getElementById("fileSyncModal").classList.add("hidden");
}

// Formulaire de saisie du jeton, réutilisé pour la première connexion ET pour le cas "jeton
// invalide" (23/07/2026) -- avant cette factorisation, un jeton expiré/révoqué affichait quand même
// l'écran "Connecté" (basé uniquement sur la présence d'un jeton en storage, pas sur sa validité
// réelle), ce qui était trompeur : impossible de recoller un nouveau jeton sans d'abord cliquer
// "Déconnecter". Le message affiché est le seul élément qui change entre les deux cas.
function renderTokenForm(body, message) {
  body.innerHTML = `
    <p>${message}</p>
    <input type="password" id="githubTokenInput" placeholder="github_pat_..." style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid var(--border);font-size:13px;margin-bottom:10px;">
    <button type="button" id="btnConnectGitHub" class="btn-primary">Connecter</button>
  `;
  document.getElementById("btnConnectGitHub").addEventListener("click", async () => {
    const input = document.getElementById("githubTokenInput");
    const token = input.value.trim();
    if (!token) return;
    try {
      await connectGitHubToken(token);
    } catch (e) {
      alert("Connexion impossible : " + e.message);
    }
    renderFileSyncModal();
  });
}

function renderFileSyncModal() {
  const body = document.getElementById("fileSyncModalBody");
  const hasToken = !!getGitHubToken();

  if (hasToken && fileSyncStatus === "invalid-token") {
    renderTokenForm(body, `Le jeton enregistré ne fonctionne plus (expiré ou révoqué) -- colle-en un nouveau pour reconnecter le dépôt <strong>${GITHUB_REPO}</strong>.`);
    return;
  }

  if (hasToken) {
    body.innerHTML = `
      <p>Connecté au dépôt <strong>${GITHUB_OWNER}/${GITHUB_REPO}</strong>.</p>
      <p>Statut : ${fileSyncStatusLabel()}</p>
      <button type="button" id="btnReloadFile" class="btn-primary btn-outline">Recharger depuis GitHub</button>
      <button type="button" id="btnDisconnectFile" class="btn-primary btn-outline">Déconnecter (retirer le jeton)</button>
    `;
    document.getElementById("btnReloadFile").addEventListener("click", async () => {
      try {
        await reloadFromGitHub();
        setFileSyncStatus("ok");
      } catch (e) {
        setFileSyncStatus(e.code || "error");
        alert("Impossible de recharger : " + e.message);
      }
      renderFileSyncModal();
    });
    document.getElementById("btnDisconnectFile").addEventListener("click", () => {
      disconnectGitHub();
      renderFileSyncModal();
    });
    return;
  }

  renderTokenForm(body, `Colle ici ton jeton d'accès personnel GitHub (fine-grained, limité au dépôt <strong>${GITHUB_REPO}</strong>, permission "Contents: Read and write"). Il reste uniquement dans ce navigateur, jamais dans le code de l'appli.`);
}

// ---------- Semaine ----------

function getMonday(offsetWeeks) {
  const now = new Date();
  const day = now.getDay(); // 0 = dimanche
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
  return monday;
}

function formatShort(d) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function weekKey(monday) {
  return monday.toISOString().slice(0, 10);
}

function currentWeekLabel() {
  const monday = getMonday(state.weekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return `Semaine du ${formatShort(monday)} au ${formatShort(friday)}`;
}

function cellKey(activityId, day, creneauId) {
  const wk = weekKey(getMonday(state.weekOffset));
  return `${wk}|${activityId}|${day}|${creneauId}`;
}

// Pas de weekKey ici : une spécialité de vacation est structurelle, la même toutes les semaines.
function vacationSpecKey(activityId, day, creneauId) {
  return `${activityId}|${day}|${creneauId}`;
}

// RG-017 (24/07/2026, voir regles-gestion.md) : clé de state.trame -- même forme que
// vacationSpecKey() (pas de weekKey, structurel). Pas de fonction dédiée séparée : la trame et la
// spécialité de vacation partagent exactement la même forme de clé, on réutilise vacationSpecKey()
// directement pour ne pas dupliquer une fonction identique sous un autre nom.
const trameKey = vacationSpecKey;

// Une cellKey() est `${weekKey}|${activityId}|${day}|${creneauId}` -- on retire juste le 1er
// segment (le weekKey, toujours une seule date ISO sans "|") pour retomber sur le format
// `${activityId}|${day}|${creneauId}` de trameKey()/vacationSpecKey(), sans reconstruire la clé
// depuis des paramètres séparés que l'appelant n'a pas forcément sous la main.
function trameKeyFromCellKey(key) {
  return key.split("|").slice(1).join("|");
}

// RG-017 : le contenu réellement affiché/utilisé pour une case (activité×jour×créneau) de la
// semaine ACTUELLEMENT AFFICHÉE (state.weekOffset). Si cette case précise a déjà une affectation
// explicite pour cette semaine (même un tableau vide -- une case vidée à la main reste "touchée"),
// elle prime toujours. Sinon, pour la semaine actuelle ou une semaine future (jamais une semaine
// passée), on retombe sur le planning de base (state.trame) -- une semaine passée jamais remplie
// reste vide, la trame ne comble que ce qui est à venir. Point d'entrée UNIQUE pour lire une
// affectation "effective" : ne jamais relire state.assignments[key] directement ailleurs, sous
// peine de désynchroniser l'affichage (qui montrerait la trame) de la validation/des stats (qui ne
// la compteraient pas), ou l'inverse.
function effectiveAssignedIds(key) {
  if (Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    return state.assignments[key];
  }
  if (state.weekOffset >= 0) {
    return state.trame[trameKeyFromCellKey(key)] || [];
  }
  return [];
}

// RG-017 : avant toute mutation d'une case pour la semaine affichée (ajout/retrait), on s'assure
// qu'elle a une entrée EXPLICITE dans state.assignments -- copiée depuis effectiveAssignedIds()
// (donc depuis la trame si c'est de là que venait le contenu affiché jusque-là) si elle n'en avait
// pas encore. C'est ce qui "découple" une case précise d'une semaine précise de la trame dès qu'on
// y touche : les autres semaines/cases continuent de suivre la trame normalement. Renvoie le
// tableau (la référence dans state.assignments, pas une copie) pour que l'appelant puisse le
// modifier en place (push/filter puis réassigner).
function ensureMaterializedAssignments(key) {
  if (!Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    state.assignments[key] = effectiveAssignedIds(key).slice();
  }
  return state.assignments[key];
}

// ---------- Congés ----------
// Contrairement à assignments/fermetures, les congés ne sont pas rattachés à la "semaine affichée"
// (state.weekOffset) : ils vivent dans leur propre navigation trimestre/année (congesYear/congesQuarter).

// Format "YYYY-MM-DD" en heure LOCALE (contrairement à weekKey() qui passe par toISOString() donc
// UTC -- volontairement différent ici pour éviter tout décalage d'un jour selon le fuseau horaire,
// vu qu'on compare ces dates à des <input type="date"> qui raisonnent aussi en local).
function toISODateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentQuarter(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

// Liste des lundis de toutes les semaines qui touchent le trimestre donné (semaines à cheval sur
// deux trimestres incluses des deux côtés -- comportement volontaire, pas de semaine "perdue").
function quarterWeeks(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const quarterStart = new Date(year, startMonth, 1);
  const quarterEnd = new Date(year, startMonth + 3, 0); // dernier jour du 3e mois du trimestre

  const monday = new Date(quarterStart);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1) - day);

  const weeks = [];
  let cursor = monday;
  while (cursor <= quarterEnd) {
    const friday = new Date(cursor);
    friday.setDate(cursor.getDate() + 4);
    if (friday >= quarterStart) weeks.push(new Date(cursor));
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

// Un enregistrement de congé "couvre" un jour donné si le staffId correspond et que la date tombe
// dans la plage [dateDebut, dateFin] -- comparaison en chaînes "YYYY-MM-DD" (ordre lexicographique
// = ordre chronologique pour des dates ISO zero-paddées, pas besoin de reparser en Date).
function congeCoversDay(conge, staffId, iso) {
  return conge.staffId === staffId && iso >= conge.dateDebut && iso <= conge.dateFin;
}

function isOnCongeDay(staffId, iso) {
  return state.conges.some((c) => congeCoversDay(c, staffId, iso));
}

// Dates ISO des 5 jours ouvrés de la semaine `monday`, dans l'ordre de DAYS.
function weekIsoDates(monday) {
  return DAYS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toISODateLocal(d);
  });
}

// Indices (0=Lundi..4=Vendredi, voir DAYS) des jours ouvrés de la semaine `monday` couverts par
// un congé de `staffId`.
function coveredDaysForWeek(staffId, monday) {
  return weekIsoDates(monday)
    .map((iso, i) => (isOnCongeDay(staffId, iso) ? i : -1))
    .filter((i) => i !== -1);
}

// Décale une date ISO "YYYY-MM-DD" de `delta` jours (peut être négatif), en restant en LOCAL
// (comme toISODateLocal()) pour éviter tout décalage de fuseau horaire.
function isoAddDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return toISODateLocal(date);
}

// Ajoute un jour de congé isolé pour `staffId` (popover de la vue Congés, boutons jour par jour --
// voir renderCongePopoverContent()). Un jour déjà couvert (par ce nouvel enregistrement ou un
// ancien, ex. une plage saisie à l'ancienne) n'est pas dupliqué.
function addCongeDay(staffId, iso) {
  if (isOnCongeDay(staffId, iso)) return;
  state.conges.push({ id: generateId(), staffId, dateDebut: iso, dateFin: iso });
}

// Retire un jour de congé pour `staffId`. Doit gérer le cas où ce jour fait partie d'une plage
// plus large (ex. une semaine entière ajoutée via le bouton "Toute la semaine", ou une ancienne
// plage saisie manuellement avant ce popover) : le jour visé est alors découpé hors de la plage
// (raccourcie d'un bout, ou scindée en deux si le jour est strictement à l'intérieur) plutôt que
// de supprimer toute la plage.
function removeCongeDay(staffId, iso) {
  const next = [];
  state.conges.forEach((c) => {
    if (!congeCoversDay(c, staffId, iso)) {
      next.push(c);
      return;
    }
    if (c.dateDebut === iso && c.dateFin === iso) return; // jour isolé -> supprimé entièrement
    if (c.dateDebut === iso) {
      next.push({ ...c, dateDebut: isoAddDays(iso, 1) });
    } else if (c.dateFin === iso) {
      next.push({ ...c, dateFin: isoAddDays(iso, -1) });
    } else {
      next.push({ ...c, dateFin: isoAddDays(iso, -1) });
      next.push({ id: generateId(), staffId, dateDebut: isoAddDays(iso, 1), dateFin: c.dateFin });
    }
  });
  state.conges = next;
}

// Gardes : toujours un seul jour (pas de plage), donc pas besoin de la logique de découpe
// ci-dessus -- ajout/retrait d'un enregistrement unique par jour.
function isOnGardeDay(staffId, iso) {
  return state.gardes.some((g) => g.staffId === staffId && g.date === iso);
}

function toggleGardeDay(staffId, iso) {
  const idx = state.gardes.findIndex((g) => g.staffId === staffId && g.date === iso);
  if (idx >= 0) state.gardes.splice(idx, 1);
  else state.gardes.push({ id: generateId(), staffId, date: iso });
}

// Personnes de garde un jour donné (iso), triées comme le reste de l'appli (compareStaffOrder) --
// utilisé par l'en-tête de jour du planning (renderTable()) pour afficher qui est de garde ce
// jour-là, et par validateGardes() (RG-015) pour la composition attendue.
function gardeStaffForDate(iso) {
  return state.gardes
    .filter((g) => g.date === iso)
    .map((g) => staffById(g.staffId))
    .filter(Boolean)
    .sort(compareStaffOrder);
}

// RG-013 (22/07/2026, voir regles-gestion.md) : le lendemain d'une garde est automatiquement un
// jour de "repos de garde" -- un 3e statut d'absence, distinct du congé, qui ne se déclare JAMAIS
// à la main : il n'existe aucun setter pour lui, il est **entièrement dérivé** de state.gardes à
// la volée. Ça évite tout risque de désynchronisation (retirer une garde fait disparaître son repos
// automatiquement, sans code de nettoyage à écrire/oublier). Traverse une frontière de semaine sans
// souci (comparaison sur des dates ISO absolues, pas des index de colonne) ; si la garde tombe un
// vendredi, le "lendemain" tombe un samedi, jour qui n'existe dans aucune grille de l'appli (DAYS
// s'arrête au vendredi) -- la donnée reste correcte, seulement rien ne l'affiche ce cas-là.
function isOnReposGardeDay(staffId, iso) {
  return isOnGardeDay(staffId, isoAddDays(iso, -1));
}

function coveredReposGardeDaysForWeek(staffId, monday) {
  return weekIsoDates(monday)
    .map((iso, i) => (isOnReposGardeDay(staffId, iso) ? i : -1))
    .filter((i) => i !== -1);
}

// Construit la barre d'absence d'une personne pour une semaine donnée -- factorisé pour être
// identique dans la vue Congés (une case par semaine × personne, renderCongesView()) et dans le
// bandeau congés de la semaine affichée au-dessus du planning (renderWeekCongesBar(), 6.11
// CLAUDE.md). Retourne null si rien à afficher cette semaine-là pour cette personne.
//
// Depuis le 22/07/2026 (retour Samir) : le jour de garde lui-même n'est PLUS affiché ici du tout --
// seuls le congé et son repos de garde automatique (RG-013) comptent comme absence. La garde reste
// déclarable comme avant (popover, voir renderCongePopoverContent()) et continue de générer son
// repos de garde le lendemain, mais `state.gardes` n'entre plus dans le calcul de cette barre.
// Toutes les absences partagent désormais la même couleur rouge (plus de vert "congé plein" ni de
// jaune "congé partiel", voir .conges-day-mark dans style.css) : le seul cas particulier restant
// est purement textuel -- semaine entièrement absente -> une seule marque "Semaine" au lieu d'empiler
// les 5 noms de jour, sur le même principe qu'une case "Lundi"/"Mardi" isolée.
function buildAbsenceBar(person, monday) {
  const congeDays = coveredDaysForWeek(person.id, monday);
  const reposDays = coveredReposGardeDaysForWeek(person.id, monday);
  const absentIdx = [...new Set([...congeDays, ...reposDays])].sort((a, b) => a - b);
  if (absentIdx.length === 0) return null;

  const titleParts = [];
  if (congeDays.length > 0) titleParts.push(`congé : ${formatDayRange(congeDays)}`);
  if (reposDays.length > 0) titleParts.push(`repos de garde : ${formatDayRange(reposDays)}`);

  const bar = document.createElement("div");
  bar.className = "conges-bar conges-mixed";
  bar.title = `${person.prenom} ${person.nom} — ${titleParts.join(", ")}`;

  // Semaine entièrement absente -> une seule marque "Semaine" (même principe qu'une case "Lundi"
  // isolée, juste pour toute la semaine) plutôt que d'empiler les 5 noms de jour. Sinon, une marque
  // par jour couvert, en toutes lettres -- le texte pivoté (writing-mode) essayé le 21/07/2026 était
  // illisible, ne pas y revenir.
  const isFullWeek = absentIdx.length === DAYS.length;
  const labels = isFullWeek ? ["Semaine"] : absentIdx.map((i) => DAYS[i]);
  labels.forEach((label) => {
    const mark = document.createElement("span");
    // Rouge plus soutenu pour "Semaine" que pour un jour isolé (22/07/2026, demandé par Samir) --
    // pour distinguer d'un coup d'œil une absence de toute la semaine d'un simple jour ponctuel.
    mark.className = "conges-day-mark" + (isFullWeek ? " conges-day-mark-week" : "");
    mark.textContent = label;
    bar.appendChild(mark);
  });
  return bar;
}

// Regroupe une liste d'indices de jours ouvrés en texte lisible : un jour seul -> "Jeudi" ;
// une plage contiguë -> "Mardi au jeudi" ; plusieurs blocs -> joints par " et ".
function formatDayRange(dayIndices) {
  const sorted = [...dayIndices].sort((a, b) => a - b);
  const runs = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      runs.push([start, prev]);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? DAYS[a] : `${DAYS[a]} au ${DAYS[b]}`)).join(" et ");
}

// En-tête de colonne de la vue Congés : "P.Nom" (1re lettre du prénom + 6 du nom -- allongé le
// 21/07/2026). Testé en vrai : la largeur des colonnes est en réalité fixée par .conges-cell
// (46px, pour qu'un nom de jour complet tienne dans une case jaune), pas par cette abréviation --
// la raccourcir ne réduit donc PAS le scroll horizontal, inutile d'essayer un ajustement
// dynamique ici (un essai avec fitCongesColumns()/congesNomLetters variable a été fait et retiré :
// scrollWidth restait identique à 2 lettres et à 6). Nom complet dispo via l'attribut title.
const CONGES_NOM_LETTERS = 6;
function personAcronym(person) {
  return `${person.prenom.slice(0, 1)}.${person.nom.slice(0, CONGES_NOM_LETTERS)}`;
}

function generateId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Bandeau congés de la semaine affichée (au-dessus du planning, 22/07/2026) : une colonne par
// personne CONCERNÉE cette semaine uniquement (congé ou repos de garde -- pas la garde elle-même,
// voir buildAbsenceBar() ; pas tout state.staff comme la vue Congés, 6.10) -- pour ne pas polluer
// la vue le reste du temps. Réutilise buildAbsenceBar(), la même fonction que
// la vue Congés (renderCongesView()), pour un rendu strictement identique entre les deux (demandé
// le 22/07/2026 : "de la même manière que sur le calendrier des congés"). Cliquer une case ouvre le
// même popover que la vue Congés (openCongePopover()), sur la semaine actuellement affichée
// (state.weekOffset).
function renderWeekCongesBar() {
  const container = document.getElementById("weekCongesBar");
  const monday = getMonday(state.weekOffset);

  const concerned = state.staff
    .map((p) => ({ p, bar: buildAbsenceBar(p, monday) }))
    .filter((x) => x.bar !== null)
    .sort((a, b) => compareStaffOrder(a.p, b.p));

  if (concerned.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");

  const table = document.createElement("table");
  table.className = "week-conges-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "week-conges-corner";
  corner.textContent = "Congés cette semaine";
  headRow.appendChild(corner);
  concerned.forEach(({ p }) => {
    const th = document.createElement("th");
    th.className = "week-conges-person-header";
    th.style.cssText = personCellStyle(p);
    th.textContent = `${p.prenom} ${p.nom}`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  tr.appendChild(document.createElement("td"));
  concerned.forEach(({ p, bar }) => {
    const td = document.createElement("td");
    td.className = "slot-cell conges-cell week-conges-cell";
    td.appendChild(bar);
    td.addEventListener("click", () => openCongePopover(p, monday, td));
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  table.appendChild(tbody);

  container.innerHTML = "";
  container.appendChild(table);
}

// ---------- Moteur de validation (RG) ----------
// Moteur d'avertissement, pas de blocage : ne modifie jamais state, se contente de comparer le
// planning de la semaine affichée aux RG codées et de lister les écarts. Détail des règles dans
// regles-gestion.md (section "Moteur de validation") — toute RG codée ici doit y être référencée,
// et réciproquement chaque check ci-dessous doit citer explicitement son RG-XXX en commentaire.

// Accord français : "s" au pluriel seulement à partir de 2 (0 et 1 restent au singulier).
// Ex. plural(0,"sénior") -> "0 sénior", plural(1,"sénior") -> "1 sénior", plural(2,"sénior") -> "2 séniors".
function plural(count, word) {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

// Compare séniors + internes d'une case à une composition attendue { seniorMin, seniorMax,
// interneMin, interneMax } en UNE seule fois, pour produire au plus 1 ligne de violation et 1 ligne
// de recommandation par case — plutôt que 2 lignes séparées (une par rôle), qui prêtaient à
// confusion pour une RG qui est en réalité une seule règle de composition (retour Samir 20/07/2026).
// interneMin/interneMax à null = cette RG ne réglemente pas du tout les internes (ex. RG-007).
//
// Règle transverse (20/07/2026, rétroactive et applicable à toute RG de composition, pas propre à
// une seule RG) : un sénior au-delà du minimum requis peut couvrir un manque d'interne sans que ça
// remonte en violation — mais on le signale en recommandation ("X pourrait être remplacé par un
// interne") plutôt que de le compter comme un simple excédent, car le remplacement inverse (interne
// -> sénior) n'est jamais imposé nulle part, c'est bien à sens unique.
function checkComposition(nbSeniors, nbInternes, comp, rg, label, violations, recommendations) {
  const extraSeniors = Math.max(0, nbSeniors - comp.seniorMin);
  const interneShortfall = comp.interneMin !== null ? Math.max(0, comp.interneMin - nbInternes) : 0;
  const substitutable = Math.min(extraSeniors, interneShortfall); // séniors en trop utilisés pour couvrir le manque d'interne
  const seniorsAfterSubstitution = nbSeniors - substitutable; // ce qu'il reste de séniors une fois la substitution "appliquée"

  const seniorShort = nbSeniors < comp.seniorMin;
  const interneShort = comp.interneMin !== null && nbInternes + substitutable < comp.interneMin;

  if (seniorShort || interneShort) {
    let interneText = null;
    if (comp.interneMin !== null) {
      interneText =
        comp.interneMax !== null && comp.interneMax !== comp.interneMin
          ? `${comp.interneMin} à ${plural(comp.interneMax, "interne")}`
          : plural(comp.interneMin, "interne");
    }
    const expected = interneText ? `${plural(comp.seniorMin, "sénior")} + ${interneText}` : plural(comp.seniorMin, "sénior");
    const found = comp.interneMin !== null ? `${plural(nbSeniors, "sénior")} + ${plural(nbInternes, "interne")}` : plural(nbSeniors, "sénior");
    const totalMin = comp.seniorMin + (comp.interneMin || 0);
    const attendu = totalMin > 1 ? "attendus" : "attendu";
    violations.push({ rg, message: `${label} : ${expected} ${attendu}, trouvé ${found}.` });
  }

  if (substitutable > 0) {
    const verb = substitutable > 1 ? "pourraient être remplacés" : "pourrait être remplacé";
    recommendations.push({ rg, message: `${label} : ${plural(substitutable, "sénior")} ${verb} par ${plural(substitutable, "interne")}.` });
  }

  // comp.encourageInterneGrowth (ex. RG-009) : à l'inverse d'un "en trop", signale qu'il y a encore
  // de la place jusqu'à interneMax sans que ce soit obligatoire (ex. 1 interne minimum mais 2
  // idéal) — seulement si le minimum est déjà atteint "naturellement" (pas via une substitution
  // RG-008, sinon on aurait deux recommandations qui se chevauchent pour la même case).
  if (comp.encourageInterneGrowth && comp.interneMax !== null && nbInternes >= comp.interneMin && nbInternes < comp.interneMax) {
    const room = comp.interneMax - nbInternes;
    const verb = room > 1 ? "pourraient être ajoutés" : "pourrait être ajouté";
    recommendations.push({ rg, message: `${label} : ${plural(room, "interne")} de plus ${verb} (jusqu'à ${comp.interneMax}).` });
  }

  const excessParts = [];
  if (comp.seniorMax !== null && seniorsAfterSubstitution > comp.seniorMax) {
    excessParts.push(plural(seniorsAfterSubstitution - comp.seniorMax, "sénior"));
  }
  if (comp.interneMax !== null && nbInternes > comp.interneMax) {
    excessParts.push(plural(nbInternes - comp.interneMax, "interne"));
  }
  if (excessParts.length > 0) {
    recommendations.push({ rg, message: `${label} : ${excessParts.join(" et ")} en trop.` });
  }
}

// RG-002 / RG-003 / RG-007 / RG-012 : composition attendue de Scan U selon jour/créneau.
function validateScanU() {
  const violations = [];
  const recommendations = [];
  const activity = state.activities.find((a) => a.id === "scan-u");
  if (!activity) return { violations, recommendations };

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      const key = cellKey(activity.id, day, creneau.id);
      if (state.fermetures[key]) return; // RG-010 : vacation fermée cette semaine, aucune composition attendue.
      if (state.vacationSpecialites[vacationSpecKey(activity.id, day, creneau.id)] === "os") return; // RG-011 : vacation Os, jamais staffée.
      const assigned = effectiveAssignedIds(key).map(staffById).filter(Boolean);
      const nbSeniors = assigned.filter((p) => p.grade === "senior").length;
      const internes = assigned.filter((p) => p.grade !== "senior");
      const nbInternes = internes.length;
      const label = `Scan U, ${day} ${creneau.label}`;

      if (creneau.id === "astreinte") {
        // RG-012 : composition dédiée à l'astreinte, pas via checkComposition() -- distinction
        // interne "socle" (0 spécialité) vs interne spécialisé, que le helper générique ne connaît pas.
        const nbSocle = internes.filter((p) => (p.specialites || []).length === 0).length;
        if (nbInternes === 0) {
          violations.push({ rg: "RG-012", message: `${label} : ${plural(1, "interne")} attendu, trouvé 0.` });
        }
        if (nbSeniors > 0) {
          recommendations.push({
            rg: "RG-012",
            message: `${label} : ${plural(nbSeniors, "sénior")} en trop (l'astreinte n'accueille que des internes).`,
          });
        }
        if (nbInternes >= 1 && nbInternes < 2 && nbSocle === 0) {
          recommendations.push({
            rg: "RG-012",
            message: `${label} : un interne socle pourrait être ajouté en renfort de l'interne déjà présent.`,
          });
        }
        return;
      }

      if (creneau.id === "matin" && day === "Jeudi") {
        // RG-007 : exception du jeudi matin — 2 séniors minimum, remplace RG-002 ce jour précis.
        // Les internes ne sont pas réglementés par cette RG (ni exigés, ni interdits).
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 2, seniorMax: 2, interneMin: null, interneMax: null },
          "RG-007", label, violations, recommendations
        );
      } else if (creneau.id === "matin") {
        // RG-002 : Scan U le matin (hors jeudi) — 1 sénior + 2 internes minimum.
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2 },
          "RG-002", label, violations, recommendations
        );
      } else {
        // RG-003 : Scan U l'après-midi — 2 séniors minimum + 1 interne minimum. Monter à 2 internes
        // est recommandé mais pas obligatoire (encourageInterneGrowth, même logique que RG-009).
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 2, seniorMax: 2, interneMin: 1, interneMax: 2, encourageInterneGrowth: true },
          "RG-003", label, violations, recommendations
        );
      }
    });
  });

  return { violations, recommendations };
}

// RG-009 : composition attendue de Scan A — même règle tous les jours, matin et après-midi.
function validateScanA() {
  const violations = [];
  const recommendations = [];
  const activity = state.activities.find((a) => a.id === "scan-a");
  if (!activity) return { violations, recommendations };

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      if (!isCreneauApplicable(activity.id, creneau.id)) return; // RG-012 : astreinte non applicable à Scan A.
      const key = cellKey(activity.id, day, creneau.id);
      if (state.fermetures[key]) return; // RG-010 : vacation fermée cette semaine, aucune composition attendue.
      if (state.vacationSpecialites[vacationSpecKey(activity.id, day, creneau.id)] === "os") return; // RG-011 : vacation Os, jamais staffée.
      const assigned = effectiveAssignedIds(key).map(staffById).filter(Boolean);
      const nbSeniors = assigned.filter((p) => p.grade === "senior").length;
      const nbInternes = assigned.filter((p) => p.grade !== "senior").length;
      const label = `Scan A, ${day} ${creneau.label}`;

      // RG-009 : 1 sénior + 1 interne minimum. Monter à 2 internes est recommandé mais pas exigé
      // (encourageInterneGrowth) : 1 interne -> "encore 1 pourrait être ajouté", 2 internes -> rien.
      checkComposition(
        nbSeniors, nbInternes,
        { seniorMin: 1, seniorMax: 1, interneMin: 1, interneMax: 2, encourageInterneGrowth: true },
        "RG-009", label, violations, recommendations
      );
    });
  });

  return { violations, recommendations };
}

// RG-014 : une personne assignée ne doit jamais être en congé ou en repos de garde (RG-013) le
// jour de la case où elle est postée. Contrairement à RG-002/003/007/009/012, ce n'est pas une
// RG de composition (nombre de séniors/internes) mais une contrainte transverse à TOUTES les
// activités/créneaux applicables -- d'où une boucle sur state.activities plutôt qu'une seule
// modalité. Toujours une violation (jamais une recommandation) : il n'y a pas de "trop de zèle"
// possible ici. Filet de sécurité pour tout ce qui a échappé au blocage du glisser-déposer (le
// popover d'ajout n'est pas filtré, voir handleAssignmentDrop()) -- voir aussi le contour rouge
// posé directement sur la case dans buildModaliteCell() (.cell-absence-violation).
function validateAbsences() {
  const violations = [];
  const recommendations = [];

  state.activities.forEach((activity) => {
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return; // RG-010 : case fermée, aucune vérification attendue.
        const assigned = effectiveAssignedIds(key);
        assigned.forEach((staffId) => {
          if (!isPersonAbsentOnDay(staffId, day)) return;
          const person = staffById(staffId);
          if (!person) return;
          violations.push({
            rg: "RG-014",
            message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} est absent(e) ce jour-là.`,
          });
        });
      });
    });
  });

  return { violations, recommendations };
}

// RG-015 : composition de la garde -- 1 sénior + 2 internes minimum, par jour. Contrairement aux
// RG de composition de vacation (RG-002/003/007/009/012), il n'y a pas de créneau ni de modalité :
// state.gardes n'a qu'une date par personne, donc une seule composition attendue par jour calendaire
// de la semaine affichée. Réutilise checkComposition() comme RG-002 (mêmes seuils).
function validateGardes() {
  const violations = [];
  const recommendations = [];
  const monday = getMonday(state.weekOffset);

  weekIsoDates(monday).forEach((iso, i) => {
    const onGarde = gardeStaffForDate(iso);
    const nbSeniors = onGarde.filter((p) => p.grade === "senior").length;
    const nbInternes = onGarde.filter((p) => p.grade !== "senior").length;
    checkComposition(
      nbSeniors, nbInternes,
      { seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2 },
      "RG-015", `Garde, ${DAYS[i]}`, violations, recommendations
    );
  });

  return { violations, recommendations };
}

// Point d'entrée unique du moteur : ajouter ici l'appel de toute nouvelle fonction validateXxx().
function runValidation() {
  const results = [validateScanU(), validateScanA(), validateAbsences(), validateGardes()];
  return {
    violations: results.flatMap((r) => r.violations),
    recommendations: results.flatMap((r) => r.recommendations),
  };
}

function renderValidationColumn(items, kind) {
  // kind: "violation" | "recommendation" — pilote les libellés et classes CSS.
  const isViolation = kind === "violation";
  const label = isViolation ? "violation" : "recommandation";
  const badgeClass = isViolation ? "rg-violation" : "rg-recommendation";

  if (items.length === 0) {
    return `<div class="validation-ok">✓ Aucune ${label} pour cette semaine.</div>`;
  }

  const agreementS = items.length > 1 ? "s" : "";
  return `
    <h3 class="validation-title ${kind}-title">${plural(items.length, label)} détectée${agreementS} cette semaine</h3>
    <ul class="validation-list">
      ${items.map((v) => `<li><span class="validation-rg ${badgeClass}">${v.rg}</span> ${v.message}</li>`).join("")}
    </ul>
  `;
}

function renderValidationZone() {
  const zone = document.getElementById("validationZone");
  const { violations, recommendations } = runValidation();

  zone.innerHTML = `
    <div class="validation-col validation-col-violations">${renderValidationColumn(violations, "violation")}</div>
    <div class="validation-col validation-col-recommendations">${renderValidationColumn(recommendations, "recommendation")}</div>
  `;
}

// ---------- Rendu ----------

function staffById(id) {
  return state.staff.find((s) => s.id === id);
}

// Détermine la classe CSS + le style inline d'une pastille : couleur = spécialité(s), forme = grade.
// 0 spécialité -> gris (socle). 1 -> couleur pleine. 2 -> dégradé bicolore (deux spécialités).
function chipVisual(person) {
  const specs = orderedSpecialites(person);
  const shapeClass = person.grade === "senior" ? " rect" : "";

  if (specs.length === 0) {
    return { className: `chip spec-none${shapeClass}`, style: "" };
  }
  if (specs.length === 1) {
    return { className: `chip spec-${specs[0]}${shapeClass}`, style: "" };
  }
  const c1 = SPECIALITES[specs[0]];
  const c2 = SPECIALITES[specs[1]];
  const style = `background: linear-gradient(135deg, ${c1.bg} 50%, ${c2.bg} 50%);`;
  return { className: `chip spec-split${shapeClass}`, style };
}

// Même code couleur que les pastilles, mais en style inline complet (fond + texte) pour habiller
// une cellule normale (ex. la colonne nom de la vue Personnel) plutôt qu'un chip.
function personCellStyle(person) {
  const specs = orderedSpecialites(person);
  if (specs.length === 0) return "background-color:#f1f5f9;color:#334155;";
  if (specs.length === 1) {
    const c = SPECIALITES[specs[0]];
    return `background-color:${c.bg};color:${c.text};`;
  }
  const c1 = SPECIALITES[specs[0]];
  const c2 = SPECIALITES[specs[1]];
  return `background:linear-gradient(135deg, ${c1.bg} 50%, ${c2.bg} 50%);color:#1f2937;`;
}

function applyChipVisual(el, person) {
  const { className, style } = chipVisual(person);
  el.className = className;
  if (style) el.style.cssText += style;
}

// Pastille assignée dans une case du planning (vue Modalité), avec bouton de retrait et
// glisser-déposer vers une autre case pour déplacer la personne (voir handleAssignmentDrop()).
function buildAssignedChip(person, key, day) {
  const chip = document.createElement("span");
  applyChipVisual(chip, person);
  // RG-014 (24/07/2026, retour de Samir) : le contour rouge posé sur toute la case
  // (.cell-absence-violation) ne disait pas QUI, parmi plusieurs personnes assignées, est la
  // personne absente en cause -- entoure désormais aussi la pastille de la personne concernée.
  if (isPersonAbsentOnDay(person.id, day)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est absent(e) ce jour-là`;
  }
  chip.textContent = `${person.prenom[0]}. ${person.nom}`;
  chip.draggable = true;
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", person.id);
    e.dataTransfer.setData("application/x-source-key", key);
    e.dataTransfer.effectAllowed = "move";
  });
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeAssignment(key, person.id);
  });
  chip.appendChild(remove);
  return chip;
}

// Pastille de garde affichée dans l'en-tête de jour du planning (renderTable()) -- read-only,
// contrairement à buildAssignedChip() : pas de glisser-déposer ni de bouton de retrait, la garde
// se déclare depuis le popover congés/gardes (openCongePopover()), pas depuis l'en-tête.
function buildGardeChip(person) {
  const chip = document.createElement("span");
  applyChipVisual(chip, person);
  chip.classList.add("chip-garde");
  chip.textContent = `${person.prenom[0]}. ${person.nom}`;
  chip.title = `${person.prenom} ${person.nom} — garde`;
  return chip;
}

// Déplace/ajoute une personne dans les assignations d'une case cible, en la retirant au passage
// de sa case source si le glissé provient d'une autre case du planning (et pas de la liste
// Personnel, qui ne fournit pas de source-key et se comporte donc en simple ajout).
// Renvoie false si le dépôt est refusé (rien n'est modifié) -- l'appelant s'en sert pour donner un
// retour visuel (flash rouge, voir buildModaliteCell()), true si l'affectation a bien eu lieu.
function handleAssignmentDrop(e, targetKey, day) {
  const staffId = e.dataTransfer.getData("text/plain");
  if (!staffId || !staffById(staffId)) return false;
  const sourceKey = e.dataTransfer.getData("application/x-source-key");
  if (sourceKey && sourceKey === targetKey) return false;

  // RG-014 : une personne en congé ou en repos de garde ce jour-là ne peut pas être posée --
  // bloqué ici au niveau du glisser-déposer (le popover d'ajout, lui, n'est pas filtré : si une
  // absence s'y glisse quand même, elle remonte en violation + contour rouge, voir buildModaliteCell()).
  if (isPersonAbsentOnDay(staffId, day)) return false;

  // RG-017 : matérialise systématiquement (source ET cible) avant de modifier -- une case source
  // encore purement issue de la trame (jamais touchée cette semaine) n'a pas de clé explicite dans
  // state.assignments ; sans ce passage par effectiveAssignedIds()/ensureMaterializedAssignments(),
  // la personne semblerait avoir disparu de nulle part (retirée de rien) tout en réapparaissant
  // dans la cible -- elle serait alors affichée deux fois (l'ancienne case continuant de suivre la
  // trame, jamais décrochée).
  if (sourceKey) {
    state.assignments[sourceKey] = effectiveAssignedIds(sourceKey).filter((id) => id !== staffId);
  }
  const targetList = ensureMaterializedAssignments(targetKey);
  if (!targetList.includes(staffId)) {
    targetList.push(staffId);
  }
  saveState();
  render();
  return true;
}

function render() {
  document.getElementById("weekLabel").textContent = currentWeekLabel();

  // Dérivées du mode Trame (voir déclaration plus haut) -- recalculées en tout premier ici pour que
  // tout le reste de render() (et tout ce qu'il appelle) les voie déjà à jour.
  editingVacationSpecs = editingTrame && trameView === "specs";
  editingTramePersonnel = editingTrame && trameView === "personnel";

  document.getElementById("trameSubNav").classList.toggle("hidden", !editingTrame);
  document.querySelectorAll(".trame-tab").forEach((btn) => {
    btn.classList.toggle("active", editingTrame && trameView === btn.dataset.trameView);
  });

  document.getElementById("weekCongesBar").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel);
  document.getElementById("tableWrap").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel);
  document.getElementById("validationZone").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel);
  document.getElementById("congesView").classList.toggle("hidden", !editingConges);
  document.getElementById("statsView").classList.toggle("hidden", !editingStats);
  document.getElementById("tramePersonnelView").classList.toggle("hidden", !editingTramePersonnel);
  // La liste du personnel n'a aucune utilité en vue Congés/Stats/Trame Personnel et peut être très
  // haute (une ligne par personne) : la masquer y libère la hauteur d'écran nécessaire (trouvé le
  // 21/07/2026 en testant en vrai pour la vue Congés -- même raisonnement appliqué depuis à Stats
  // puis à Trame Personnel).
  document.getElementById("staffList").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel);

  // Panneau de droite entier masqué UNIQUEMENT en vue Personnel du planning principal (22/07/2026) :
  // ses lignes y dupliquent exactement celles du tableau (une par personne), donc plus aucune
  // utilité -- masquer tout le panneau libère la largeur pour le tableau (Samir voulait voir
  // Vendredi sans scroll horizontal). **Revert du 22/07/2026 (même jour, retour de Samir)** : ça ne
  // s'applique QUE dans cette vue précise, pas en vue Modalité (l'ancien comportement — panneau
  // toujours affiché avec sa légende dedans — doit rester en vue Modalité/Spécialités Vacations/
  // Congés). D'où le déplacement de `#legend` en JS ci-dessous plutôt qu'un simple hidden posé une
  // fois pour toutes dans `index.html` : la légende doit continuer à fonctionner (filtrer la liste)
  // dans les vues où le panneau reste visible, donc elle doit physiquement y rester présente.
  const legend = document.getElementById("legend");
  const staffPanel = document.getElementById("staffPanel");
  // Trame Personnel (24/07/2026) rejoint ce même traitement -- demandé par Samir ("filtres en haut
  // comme sur cette page", en référence à la vraie vue Personnel) : ses lignes sont aussi une par
  // personne, la liste de droite y est tout aussi redondante, et masquer tout le panneau libère la
  // largeur nécessaire pour voir Vendredi sans scroll horizontal, exactement la même raison qui a
  // fait remonter la légende ici pour la vraie vue Personnel (voir juste en dessous).
  const inPersonnelView =
    editingTramePersonnel ||
    (currentView === "personnel" && !editingConges && !editingVacationSpecs && !editingStats);

  if (inPersonnelView) {
    // Remontée au-dessus du tableau (avant `#weekCongesBar`), pour rester accessible pendant que
    // tout le panneau qui la contenait normalement est masqué -- sinon les puces de filtre
    // n'auraient plus rien à agir dessus dans cette vue (voir renderPersonnelRows()).
    legend.classList.add("legend-top");
    document.querySelector(".planning-column").insertBefore(legend, document.getElementById("weekCongesBar"));
  } else {
    // Remise à sa place d'origine, entre le titre "Personnel" et la liste -- comportement
    // historique, conservé pour toutes les autres vues.
    legend.classList.remove("legend-top");
    staffPanel.insertBefore(legend, document.getElementById("staffList"));
  }

  staffPanel.classList.toggle("hidden", inPersonnelView);

  if (editingConges) {
    renderCongesView();
  } else if (editingStats) {
    renderStatsView();
  } else if (editingTramePersonnel) {
    renderTramePersonnelView();
  } else {
    renderTable();
    renderValidationZone();
    renderWeekCongesBar();
  }

  renderLegend();
  renderStaffList();
}

// Retrace tout ce qui consulte staffFilters (légende, liste de droite, et depuis le 22/07/2026 la
// vue Congés et la vue Personnel du planning principal) -- factorisé pour rester la même liste
// qu'on touche le filtre via une puce (toggleStaffFilter()) ou via "Réinitialiser les filtres".
function refreshAfterFilterChange() {
  renderLegend();
  renderStaffList();
  if (editingConges) renderCongesView();
  // Manquait à l'ajout de la vue Stats (24/07/2026) -- bug réel remonté par Samir : filtrer depuis
  // la vue Stats (ou y arriver avec un filtre déjà actif) ne mettait jamais à jour son tableau, qui
  // gardait le filtre "initial" quoi qu'on fasse ensuite. Cette fonction duplique volontairement la
  // logique de render() (voir le commentaire au-dessus) plutôt que de l'appeler telle quelle --
  // penser à répercuter ici tout nouveau mode plein-écran qui dépend de staffFilters.
  if (editingStats) renderStatsView();
  if (editingTramePersonnel) renderTramePersonnelView(); // même piège que Stats -- voir commentaire ci-dessus.
  if (!editingConges && !editingVacationSpecs && !editingStats && !editingTramePersonnel && currentView === "personnel") renderTable();
}

function toggleStaffFilter(category, value) {
  const set = staffFilters[category];
  if (set.has(value)) set.delete(value);
  else set.add(value);
  refreshAfterFilterChange();
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  const addChip = (label, category, value, style) => {
    const span = document.createElement("span");
    const active = staffFilters[category].has(value);
    span.className = "chip legend-chip" + (active ? " active" : "");
    span.style.cssText = style;
    span.textContent = label;
    span.addEventListener("click", () => toggleStaffFilter(category, value));
    legend.appendChild(span);
  };

  const neutral = "background:#f1f5f9;border-color:#94a3b8;color:#1f2937;";
  addChip("Sénior", "grades", "senior", neutral + "border-radius:4px;font-weight:700;");
  addChip("Interne", "grades", "interne", neutral);

  // Saut de ligne forcé : les spécialités passent sous Sénior/Interne, sans réduire leur propre largeur.
  const lineBreak = document.createElement("span");
  lineBreak.style.cssText = "flex-basis:100%;height:0;";
  legend.appendChild(lineBreak);

  Object.entries(SPECIALITES).forEach(([key, spec]) => {
    addChip(spec.label, "specialites", key, `background:${spec.bg};border-color:${spec.border};color:${spec.text};`);
  });
  addChip("Socle", "specialites", "socle", "background:#f1f5f9;border-color:#94a3b8;color:#334155;");

  // "Hors Sisu" (23/07/2026) : bascule à part, pas un chip de plus dans grades/specialites (voir
  // staffFilters -- sémantique "révèle" et non "restreint", RG-016). Style pointillé pour la
  // distinguer visuellement des vrais filtres de grade/spécialité.
  const horsSisuChip = document.createElement("span");
  horsSisuChip.className = "chip legend-chip" + (staffFilters.showHorsSisu ? " active" : "");
  horsSisuChip.style.cssText = "background:#f1f5f9;border-color:#94a3b8;color:#334155;border-style:dashed;";
  horsSisuChip.textContent = "Hors Sisu";
  horsSisuChip.title = "Afficher aussi les personnes \"Hors Sisu\" (masquées par défaut)";
  horsSisuChip.addEventListener("click", () => {
    staffFilters.showHorsSisu = !staffFilters.showHorsSisu;
    refreshAfterFilterChange();
  });
  legend.appendChild(horsSisuChip);

  if (staffFilters.grades.size > 0 || staffFilters.specialites.size > 0 || staffFilters.showHorsSisu) {
    const reset = document.createElement("span");
    reset.className = "legend-reset";
    reset.textContent = "× Réinitialiser les filtres";
    reset.addEventListener("click", () => {
      staffFilters.grades.clear();
      staffFilters.specialites.clear();
      staffFilters.showHorsSisu = false;
      refreshAfterFilterChange();
    });
    legend.appendChild(reset);
  }
}

function renderTable() {
  const table = document.getElementById("planningTable");
  table.innerHTML = "";

  const thead = document.createElement("thead");

  const dayRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.className = "corner-cell";
  dayRow.appendChild(cornerTh);
  const headerMonday = getMonday(state.weekOffset);
  const headerWeekDates = weekIsoDates(headerMonday);
  DAYS.forEach((day, dayIdx) => {
    const th = document.createElement("th");
    th.colSpan = CRENEAUX.length;
    th.className = "day-header day-header-focusable";
    if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === null) {
      th.classList.add("focus-active");
    }
    th.title = "Cliquer pour filtrer le personnel présent et disponible ce jour";
    th.addEventListener("click", () => toggleStaffFocusFilter(day, null));

    const label = document.createElement("div");
    label.className = "day-header-label";
    label.textContent = day;
    th.appendChild(label);

    // RG-015 : personnes de garde ce jour-là, affichées directement dans l'en-tête pour que Samir
    // les voie d'un coup d'œil pendant qu'il assigne le personnel, sans devoir rouvrir la vue Congés.
    const gardeStaff = gardeStaffForDate(headerWeekDates[dayIdx]);
    if (gardeStaff.length > 0) {
      const gardeRow = document.createElement("div");
      gardeRow.className = "day-header-garde";
      gardeStaff.forEach((p) => gardeRow.appendChild(buildGardeChip(p)));
      th.appendChild(gardeRow);
    }

    dayRow.appendChild(th);
  });
  thead.appendChild(dayRow);

  const creneauRow = document.createElement("tr");
  const modaliteTh = document.createElement("th");
  modaliteTh.className = "modalite-header";
  if (editingVacationSpecs) {
    modaliteTh.textContent = "Trame Vacation";
  } else {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "view-toggle-btn";
    toggleBtn.textContent = currentView === "modalite" ? "Modalité ⇄" : "Personnel ⇄";
    toggleBtn.title = currentView === "modalite" ? "Voir par personnel" : "Voir par modalité";
    toggleBtn.addEventListener("click", () => {
      currentView = currentView === "modalite" ? "personnel" : "modalite";
      render();
    });
    modaliteTh.appendChild(toggleBtn);
  }
  creneauRow.appendChild(modaliteTh);
  DAYS.forEach((day) => {
    CRENEAUX.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "creneau-header creneau-header-focusable";
      if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === c.id) {
        th.classList.add("focus-active");
      }
      th.title = "Cliquer pour filtrer le personnel présent et disponible sur ce créneau";
      th.addEventListener("click", () => toggleStaffFocusFilter(day, c.id));
      creneauRow.appendChild(th);
    });
  });
  thead.appendChild(creneauRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (editingVacationSpecs) {
    renderVacationSpecRows(tbody);
  } else if (currentView === "modalite") {
    renderModaliteRows(tbody);
  } else {
    renderPersonnelRows(tbody);
  }
  table.appendChild(tbody);
}

// RG-014 (22/07/2026, voir regles-gestion.md) : une personne en congé ou en repos de garde
// (RG-013) le jour `day` de la semaine ACTUELLEMENT AFFICHÉE (state.weekOffset) ne peut pas être
// postée ce jour-là. Centralisé ici pour être consulté à la fois par le blocage du glisser-déposer
// (handleAssignmentDrop()) et par le moteur de validation (validateAbsences()) -- une seule
// définition de "absent(e)", pas deux logiques qui pourraient diverger.
function isPersonAbsentOnDay(staffId, day) {
  const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
  return isOnCongeDay(staffId, iso) || isOnReposGardeDay(staffId, iso);
}

// Bascule le focus jour/demi-journée (voir déclaration de staffFocusFilter) : un clic sur exactement
// la même cible (même day + même creneauId, `null` compris pour "jour entier") l'annule, un clic sur
// une cible différente (autre jour, ou même jour mais créneau différent) la remplace.
function toggleStaffFocusFilter(day, creneauId) {
  if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === creneauId) {
    staffFocusFilter = null;
  } else {
    staffFocusFilter = { day, creneauId };
  }
  render();
}

// `staffId` est-elle déjà postée sur le jour/créneau du focus actif -- toutes activités confondues ?
// creneauId `null` (jour entier) regarde les 3 créneaux ; un créneau précis n'en regarde qu'un seul
// (ex. "Lundi Matin" ignore une éventuelle présence l'après-midi du même jour).
function isPersonPostedInFocus(staffId, day, creneauId) {
  const creneauIds = creneauId ? [creneauId] : CRENEAUX.map((c) => c.id);
  return state.activities.some((activity) =>
    creneauIds.some((cId) => effectiveAssignedIds(cellKey(activity.id, day, cId)).includes(staffId))
  );
}

// Filtre du panneau Personnel dérivé du focus actif (voir staffFocusFilter) : présente ce jour-là
// (RG-014, ni congé ni repos de garde) ET pas déjà postée sur le jour/créneau ciblé. Renvoie true
// (rien à filtrer) si aucun focus n'est actif.
function personMatchesFocusFilter(person) {
  if (!staffFocusFilter) return true;
  const { day, creneauId } = staffFocusFilter;
  if (isPersonAbsentOnDay(person.id, day)) return false;
  return !isPersonPostedInFocus(person.id, day, creneauId);
}

// Construit une case assignable de la vue Modalité pour une activité/jour/créneau donnés.
// Séparé de renderModaliteRows() pour pouvoir fusionner la case Astreinte+Après-midi sur les
// activités autres que Scan U (RG-012, voir plus bas) sans dupliquer toute cette logique.
function buildModaliteCell(activity, day, creneau) {
  const td = document.createElement("td");
  td.className = "slot-cell";

  const key = cellKey(activity.id, day, creneau.id);
  const assigned = effectiveAssignedIds(key); // RG-017 : peut venir de la trame si jamais touchée cette semaine.
  const closed = !!state.fermetures[key]; // RG-010 : fermeture hebdomadaire, voir regles-gestion.md

  const vacSpec = state.vacationSpecialites[vacationSpecKey(activity.id, day, creneau.id)];
  if (vacSpec) td.classList.add(`tint-${vacSpec}`);

  // RG-011 : une vacation de spécialité "Os" n'est jamais assignable -- même comportement
  // bloquant qu'une fermeture (RG-010), mais piloté par vacationSpecialites (structurel).
  const osBlocked = !closed && vacSpec === "os";

  if (closed) {
    td.classList.add("cell-closed");
    const cross = document.createElement("span");
    cross.className = "closed-mark";
    cross.textContent = "✕";
    cross.title = "Vacation fermée cette semaine";
    td.appendChild(cross);
  } else {
    // Marque textuelle en plus de la teinte pour la spécialité "Os" (fond blanc, sinon
    // invisible sur le fond de page) -- voir SPECIALITES.os et section 5 de CLAUDE.md.
    if (osBlocked) {
      td.classList.add("cell-os-blocked");
      const badge = document.createElement("span");
      badge.className = "modalite-spec-label";
      badge.textContent = SPECIALITES.os.label;
      td.appendChild(badge);
    }

    if (assigned.length === 0) {
      if (!osBlocked) {
        const hint = document.createElement("span");
        hint.className = "empty-hint";
        hint.textContent = "+ ajouter";
        td.appendChild(hint);
      }
    } else {
      const people = assigned.map(staffById).filter(Boolean);
      const seniors = people.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
      const internes = people.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);

      const addCellGroup = (group) => {
        if (group.length === 0) return;
        const row = document.createElement("div");
        row.className = "cell-group";
        group.forEach((person) => row.appendChild(buildAssignedChip(person, key, day)));
        td.appendChild(row);
      };
      addCellGroup(seniors);
      addCellGroup(internes);

      // RG-014 : filet de sécurité si une personne absente s'est malgré tout retrouvée assignée
      // (ex. congé déclaré après coup, ou ajoutée via le popover -- seul le glisser-déposer est
      // bloqué en amont, voir plus bas). Contour rouge, en plus de la violation dans la zone du
      // moteur (validateAbsences()), pour repérer directement la case en cause dans le tableau.
      if (people.some((p) => isPersonAbsentOnDay(p.id, day))) {
        td.classList.add("cell-absence-violation");
      }
    }

    if (!osBlocked) {
      td.addEventListener("click", () => openAssignPopover(key, td, activity, day, creneau));

      td.addEventListener("dragover", (e) => {
        e.preventDefault();
        td.classList.add("drag-over");
      });
      td.addEventListener("dragleave", () => {
        td.classList.remove("drag-over");
      });
      td.addEventListener("drop", (e) => {
        e.preventDefault();
        td.classList.remove("drag-over");
        if (!handleAssignmentDrop(e, key, day)) {
          // RG-014 : dépôt refusé (personne absente ce jour-là) -- flash rouge bref pour signaler
          // que le glisser-déposer n'a rien fait, plutôt qu'un échec silencieux qui pourrait
          // passer pour un bug.
          td.classList.add("drop-rejected");
          setTimeout(() => td.classList.remove("drop-rejected"), 400);
        }
      });
    }
  }

  return td;
}

const CRENEAU_MATIN = CRENEAUX.find((c) => c.id === "matin");
const CRENEAU_APRES_MIDI = CRENEAUX.find((c) => c.id === "apres-midi");

// Vue par défaut : une ligne par modalité, on y assigne des personnes.
function renderModaliteRows(tbody) {
  state.activities.forEach((activity) => {
    const tr = document.createElement("tr");
    if (activity.group && activity.group.endsWith("-start")) tr.classList.add("group-start");
    if (activity.group && activity.group.endsWith("-end")) tr.classList.add("group-end");

    const nameCell = document.createElement("td");
    nameCell.textContent = activity.nom;
    nameCell.className = "activity-cell" + (activity.urgence ? " urgence" : "");
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      if (activity.id === "scan-u") {
        CRENEAUX.forEach((creneau) => tr.appendChild(buildModaliteCell(activity, day, creneau)));
      } else {
        // RG-012 : l'astreinte n'existe pas ici -- au lieu d'une case grisée à part, on fusionne
        // la colonne Astreinte dans la case Après-midi (colSpan 2) : la case reste une case
        // Après-midi normale, juste visuellement plus large, la colonne Astreinte "disparaît".
        tr.appendChild(buildModaliteCell(activity, day, CRENEAU_MATIN));
        const apresMidiCell = buildModaliteCell(activity, day, CRENEAU_APRES_MIDI);
        apresMidiCell.colSpan = 2;
        tr.appendChild(apresMidiCell);
      }
    });

    tbody.appendChild(tr);
  });
}

// Mode "Spécialités Vacations" : mêmes lignes/colonnes que la vue Modalité, mais chaque case
// porte au plus une spécialité "propriétaire" (structurel, indépendant de la semaine) au lieu
// d'une liste de personnes. Alimente le fond teinté de la vue classique (voir tint-xxx en CSS)
// et servira de base aux futures RG de compétences.
function renderVacationSpecRows(tbody) {
  state.activities.forEach((activity) => {
    const tr = document.createElement("tr");
    if (activity.group && activity.group.endsWith("-start")) tr.classList.add("group-start");
    if (activity.group && activity.group.endsWith("-end")) tr.classList.add("group-end");

    const nameCell = document.createElement("td");
    nameCell.textContent = activity.nom;
    nameCell.className = "activity-cell" + (activity.urgence ? " urgence" : "");
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      if (activity.id === "scan-u") {
        CRENEAUX.forEach((creneau) => tr.appendChild(buildVacationSpecCell(activity, day, creneau)));
      } else {
        // RG-012 : même fusion Astreinte+Après-midi que dans la vue Modalité, voir buildModaliteCell().
        tr.appendChild(buildVacationSpecCell(activity, day, CRENEAU_MATIN));
        const apresMidiCell = buildVacationSpecCell(activity, day, CRENEAU_APRES_MIDI);
        apresMidiCell.colSpan = 2;
        tr.appendChild(apresMidiCell);
      }
    });

    tbody.appendChild(tr);
  });
}

function buildVacationSpecCell(activity, day, creneau) {
  const td = document.createElement("td");
  td.className = "slot-cell";

  const specKey = vacationSpecKey(activity.id, day, creneau.id);
  const spec = state.vacationSpecialites[specKey];
  const closureKey = cellKey(activity.id, day, creneau.id);
  const closed = !!state.fermetures[closureKey];

  if (closed) {
    td.classList.add("cell-closed");
    td.appendChild(buildFermetureTag(closureKey));
  }
  if (spec) {
    td.classList.add(`tint-${spec}`);
    td.appendChild(buildVacationSpecTag(spec, specKey));
  }
  if (!closed && !spec) {
    const hint = document.createElement("span");
    hint.className = "empty-hint";
    hint.textContent = "+ ajouter";
    td.appendChild(hint);
  }

  td.addEventListener("click", () => openVacationSpecPopover(specKey, td, activity, day, creneau));
  return td;
}

function buildVacationSpecTag(specKeyName, specKey) {
  const spec = SPECIALITES[specKeyName];
  const tag = document.createElement("span");
  tag.className = "chip vacation-spec-tag";
  tag.style.cssText = `background-color:${spec.bg};color:${spec.text};`;
  tag.textContent = spec.label;
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    delete state.vacationSpecialites[specKey];
    saveState();
    render();
  });
  tag.appendChild(remove);
  return tag;
}

// RG-010 : fermeture hebdomadaire d'une vacation, indépendante de la spécialité structurelle
// (les deux coexistent -- fermer n'efface pas la spécialité "propriétaire", voir regles-gestion.md).
function buildFermetureTag(closureKey) {
  const tag = document.createElement("span");
  tag.className = "chip vacation-spec-tag fermeture-tag";
  tag.textContent = "Fermé";
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Rouvrir";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    delete state.fermetures[closureKey];
    saveState();
    render();
  });
  tag.appendChild(remove);
  return tag;
}

function openVacationSpecPopover(specKey, cellEl, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  renderVacationSpecPopoverContent(specKey, activity, day, creneau);

  const rect = cellEl.getBoundingClientRect();
  pop.style.top = `${window.scrollY + rect.bottom + 4}px`;
  pop.style.left = `${window.scrollX + rect.left}px`;
  pop.classList.remove("hidden");
}

function renderVacationSpecPopoverContent(specKey, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  const current = state.vacationSpecialites[specKey];
  const closureKey = cellKey(activity.id, day, creneau.id);
  const closed = !!state.fermetures[closureKey];

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${activity.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label}</span>
    <div id="popAssigned" class="popover-assigned"></div>
    <div class="popover-select-list vacation-spec-options"></div>
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (closed) {
    assignedContainer.appendChild(buildFermetureTag(closureKey));
    assignedContainer.querySelector(".fermeture-tag .remove").addEventListener("click", () =>
      renderVacationSpecPopoverContent(specKey, activity, day, creneau)
    );
  }
  if (current) {
    assignedContainer.appendChild(buildVacationSpecTag(current, specKey));
    assignedContainer.querySelector(".vacation-spec-tag:not(.fermeture-tag) .remove").addEventListener("click", () =>
      renderVacationSpecPopoverContent(specKey, activity, day, creneau)
    );
  }
  if (!closed && !current) {
    assignedContainer.innerHTML = '<span class="empty-hint">Aucune spécialité définie pour l\'instant</span>';
  }

  const optionsList = pop.querySelector(".vacation-spec-options");
  Object.entries(SPECIALITES).forEach(([key, spec]) => {
    if (key === current) return;
    const row = document.createElement("div");
    row.className = "popover-select-option";
    row.style.cssText = `background-color:${spec.bg};color:${spec.text};`;
    row.textContent = spec.label;
    row.addEventListener("click", () => {
      state.vacationSpecialites[specKey] = key;
      saveState();
      render();
      renderVacationSpecPopoverContent(specKey, activity, day, creneau);
    });
    optionsList.appendChild(row);
  });

  if (!closed) {
    // RG-010 : option "Fermé" séparée des spécialités -- écrit dans state.fermetures (hebdomadaire),
    // jamais dans vacationSpecialites (structurel). Les deux peuvent coexister.
    const closeRow = document.createElement("div");
    closeRow.className = "popover-select-option fermeture-option";
    closeRow.textContent = "Fermé";
    closeRow.addEventListener("click", () => {
      state.fermetures[closureKey] = true;
      saveState();
      render();
      renderVacationSpecPopoverContent(specKey, activity, day, creneau);
    });
    optionsList.appendChild(closeRow);
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

// Vue alternative : une ligne par personne (ordre alphabétique), on y voit où chacun est posté
// et on peut lui assigner une modalité directement. Mêmes colonnes jour/créneau que l'autre vue.
function activitiesForPersonSlot(personId, day, creneauId) {
  return state.activities.filter((activity) => {
    const key = cellKey(activity.id, day, creneauId);
    return effectiveAssignedIds(key).includes(personId);
  });
}

function renderPersonnelRows(tbody) {
  // Filtrée par les mêmes puces que le panneau Personnel/vue Congés (22/07/2026) -- devenu
  // nécessaire depuis que le panneau de droite (et sa liste, seule à consulter ces filtres
  // jusque-là dans cette vue) est masqué ici : sans ce filtre, les puces Sénior/Interne/spécialité
  // n'auraient plus aucun effet visible pendant qu'on est en vue Personnel.
  const people = state.staff.filter(personMatchesFilters).sort(compareStaffOrder);
  const monday = getMonday(state.weekOffset);
  const weekDates = weekIsoDates(monday);

  people.forEach((person) => {
    const tr = document.createElement("tr");

    // Nom abrégé "P. Nom" (22/07/2026, ex. "A. de Bretagne") -- même format que les pastilles assignées
    // (buildAssignedChip()), pour gagner en largeur de colonne et voir Vendredi sans scroller.
    // Nom complet dans l'attribut title (survol).
    const nameCell = document.createElement("td");
    nameCell.textContent = `${person.prenom[0]}. ${person.nom}`;
    nameCell.title = `${person.prenom} ${person.nom}`;
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    DAYS.forEach((day, dayIdx) => {
      const iso = weekDates[dayIdx];
      // Une personne en congé ou en repos de garde (RG-013) ce jour-là n'est plus assignable --
      // demandé le 22/07/2026. Congé prioritaire sur repos de garde si (rare) les deux coïncident.
      // La garde elle-même ne bloque rien : elle signifie que la personne travaille ce jour-là.
      const onConge = isOnCongeDay(person.id, iso);
      const onRepos = !onConge && isOnReposGardeDay(person.id, iso);
      const absenceLabel = onConge ? "Congés" : onRepos ? "Repos de garde" : null;

      CRENEAUX.forEach((creneau) => {
        const td = document.createElement("td");
        td.className = "slot-cell";

        if (absenceLabel) {
          td.classList.add("cell-absence-blocked", onConge ? "cell-absence-conge" : "cell-absence-repos");
          const badge = document.createElement("span");
          badge.className = "absence-label";
          badge.textContent = absenceLabel;
          td.appendChild(badge);
          tr.appendChild(td);
          return;
        }

        const activitiesHere = activitiesForPersonSlot(person.id, day, creneau.id);

        if (activitiesHere.length === 0) {
          const hint = document.createElement("span");
          hint.className = "empty-hint";
          hint.textContent = "+ ajouter";
          td.appendChild(hint);
        } else {
          activitiesHere.forEach((activity) => {
            const key = cellKey(activity.id, day, creneau.id);
            td.appendChild(buildModaliteTag(activity, key, person.id, { draggable: true }));
          });
        }

        td.addEventListener("click", () => openPersonAssignPopover(person, day, creneau, td));

        td.addEventListener("dragover", (e) => {
          e.preventDefault();
          td.classList.add("drag-over");
        });
        td.addEventListener("dragleave", () => {
          td.classList.remove("drag-over");
        });
        td.addEventListener("drop", (e) => {
          e.preventDefault();
          td.classList.remove("drag-over");
          handleModaliteDrop(e, person.id, day, creneau.id);
        });

        tr.appendChild(td);
      });
    });

    tbody.appendChild(tr);
  });
}

// draggable=true uniquement pour les cases du tableau (vue Personnel) : on ne veut pas de glisser
// depuis les pastilles "déjà assigné" à l'intérieur d'un popover.
function buildModaliteTag(activity, key, staffId, { draggable = false } = {}) {
  const tag = document.createElement("span");
  // RG-017 (24/07/2026) : teinte l'étiquette selon la spécialité "propriétaire" de la vacation
  // (Trame Vacation, state.vacationSpecialites) -- même code couleur que la teinte de fond des
  // cases en vue Modalité (.tint-xxx), pour repérer d'un coup d'œil "cette vacation est la case
  // Uro" même depuis la vue Personnel. `key` est un cellKey() (avec weekKey) -- on retire ce
  // préfixe via trameKeyFromCellKey() pour retomber sur le format de vacationSpecKey().
  const vacSpec = state.vacationSpecialites[trameKeyFromCellKey(key)];
  tag.className = "chip modalite-tag" + (activity.urgence ? " urgence-tag" : "") + (vacSpec ? ` spec-${vacSpec}` : "");
  tag.textContent = activity.nom;
  if (draggable) {
    tag.draggable = true;
    tag.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", staffId);
      e.dataTransfer.setData("application/x-activity-id", activity.id);
      e.dataTransfer.setData("application/x-source-key", key);
      e.dataTransfer.effectAllowed = "move";
    });
  }
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeAssignment(key, staffId);
  });
  tag.appendChild(remove);
  return tag;
}

// Équivalent de handleAssignmentDrop() côté vue Personnel : la modalité vient du glissé,
// la personne et le créneau viennent de la case cible (ligne/colonne).
function handleModaliteDrop(e, targetStaffId, targetDay, targetCreneauId) {
  const activityId = e.dataTransfer.getData("application/x-activity-id");
  if (!activityId) return;
  if (!isCreneauApplicable(activityId, targetCreneauId)) return; // RG-012 : astreinte réservée à Scan U.
  const draggedStaffId = e.dataTransfer.getData("text/plain");
  const sourceKey = e.dataTransfer.getData("application/x-source-key");
  const targetKey = cellKey(activityId, targetDay, targetCreneauId);
  if (sourceKey === targetKey) return;

  // RG-017 : voir le commentaire équivalent dans handleAssignmentDrop() -- matérialiser avant de
  // modifier, sinon une case source encore purement issue de la trame ne perdrait jamais son
  // affectation d'origine (aucune clé explicite à filtrer).
  if (sourceKey) {
    state.assignments[sourceKey] = effectiveAssignedIds(sourceKey).filter((id) => id !== draggedStaffId);
  }
  const targetList = ensureMaterializedAssignments(targetKey);
  if (!targetList.includes(targetStaffId)) {
    targetList.push(targetStaffId);
  }
  saveState();
  render();
}

function renderStaffPerson(ul, person, { divider = false, boxed = false, boxEnd = false } = {}) {
  const li = document.createElement("li");
  if (divider) li.classList.add("specialite-divider");
  if (boxed) li.classList.add("subblock-item");
  if (boxEnd) li.classList.add("subblock-end");
  // RG-016 : une personne "Hors Sisu" sans grade renseigné n'est ni "Sénior" ni "Interne" -- éviter
  // de retomber par défaut sur "Interne — socle" (trompeur, laisse croire à un grade qu'elle n'a
  // pas). "socle" lui-même n'a de sens que pour un interne sans spécialité encore.
  const gradeLabel = person.grade === "senior" ? "Sénior" : person.grade === "interne" ? "Interne" : "Hors Sisu";
  const specs = orderedSpecialites(person);
  const specLabel = specs.length ? specs.map((s) => SPECIALITES[s].label).join(" + ") : person.grade === "interne" ? "socle" : "";
  const suffix = specLabel ? ` — ${specLabel}` : "";
  const { className, style } = chipVisual(person);
  li.innerHTML = `<span class="${className}" style="margin-right:6px;${style}">${person.prenom[0]}.${person.nom}</span> ${gradeLabel}${suffix}`;

  li.draggable = true;
  li.classList.add("staff-draggable");
  li.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", person.id);
    e.dataTransfer.effectAllowed = "copy";
  });

  ul.appendChild(li);
}

// En-tête de bloc de premier niveau (Séniors / Internes) : simple, pliable, pas de cadre pointillé.
function renderFoldableHeader(ul, key, label) {
  const li = document.createElement("li");
  li.className = "staff-group-header";
  li.textContent = `${staffPanelCollapsed[key] ? "▸" : "▾"} ${label}`;
  li.addEventListener("click", () => {
    staffPanelCollapsed[key] = !staffPanelCollapsed[key];
    renderStaffList();
  });
  ul.appendChild(li);
}

// Sous-bloc encadré en pointillés (ex: "Spécialisés" / "Socle" à l'intérieur des Internes) : pliable,
// avec un cadre en pointillés qui délimite tout le bloc (en-tête compris).
function renderFoldableBox(ul, key, label, people, { showComboDividers = false } = {}) {
  if (people.length === 0) return;
  const collapsed = staffPanelCollapsed[key];

  const header = document.createElement("li");
  header.className = "staff-subblock-header" + (collapsed ? " subblock-solo" : "");
  header.textContent = `${collapsed ? "▸" : "▾"} ${label} (${people.length})`;
  header.addEventListener("click", () => {
    staffPanelCollapsed[key] = !staffPanelCollapsed[key];
    renderStaffList();
  });
  ul.appendChild(header);

  if (collapsed) return;

  let prevComboKey = null;
  people.forEach((person, idx) => {
    const comboKey = specialiteKey(person);
    const divider = showComboDividers && prevComboKey !== null && comboKey !== prevComboKey;
    const isLast = idx === people.length - 1;
    renderStaffPerson(ul, person, { divider, boxed: true, boxEnd: isLast });
    prevComboKey = comboKey;
  });
}

// Une personne en congé les 5 jours ouvrés de la semaine affichée n'a rien à faire dans la liste
// de droite pendant qu'on assigne le personnel (demandé le 22/07/2026) -- elle n'est de toute façon
// pas assignable cette semaine-là. Ne masque que le congé PLEIN (les 5 jours) : une
// personne partiellement absente (ex. 2 jours sur 5) reste visible, elle peut encore être postée
// les autres jours. Ne masque pas non plus les personnes en garde/repos de garde -- ce ne sont pas
// des absences de toute la semaine dans la pratique, et la garde en particulier signifie qu'elles
// travaillent, pas l'inverse.
function isFullyOnLeaveThisWeek(person) {
  return coveredDaysForWeek(person.id, getMonday(state.weekOffset)).length === DAYS.length;
}

function renderStaffList() {
  const ul = document.getElementById("staffList");
  ul.innerHTML = "";

  const visible = state.staff
    .filter(personMatchesFilters)
    .filter((p) => !isFullyOnLeaveThisWeek(p))
    .filter(personMatchesFocusFilter);
  const normalVisible = visible.filter((p) => !p.horsSisu);
  // RG-016 : à part, jamais mélangées aux séniors/internes (pas forcément de grade/spécialité) --
  // triées alphabétiquement, toujours en dernier (voir compareStaffOrder()/renderFoldableHeader ci-dessous).
  const horsSisuVisible = visible.filter((p) => p.horsSisu).sort(compareNomPrenom);

  const seniors = normalVisible.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
  const internesSpecialises = normalVisible
    .filter((p) => p.grade !== "senior" && (p.specialites || []).length > 0)
    .sort(compareSpecialiteKeys);
  const internesSocle = normalVisible.filter((p) => p.grade !== "senior" && (p.specialites || []).length === 0);
  const internesTotal = internesSpecialises.length + internesSocle.length;

  if (seniors.length > 0) {
    renderFoldableHeader(ul, "seniors", `Séniors (${seniors.length})`);
    if (!staffPanelCollapsed.seniors) {
      let prevKey = null;
      seniors.forEach((person) => {
        const key = specialiteKey(person);
        renderStaffPerson(ul, person, { divider: prevKey !== null && key !== prevKey });
        prevKey = key;
      });
    }
  }

  if (internesTotal > 0) {
    renderFoldableHeader(ul, "internes", `Internes (${internesTotal})`);
    if (!staffPanelCollapsed.internes) {
      renderFoldableBox(ul, "internesSpecialises", "Spécialisés", internesSpecialises, { showComboDividers: true });
      renderFoldableBox(ul, "internesSocle", "Socle", internesSocle);
    }
  }

  if (horsSisuVisible.length > 0) {
    renderFoldableHeader(ul, "horsSisu", `Hors Sisu (${horsSisuVisible.length})`);
    if (!staffPanelCollapsed.horsSisu) {
      horsSisuVisible.forEach((person) => renderStaffPerson(ul, person, {}));
    }
  }

  if (seniors.length === 0 && internesTotal === 0 && horsSisuVisible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-hint";
    empty.textContent = "Aucune personne ne correspond aux filtres sélectionnés.";
    ul.appendChild(empty);
  }
}

// ---------- Vue Congés ----------
// Personnes en colonnes (groupées séniors -> internes spécialisés -> internes socle, filtrées par
// les mêmes puces que le panneau Personnel via personMatchesFilters()), semaines du trimestre
// affiché en lignes. Une case verte = absent(e) toute la semaine (Lundi-Vendredi), jaune = certains
// jours seulement (détail au survol). Clic sur une case = déclarer/retirer un congé (popover).

function renderCongesView() {
  const container = document.getElementById("congesView");
  container.innerHTML = "";

  const nav = document.createElement("div");
  nav.className = "conges-nav";

  const yearNav = document.createElement("div");
  yearNav.className = "week-nav";
  const prevYear = document.createElement("button");
  prevYear.textContent = "←";
  prevYear.title = "Année précédente";
  prevYear.addEventListener("click", () => {
    congesYear -= 1;
    render();
  });
  const yearLabel = document.createElement("span");
  yearLabel.textContent = congesYear;
  const nextYear = document.createElement("button");
  nextYear.textContent = "→";
  nextYear.title = "Année suivante";
  nextYear.addEventListener("click", () => {
    congesYear += 1;
    render();
  });
  yearNav.append(prevYear, yearLabel, nextYear);
  nav.appendChild(yearNav);

  const tabs = document.createElement("div");
  tabs.className = "quarter-tabs";
  [1, 2, 3, 4].forEach((q) => {
    const btn = document.createElement("button");
    btn.textContent = "T" + q;
    btn.className = "quarter-tab" + (q === congesQuarter ? " active" : "");
    btn.addEventListener("click", () => {
      congesQuarter = q;
      render();
    });
    tabs.appendChild(btn);
  });
  nav.appendChild(tabs);
  container.appendChild(nav);

  const people = state.staff.filter(personMatchesFilters).slice().sort(compareStaffOrder);
  const firstInterneIdx = people.findIndex((p) => !p.horsSisu && p.grade !== "senior");
  const firstSocleIdx = people.findIndex((p) => !p.horsSisu && p.grade !== "senior" && (p.specialites || []).length === 0);
  // RG-016 : séparateur supplémentaire avant le groupe Hors Sisu (visible seulement si la puce
  // "Hors Sisu" est cochée, sinon findIndex renvoie -1 et ne matche jamais).
  const firstHorsSisuIdx = people.findIndex((p) => p.horsSisu);
  const boundaryClass = (i) => (i === firstInterneIdx || i === firstSocleIdx || i === firstHorsSisuIdx ? " conges-group-start" : "");

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "conges-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const congesCornerTh = document.createElement("th");
  congesCornerTh.className = "corner-cell";
  headRow.appendChild(congesCornerTh);
  const personHeaderCells = []; // parallèle à `people`, pour surligner la colonne au survol d'une case.
  people.forEach((p, i) => {
    const th = document.createElement("th");
    th.className = "conges-person-header" + boundaryClass(i);
    // Même code couleur que partout ailleurs dans l'appli (chips, colonne nom de la vue
    // Personnel) -- voir personCellStyle(). Sur le <th> lui-même (pas le span pivoté), pour
    // garder un fond rectangulaire propre malgré la rotation du texte.
    th.style.cssText = personCellStyle(p);
    const span = document.createElement("span");
    span.textContent = personAcronym(p);
    span.title = `${p.prenom} ${p.nom}`;
    th.appendChild(span);
    headRow.appendChild(th);
    personHeaderCells.push(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (people.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty-hint";
    td.textContent = "Aucune personne ne correspond aux filtres sélectionnés.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // Semaine en cours (indépendante de state.weekOffset -- toujours "aujourd'hui", voir getMonday()),
  // pour surligner en vert la ligne correspondante (repère "on est ici" -- demandé le 21/07/2026).
  const todayMondayIso = toISODateLocal(getMonday(0));
  const weeks = quarterWeeks(congesYear, congesQuarter);

  // Regroupement visuel par mois (même principe que les blocs Scan U/Echo U du planning
  // principal, voir .group-start/.group-end dans style.css) : grosse bordure quand le mois de la
  // semaine change, rien entre deux semaines du même mois. Le mois retenu est celui du lundi.
  let prevMonthKey = null;

  weeks.forEach((monday) => {
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const isCurrentWeek = toISODateLocal(monday) === todayMondayIso;

    const monthKey = `${monday.getFullYear()}-${monday.getMonth()}`;
    const isNewMonth = prevMonthKey !== null && monthKey !== prevMonthKey;
    prevMonthKey = monthKey;

    const tr = document.createElement("tr");
    if (isNewMonth) tr.classList.add("group-start");
    const label = document.createElement("td");
    label.className = "conges-week-label" + (isCurrentWeek ? " conges-current-week" : "");
    label.textContent = `${formatShort(monday)} → ${formatShort(friday)}`;
    tr.appendChild(label);

    people.forEach((p, i) => {
      const td = document.createElement("td");
      td.className = "slot-cell conges-cell" + boundaryClass(i);
      // Congé / garde / repos de garde (RG-013) mélangés dans la même case, jour par jour -- voir
      // buildAbsenceBar() (4.8/4.9 CLAUDE.md), partagée avec le bandeau congés du planning (6.11).
      const bar = buildAbsenceBar(p, monday);
      if (bar) td.appendChild(bar);
      td.addEventListener("click", () => openCongePopover(p, monday, td));
      // Surligne l'en-tête de ligne (semaine) et de colonne (personne) au survol, pour se repérer
      // dans le tableau sans avoir à remonter des yeux jusqu'aux bords (demandé le 22/07/2026).
      td.addEventListener("mouseenter", () => {
        label.classList.add("conges-highlight");
        personHeaderCells[i].classList.add("conges-highlight");
      });
      td.addEventListener("mouseleave", () => {
        label.classList.remove("conges-highlight");
        personHeaderCells[i].classList.remove("conges-highlight");
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);

  sizeCongesRows(weeks.length);
}

// Calcule la hauteur de ligne qui fait tenir tout le trimestre (nav + en-tête + les `rowCount`
// lignes de semaine) dans la fenêtre visible, sans scroll vertical -- et la plus haute possible
// dans cette limite (demandé par Samir le 21/07/2026, plutôt qu'une valeur fixe devinée). Une
// ligne chargée (ex. 4 jours différents empilés dans une case jaune) peut malgré tout dépasser
// cette hauteur : `height` sur une <tr> est un minimum, pas un maximum, le contenu prime.
function sizeCongesRows(rowCount) {
  const container = document.getElementById("congesView");
  const table = container.querySelector(".conges-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  if (!tbody || rowCount === 0) return;

  const margin = 8; // petite marge en bas de fenêtre, pour ne pas coller au bord
  const topOffset = container.getBoundingClientRect().top;
  const headerHeight = thead.getBoundingClientRect().height;
  const available = window.innerHeight - topOffset - headerHeight - margin;
  const minRowHeight = 20; // plancher pour rester cliquable/lisible même avec beaucoup de semaines
  let rowHeight = Math.max(minRowHeight, Math.floor(available / rowCount));

  const applyHeight = (h) => {
    [...tbody.children].forEach((tr) => {
      tr.style.height = `${h}px`;
    });
  };
  applyHeight(rowHeight);

  // Ajustement empirique : bordures collapsées + arrondis font dériver le résultat de quelques
  // px, difficile à prédire précisément à l'avance -- on mesure le dépassement réel après un
  // premier passage et on corrige d'un coup plutôt que de deviner une constante.
  const overshoot = table.getBoundingClientRect().bottom - (window.innerHeight - margin);
  if (overshoot > 0 && rowHeight > minRowHeight) {
    const correction = Math.ceil(overshoot / rowCount);
    rowHeight = Math.max(minRowHeight, rowHeight - correction);
    applyHeight(rowHeight);
  }
}

let congesResizeTimer = null;
window.addEventListener("resize", () => {
  if (!editingConges) return;
  clearTimeout(congesResizeTimer);
  congesResizeTimer = setTimeout(() => renderCongesView(), 150);
});

function openCongePopover(person, monday, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderCongePopoverContent(person, monday);

  const rect = cellEl.getBoundingClientRect();
  pop.style.top = `${window.scrollY + rect.bottom + 4}px`;
  pop.style.left = `${window.scrollX + rect.left}px`;
  pop.classList.remove("hidden");
}

// Popover de la vue Congés (22/07/2026) : plus de saisie par plage de dates -- un bouton "Toute la
// semaine en congé" pour l'ajout/retrait rapide, puis deux rangées de pilules jour par jour (Congé
// / Garde, une pilule par jour ouvré de la semaine cliquée). Une pilule active (couleur pleine) se
// désactive au clic, une inactive (grise) s'active -- pas de bouton "Ajouter" séparé, chaque clic
// est immédiat. Popover élargi (`pop.style.minWidth`) pour que "Lun 13" etc. tienne sur une seule
// ligne dans chaque pilule -- remis à vide dans les 3 autres popovers de l'appli (voir leurs
// fonctions renderXxxPopoverContent), sinon la largeur resterait collée après une ouverture ici.
function renderCongePopoverContent(person, monday) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "300px";
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const weekDays = DAYS.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { iso: toISODateLocal(d), label: `${day.slice(0, 3)} ${d.getDate()}` };
  });

  // Bouton "Toute la semaine" en toggle (pas juste un ajout à sens unique) : si les 5 jours sont
  // déjà en congé, le même bouton les retire tous -- sinon il faudrait décocher les 5 pilules une
  // par une pour annuler un ajout "toute la semaine" fait par erreur (retour Samir 22/07/2026).
  const weekFullyOn = weekDays.every(({ iso }) => isOnCongeDay(person.id, iso));

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${person.prenom} ${person.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${formatShort(monday)} → ${formatShort(friday)}</span>
    <button type="button" id="congeWeekBtn" class="conge-week-btn${weekFullyOn ? " active" : ""}">${weekFullyOn ? "Retirer toute la semaine" : "Toute la semaine en congé"}</button>
    <div class="conge-pill-group">
      <div class="conge-pill-label">Congé</div>
      <div class="conge-pill-row" id="congePillRow"></div>
    </div>
    <div class="conge-pill-group">
      <div class="conge-pill-label">Garde</div>
      <div class="conge-pill-row" id="gardePillRow"></div>
    </div>
  `;

  const congeRow = document.getElementById("congePillRow");
  const gardeRow = document.getElementById("gardePillRow");

  weekDays.forEach(({ iso, label }) => {
    const congeBtn = document.createElement("button");
    congeBtn.type = "button";
    congeBtn.className = "conge-pill conge-pill-conge" + (isOnCongeDay(person.id, iso) ? " active" : "");
    congeBtn.textContent = label;
    // stopPropagation() : sans ça, le clic remonte jusqu'au gestionnaire global document (voir plus
    // bas dans le fichier) APRÈS que renderCongePopoverContent() a déjà remplacé pop.innerHTML --
    // le bouton d'origine se retrouve détaché du DOM, donc `pop.contains(e.target)` renvoie false et
    // le popover se referme tout seul juste après chaque clic. Bug réel rencontré le 22/07/2026 (le
    // popover se fermait après chaque pilule, rendant la suppression d'un congé quasi impossible).
    congeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isOnCongeDay(person.id, iso)) removeCongeDay(person.id, iso);
      else addCongeDay(person.id, iso);
      saveState();
      render();
      renderCongePopoverContent(person, monday);
    });
    congeRow.appendChild(congeBtn);

    const gardeBtn = document.createElement("button");
    gardeBtn.type = "button";
    gardeBtn.className = "conge-pill conge-pill-garde" + (isOnGardeDay(person.id, iso) ? " active" : "");
    gardeBtn.textContent = label;
    gardeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGardeDay(person.id, iso);
      saveState();
      render();
      renderCongePopoverContent(person, monday);
    });
    gardeRow.appendChild(gardeBtn);
  });

  document.getElementById("congeWeekBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (weekFullyOn) {
      weekDays.forEach(({ iso }) => removeCongeDay(person.id, iso));
    } else {
      weekDays.forEach(({ iso }) => addCongeDay(person.id, iso));
    }
    saveState();
    render();
    renderCongePopoverContent(person, monday);
  });

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

// ---------- Vue Stats (24/07/2026) ----------
// But : voir en un coup d'œil si la répartition des vacations est équitable sur la semaine
// affichée. Même structure de lignes que la vue Personnel (personMatchesFilters()/compareStaffOrder()),
// mais les colonnes Jour x Créneau sont remplacées par un total + des badges par "famille" de
// modalité, regroupés par COULEUR de spécialité (demande explicite de Samir) plutôt que par type.

const STATS_FAMILY_LABELS = { scan: "Scan", irm: "IRM", ecn: "ECN", mammo: "Mammo", bureau: "Bureau" };
const STATS_TYPE_ORDER = ["Scan", "IRM", "ECN", "Mammo", "Bureau"];

// Scan A/B, IRM 1.5T/3T et ECN 1/2 doivent être fusionnés ("on s'en fiche de savoir si c'est A ou
// B") -- réutilise le champ `group` déjà existant sur ACTIVITIES (ex. "scan-start"/"scan-end") en
// retirant son suffixe, plutôt que d'inventer un nouveau mapping. Mammo n'a pas de `group` (une
// seule modalité, pas de fusion nécessaire) -- retombe sur son id.
function activityStatsFamily(activity) {
  return activity.group ? activity.group.replace(/-(start|end)$/, "") : activity.id;
}

// Parcourt toutes les cases de la semaine donnée et compte, par personne, un badge par (famille,
// spécialité) -- Scan U/Echo U (activity.urgence) restent toujours à part, jamais fusionnés, sans
// notion de spécialité (demande explicite de Samir : "en rouge, pas flashy", voir statBadgeClass()).
// Une case fermée (RG-010) ne compte jamais : rien n'a réellement été fait dessus cette semaine-là.
// `days` (Set des jours DAYS couverts par au moins une assignation, toutes activités/créneaux
// confondus) alimente le regroupement par disponibilité de renderStatsView() (24/07/2026, voir
// statsAvailabilityTier()) -- pas juste `total`, qui ne dit rien de la répartition dans la semaine
// (5 vacations le même jour vs 1 par jour ont le même total mais pas la même disponibilité).
function computeVacationStatsForWeek(monday) {
  const stats = new Map(); // staffId -> { total, badges: Map(groupKey -> {count, label, specialite, isUrgence, activityId}), days: Set }

  state.activities.forEach((activity) => {
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return;
        const assigned = effectiveAssignedIds(key).filter(Boolean);
        if (assigned.length === 0) return;

        let groupKey, label, specialite, isUrgence;
        if (activity.urgence) {
          groupKey = `urgence:${activity.id}`;
          label = activity.nom;
          specialite = null;
          isUrgence = true;
        } else {
          const family = activityStatsFamily(activity);
          specialite = state.vacationSpecialites[vacationSpecKey(activity.id, day, creneau.id)] || null;
          groupKey = `${family}:${specialite || "none"}`;
          label = STATS_FAMILY_LABELS[family] || activity.nom;
          isUrgence = false;
        }

        assigned.forEach((staffId) => {
          if (!staffById(staffId)) return; // id orphelin (personne supprimée depuis) -- ignoré comme partout ailleurs.
          if (!stats.has(staffId)) stats.set(staffId, { total: 0, badges: new Map(), days: new Set() });
          const entry = stats.get(staffId);
          entry.total++;
          entry.days.add(day);
          if (!entry.badges.has(groupKey)) {
            entry.badges.set(groupKey, { count: 0, label, specialite, isUrgence, activityId: activity.id });
          }
          entry.badges.get(groupKey).count++;
        });
      });
    });
  });

  return stats;
}

// Regroupement par disponibilité (24/07/2026, demande de Samir) : au-delà du tri habituel
// (compareStaffOrder -- grade/spécialité/alphabétique), les lignes de la vue Stats sont d'abord
// réparties en 4 blocs :
// 0 (haut) = a des vacations mais pas tous les jours -- probablement encore de la place, à regarder
//            en priorité pour compléter le planning ;
// 1 (milieu) = aucune vacation du tout cette semaine, et PAS en congé -- vraiment libre, à solliciter ;
// 2 (bas) = postée tous les jours ouvrés -- plus de marge, pas la peine de la regarder en premier ;
// 3 (tout en bas) = en congé toute la semaine (`isFullyOnLeaveThisWeek()`) -- hors-jeu cette semaine,
//     un total à 0 ici ne veut pas dire "libre" comme pour le bloc 1, ne pas les mélanger (retour de
//     Samir le 24/07/2026 : Lucidarme, en congé toute la semaine, se retrouvait à tort au milieu avec
//     les vraies personnes disponibles). Vérifié EN PREMIER, avant le nombre de jours couverts : un
//     congé toute la semaine prime sur n'importe quel décompte de vacations (en pratique déjà 0, RG-014
//     empêchant l'assignation via la vue Personnel, mais le popover d'ajout reste une porte de sortie).
// `stats` est le résultat de computeVacationStatsForWeek(), déjà calculé une fois par rendu.
function statsAvailabilityTier(person, stats) {
  if (isFullyOnLeaveThisWeek(person)) return 3;
  const daysCount = stats.has(person.id) ? stats.get(person.id).days.size : 0;
  if (daysCount === 0) return 1;
  if (daysCount === DAYS.length) return 2;
  return 0;
}

// Ordre des badges d'une personne : le rouge (urgences, sans spécialité) toujours en premier, puis
// regroupés par COULEUR dans l'ordre canonique des spécialités (SPECIALITE_ORDER, le même partout
// ailleurs dans l'appli) -- pas par type de modalité. Demande explicite de Samir le 24/07/2026 :
// repérer d'un coup d'œil qui fait beaucoup d'une même spécialité, peu importe sur quelle modalité.
// À couleur égale, Scan avant IRM avant ECN avant Mammo (STATS_TYPE_ORDER).
function sortedStatsBadges(entry) {
  const list = [...entry.badges.values()];
  list.sort((a, b) => {
    if (a.isUrgence !== b.isUrgence) return a.isUrgence ? -1 : 1;
    if (a.isUrgence) {
      return state.activities.findIndex((x) => x.id === a.activityId) - state.activities.findIndex((x) => x.id === b.activityId);
    }
    const aIdx = a.specialite ? SPECIALITE_ORDER.indexOf(a.specialite) : SPECIALITE_ORDER.length;
    const bIdx = b.specialite ? SPECIALITE_ORDER.indexOf(b.specialite) : SPECIALITE_ORDER.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return STATS_TYPE_ORDER.indexOf(a.label) - STATS_TYPE_ORDER.indexOf(b.label);
  });
  return list;
}

// Réutilise les classes de couleur déjà existantes : .chip.spec-xxx pour une spécialité connue, le
// rouge "urgence" déjà utilisé ailleurs (.modalite-tag.urgence-tag) pour Scan U/Echo U, .spec-none
// (gris) pour une vacation sans spécialité propriétaire renseignée -- aucune nouvelle couleur créée
// pour cette vue, tout est déjà cohérent avec le reste de l'appli.
function statBadgeClass(badge) {
  if (badge.isUrgence) return "chip modalite-tag urgence-tag";
  if (!badge.specialite) return "chip spec-none";
  return `chip spec-${badge.specialite}`;
}

function renderStatsView() {
  const container = document.getElementById("statsView");
  container.innerHTML = "";

  const monday = getMonday(state.weekOffset);
  const stats = computeVacationStatsForWeek(monday);
  // Tri à deux niveaux : d'abord le bloc de disponibilité (statsAvailabilityTier(), voir plus haut),
  // puis à l'intérieur d'un bloc le tri habituel (grade/spécialité/alphabétique, comme partout ailleurs).
  const people = state.staff.filter(personMatchesFilters).sort((a, b) => {
    const tierDiff = statsAvailabilityTier(a, stats) - statsAvailabilityTier(b, stats);
    if (tierDiff !== 0) return tierDiff;
    return compareStaffOrder(a, b);
  });

  if (people.length === 0) {
    container.innerHTML = '<p class="empty-hint">Aucune personne ne correspond aux filtres sélectionnés.</p>';
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "stats-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th class="activity-cell person-name-cell">Personnel</th>
        <th class="stats-total-header">Total</th>
        <th>Vacations (${currentWeekLabel()})</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  people.forEach((person) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = `${person.prenom[0]}. ${person.nom}`;
    nameCell.title = `${person.prenom} ${person.nom}`;
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    const entry = stats.get(person.id);

    const totalCell = document.createElement("td");
    totalCell.className = "stats-total-cell";
    const totalBadge = document.createElement("span");
    totalBadge.className = "stats-total-badge";
    totalBadge.textContent = entry ? entry.total : 0;
    totalCell.appendChild(totalBadge);
    tr.appendChild(totalCell);

    const badgesCell = document.createElement("td");
    badgesCell.className = "stats-badges-cell";

    if (isFullyOnLeaveThisWeek(person)) {
      // Ligne gardée visible plutôt que masquée (contrairement au panneau Personnel, voir
      // isFullyOnLeaveThisWeek()) : un total à 0 sans explication laisserait croire à un oubli
      // plutôt qu'à une absence -- voir aussi buildAbsenceBar() pour la même logique ailleurs.
      const absence = document.createElement("span");
      absence.className = "stats-absence-label";
      absence.textContent = "Congés toute la semaine";
      badgesCell.appendChild(absence);
    } else if (!entry) {
      const empty = document.createElement("span");
      empty.className = "empty-hint";
      empty.textContent = "Aucune vacation cette semaine.";
      badgesCell.appendChild(empty);
    } else {
      sortedStatsBadges(entry).forEach((badge) => {
        const span = document.createElement("span");
        span.className = statBadgeClass(badge) + " stats-badge";
        span.textContent = `${badge.count} ${badge.label}`;
        badgesCell.appendChild(span);
      });
    }

    tr.appendChild(badgesCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// ---------- Trame Personnel (RG-017, 24/07/2026) ----------
// Sous-vue du mode "Trame" (voir trameView) : même mise en page que la vue Personnel du planning
// principal (lignes = personnel, colonnes Jour x Créneau, case = quelle(s) modalité(s)), mais lit
// et écrit dans state.trame -- un planning de BASE récurrent, indépendant de toute semaine -- et
// non dans state.assignments. Différences volontaires avec la vue Personnel réelle : pas de
// bandeau congés (n'a pas de sens sans date), pas de blocage/étiquette congé dans les cases (idem),
// pas de zone de validation (les RG de composition portent sur une semaine réelle, pas un modèle).
// Une fois posée ici, une affectation devient la valeur par défaut de la semaine actuelle et des
// semaines futures tant qu'elles n'ont pas été explicitement modifiées case par case -- voir
// effectiveAssignedIds()/ensureMaterializedAssignments() plus haut et RG-017 dans regles-gestion.md.

function trameActivitiesForPersonSlot(personId, day, creneauId) {
  return state.activities.filter((activity) => {
    const key = trameKey(activity.id, day, creneauId);
    return (state.trame[key] || []).includes(personId);
  });
}

function removeTrameAssignment(key, staffId) {
  const list = state.trame[key] || [];
  state.trame[key] = list.filter((id) => id !== staffId);
  saveState();
  render();
}

// Équivalent de buildModaliteTag() pour la trame -- pas de paramètre `draggable`, toujours vrai ici
// (contrairement à buildModaliteTag(), jamais utilisé dans un contexte non-draggable comme un popover).
function buildTrameModaliteTag(activity, key, staffId) {
  const tag = document.createElement("span");
  // RG-017 : même teinte par spécialité que buildModaliteTag() -- `key` est déjà au format
  // trameKey()/vacationSpecKey() ici (pas de weekKey à retirer), lecture directe.
  const vacSpec = state.vacationSpecialites[key];
  tag.className = "chip modalite-tag" + (activity.urgence ? " urgence-tag" : "") + (vacSpec ? ` spec-${vacSpec}` : "");
  tag.textContent = activity.nom;
  tag.draggable = true;
  tag.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", staffId);
    e.dataTransfer.setData("application/x-activity-id", activity.id);
    // Type MIME dédié (pas "application/x-source-key", utilisé par le glisser-déposer de la vraie
    // semaine) -- les deux tableaux ne sont jamais visibles en même temps (modes plein-écran
    // mutuellement exclusifs), mais autant garder les deux logiques de glisser-déposer étanches.
    e.dataTransfer.setData("application/x-trame-source-key", key);
    e.dataTransfer.effectAllowed = "move";
  });
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeTrameAssignment(key, staffId);
  });
  tag.appendChild(remove);
  return tag;
}

// Équivalent de handleModaliteDrop() pour la trame.
function handleTrameModaliteDrop(e, targetStaffId, targetDay, targetCreneauId) {
  const activityId = e.dataTransfer.getData("application/x-activity-id");
  if (!activityId) return;
  if (!isCreneauApplicable(activityId, targetCreneauId)) return; // RG-012, structurel : s'applique aussi à la trame.
  const draggedStaffId = e.dataTransfer.getData("text/plain");
  const sourceKey = e.dataTransfer.getData("application/x-trame-source-key");
  const targetKey = trameKey(activityId, targetDay, targetCreneauId);
  if (sourceKey === targetKey) return;

  if (sourceKey) {
    state.trame[sourceKey] = (state.trame[sourceKey] || []).filter((id) => id !== draggedStaffId);
  }
  if (!state.trame[targetKey]) state.trame[targetKey] = [];
  if (!state.trame[targetKey].includes(targetStaffId)) {
    state.trame[targetKey].push(targetStaffId);
  }
  saveState();
  render();
}

function openTramePersonPopover(person, day, creneau, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderTramePersonPopoverContent(person, day, creneau);

  const rect = cellEl.getBoundingClientRect();
  pop.style.top = `${window.scrollY + rect.bottom + 4}px`;
  pop.style.left = `${window.scrollX + rect.left}px`;
  pop.classList.remove("hidden");
}

// Équivalent de renderPersonPopoverContent() pour la trame -- écrit dans state.trame, pas de
// mention de semaine dans l'en-tête du popover (juste "(trame)").
function renderTramePersonPopoverContent(person, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  const assignedActivities = trameActivitiesForPersonSlot(person.id, day, creneau.id);
  const assignedIds = new Set(assignedActivities.map((a) => a.id));
  // RG-012 : le créneau "astreinte" ne propose que Scan U (voir isCreneauApplicable()).
  const available = state.activities.filter((a) => !assignedIds.has(a.id) && isCreneauApplicable(a.id, creneau.id));

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${person.prenom} ${person.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label} (trame)</span>
    <div id="popAssigned" class="popover-assigned"></div>
    <div class="popover-select" id="popCustomSelect">
      <button type="button" class="popover-select-trigger" id="popTrigger">-- Ajouter une modalité --</button>
      <div class="popover-select-list hidden" id="popList"></div>
    </div>
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (assignedActivities.length === 0) {
    assignedContainer.innerHTML = '<span class="empty-hint">Aucune modalité assignée pour l\'instant</span>';
  } else {
    assignedActivities.forEach((activity) => {
      const key = trameKey(activity.id, day, creneau.id);
      const tag = buildTrameModaliteTag(activity, key, person.id);
      tag.querySelector(".remove").addEventListener("click", () => renderTramePersonPopoverContent(person, day, creneau));
      assignedContainer.appendChild(tag);
    });
  }

  const list = document.getElementById("popList");
  if (available.length === 0) {
    list.innerHTML = '<div class="popover-select-empty">Déjà assigné à toutes les modalités.</div>';
  } else {
    available.forEach((activity) => {
      const row = document.createElement("div");
      row.className = "popover-select-option";
      row.textContent = activity.nom;
      if (activity.urgence) row.style.color = "#b91c1c";
      row.addEventListener("click", () => {
        const key = trameKey(activity.id, day, creneau.id);
        if (!state.trame[key]) state.trame[key] = [];
        if (!state.trame[key].includes(person.id)) {
          state.trame[key].push(person.id);
          saveState();
          render();
          renderTramePersonPopoverContent(person, day, creneau);
        }
      });
      list.appendChild(row);
    });
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
  document.getElementById("popTrigger").addEventListener("click", (e) => {
    e.stopPropagation();
    list.classList.toggle("hidden");
  });
}

function renderTramePersonnelView() {
  const container = document.getElementById("tramePersonnelView");
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "trame-personnel-table";

  const thead = document.createElement("thead");

  const dayRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "corner-cell";
  dayRow.appendChild(corner);
  DAYS.forEach((day) => {
    const th = document.createElement("th");
    th.colSpan = CRENEAUX.length;
    th.className = "day-header";
    const label = document.createElement("div");
    label.className = "day-header-label";
    label.textContent = day;
    th.appendChild(label);
    dayRow.appendChild(th);
  });
  thead.appendChild(dayRow);

  const creneauRow = document.createElement("tr");
  const cornerLabel = document.createElement("th");
  cornerLabel.className = "modalite-header";
  cornerLabel.textContent = "Personnel";
  creneauRow.appendChild(cornerLabel);
  DAYS.forEach(() => {
    CRENEAUX.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "creneau-header";
      creneauRow.appendChild(th);
    });
  });
  thead.appendChild(creneauRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const people = state.staff.filter(personMatchesFilters).sort(compareStaffOrder);

  people.forEach((person) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = `${person.prenom[0]}. ${person.nom}`;
    nameCell.title = `${person.prenom} ${person.nom}`;
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        const td = document.createElement("td");
        td.className = "slot-cell";

        const activitiesHere = trameActivitiesForPersonSlot(person.id, day, creneau.id);

        if (activitiesHere.length === 0) {
          const hint = document.createElement("span");
          hint.className = "empty-hint";
          hint.textContent = "+ ajouter";
          td.appendChild(hint);
        } else {
          activitiesHere.forEach((activity) => {
            const key = trameKey(activity.id, day, creneau.id);
            td.appendChild(buildTrameModaliteTag(activity, key, person.id));
          });
        }

        td.addEventListener("click", () => openTramePersonPopover(person, day, creneau, td));

        td.addEventListener("dragover", (e) => {
          e.preventDefault();
          td.classList.add("drag-over");
        });
        td.addEventListener("dragleave", () => {
          td.classList.remove("drag-over");
        });
        td.addEventListener("drop", (e) => {
          e.preventDefault();
          td.classList.remove("drag-over");
          handleTrameModaliteDrop(e, person.id, day, creneau.id);
        });

        tr.appendChild(td);
      });
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// ---------- Assignation ----------

function removeAssignment(key, staffId) {
  // RG-017 : part de effectiveAssignedIds() (pas state.assignments[key] || []) pour retirer
  // correctement une personne venue de la trame -- l'écriture juste après matérialise la case
  // (tableau explicite, potentiellement plus petit) pour cette semaine précise.
  const list = effectiveAssignedIds(key);
  state.assignments[key] = list.filter((id) => id !== staffId);
  saveState();
  render();
}

function openAssignPopover(key, cellEl, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  renderPopoverContent(key, activity, day, creneau);

  const rect = cellEl.getBoundingClientRect();
  pop.style.top = `${window.scrollY + rect.bottom + 4}px`;
  pop.style.left = `${window.scrollX + rect.left}px`;
  pop.classList.remove("hidden");
}

function renderPopoverContent(key, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  const assigned = effectiveAssignedIds(key); // RG-017 : peut venir de la trame si jamais touchée cette semaine.
  const available = state.staff.filter((s) => !assigned.includes(s.id)).sort(compareStaffOrder);

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${activity.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label}</span>
    <div id="popAssigned" class="popover-assigned"></div>
    <div class="popover-select" id="popCustomSelect">
      <button type="button" class="popover-select-trigger" id="popTrigger">-- Ajouter une personne --</button>
      <div class="popover-select-list hidden" id="popList"></div>
    </div>
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (assigned.length === 0) {
    assignedContainer.innerHTML = '<span class="empty-hint">Personne assignée pour l\'instant</span>';
  } else {
    assigned.forEach((staffId) => {
      const person = staffById(staffId);
      if (!person) return;
      const chip = document.createElement("span");
      applyChipVisual(chip, person);
      chip.textContent = `${person.prenom[0]}. ${person.nom}`;
      const remove = document.createElement("span");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "Retirer";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        removeAssignment(key, staffId);
        renderPopoverContent(key, activity, day, creneau);
      });
      chip.appendChild(remove);
      assignedContainer.appendChild(chip);
    });
  }

  const list = document.getElementById("popList");
  if (available.length === 0) {
    list.innerHTML = '<div class="popover-select-empty">Tout le monde est déjà assigné.</div>';
  } else {
    available.forEach((person) => {
      const row = document.createElement("div");
      row.className = "popover-select-option";
      const { html, style } = personOptionRow(person);
      row.innerHTML = html;
      row.style.cssText += style;
      row.addEventListener("click", () => {
        const assignedList = ensureMaterializedAssignments(key); // RG-017 : matérialise (depuis la trame si besoin) avant d'ajouter.
        if (!assignedList.includes(person.id)) assignedList.push(person.id);
        saveState();
        render();
        renderPopoverContent(key, activity, day, creneau);
      });
      list.appendChild(row);
    });
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
  document.getElementById("popTrigger").addEventListener("click", (e) => {
    e.stopPropagation();
    list.classList.toggle("hidden");
  });
}

// Popover symétrique pour la vue Personnel : personne + créneau fixés, on choisit la modalité.
function openPersonAssignPopover(person, day, creneau, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderPersonPopoverContent(person, day, creneau);

  const rect = cellEl.getBoundingClientRect();
  pop.style.top = `${window.scrollY + rect.bottom + 4}px`;
  pop.style.left = `${window.scrollX + rect.left}px`;
  pop.classList.remove("hidden");
}

function renderPersonPopoverContent(person, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  const assignedActivities = activitiesForPersonSlot(person.id, day, creneau.id);
  const assignedIds = new Set(assignedActivities.map((a) => a.id));
  // RG-012 : le créneau "astreinte" ne propose que Scan U (voir isCreneauApplicable()).
  const available = state.activities.filter((a) => !assignedIds.has(a.id) && isCreneauApplicable(a.id, creneau.id));

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${person.prenom} ${person.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label}</span>
    <div id="popAssigned" class="popover-assigned"></div>
    <div class="popover-select" id="popCustomSelect">
      <button type="button" class="popover-select-trigger" id="popTrigger">-- Ajouter une modalité --</button>
      <div class="popover-select-list hidden" id="popList"></div>
    </div>
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (assignedActivities.length === 0) {
    assignedContainer.innerHTML = '<span class="empty-hint">Aucune modalité assignée pour l\'instant</span>';
  } else {
    assignedActivities.forEach((activity) => {
      const key = cellKey(activity.id, day, creneau.id);
      const tag = buildModaliteTag(activity, key, person.id);
      tag.querySelector(".remove").addEventListener("click", () => renderPersonPopoverContent(person, day, creneau));
      assignedContainer.appendChild(tag);
    });
  }

  const list = document.getElementById("popList");
  if (available.length === 0) {
    list.innerHTML = '<div class="popover-select-empty">Déjà assigné à toutes les modalités.</div>';
  } else {
    available.forEach((activity) => {
      const row = document.createElement("div");
      row.className = "popover-select-option";
      row.textContent = activity.nom;
      if (activity.urgence) row.style.color = "#b91c1c";
      row.addEventListener("click", () => {
        const key = cellKey(activity.id, day, creneau.id);
        const assignedList = ensureMaterializedAssignments(key); // RG-017 : matérialise (depuis la trame si besoin) avant d'ajouter.
        if (!assignedList.includes(person.id)) {
          assignedList.push(person.id);
          saveState();
          render();
          renderPersonPopoverContent(person, day, creneau);
        }
      });
      list.appendChild(row);
    });
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
  document.getElementById("popTrigger").addEventListener("click", (e) => {
    e.stopPropagation();
    list.classList.toggle("hidden");
  });
}

document.addEventListener("click", (e) => {
  const pop = document.getElementById("assignPopover");
  if (!pop.contains(e.target) && !e.target.closest(".slot-cell")) {
    pop.classList.add("hidden");
  }
  const list = document.getElementById("popList");
  if (list && !list.classList.contains("hidden") && !e.target.closest("#popCustomSelect")) {
    list.classList.add("hidden");
  }
  // Menu "⚙" (Synchro GitHub / Export / Import / Réinitialiser, 23/07/2026) : se ferme au clic
  // extérieur, comme les autres menus/popovers de l'appli.
  const moreMenu = document.getElementById("moreMenu");
  if (moreMenu && !moreMenu.classList.contains("hidden") && !e.target.closest(".more-menu-wrap")) {
    moreMenu.classList.add("hidden");
  }
});

// Bouton "⚙" : ouvre/ferme le menu. Chaque action à l'intérieur (Synchro GitHub, Export, Import,
// Réinitialiser) referme le menu après coup -- écouteur additionnel, ne remplace pas les handlers
// propres à chaque bouton (déjà câblés ailleurs), juste une fermeture en plus.
document.getElementById("btnMoreMenu").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("moreMenu").classList.toggle("hidden");
});
document.getElementById("moreMenu").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") {
    document.getElementById("moreMenu").classList.add("hidden");
  }
});

// ---------- Navigation semaine ----------

document.getElementById("prevWeek").addEventListener("click", () => {
  state.weekOffset -= 1;
  saveState();
  render();
});
document.getElementById("nextWeek").addEventListener("click", () => {
  state.weekOffset += 1;
  saveState();
  render();
});
// Revient à la semaine en cours (weekOffset 0) -- utile pour se retrouver après avoir navigué
// loin dans le temps. Toujours visible dans la topbar (partagée par toutes les vues, 22/07/2026) :
// pas besoin de logique par vue, weekOffset est déjà consulté partout où la semaine affichée compte.
document.getElementById("btnCurrentWeek").addEventListener("click", () => {
  state.weekOffset = 0;
  saveState();
  render();
});

// ---------- Export / Import / Reset ----------

document.getElementById("btnExport").addEventListener("click", () => {
  // buildPersistedState() -- exactement ce qui est écrit dans le fichier partagé (staff, congés,
  // gardes, etc., + schemaVersion), jamais `state` brut (qui contiendrait aussi `activities`,
  // piloté par le code). Utile pour une sauvegarde ponctuelle avant une migration de version.
  const blob = new Blob([JSON.stringify(buildPersistedState(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `planning-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnImport").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      applyPersistedState(parsed); // passe par la migration -- accepte aussi bien un export récent qu'un vieux fichier antérieur au versionnement.
      saveState();
      render();
    } catch (err) {
      alert("Fichier JSON invalide : " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("btnReset").addEventListener("click", () => {
  // Ne touche plus au personnel (devenu une vraie donnée éditée à la main) : uniquement le planning.
  // RG-017 (24/07/2026) : depuis la Trame Personnel, vider state.assignments ne suffit plus à tout
  // effacer visuellement -- les cases jamais touchées cette semaine retombent automatiquement sur
  // la trame (effectiveAssignedIds()), donc réapparaissent aussitôt après ce reset. Confirmé avec
  // Samir le 24/07/2026 que c'est le comportement VOULU (pas un bug) : seul un retrait manuel (×)
  // découple une case précise de la trame. Le texte de confirmation l'explique maintenant
  // explicitement, pour ne plus laisser croire à un reset cassé.
  if (!confirm("Réinitialiser le planning ? Toutes les affectations posées à la main (qui est posté où) et les fermetures de la semaine seront supprimées. Les cases qui suivent la Trame Personnel réapparaîtront automatiquement (retire-les à la main, avec le ×, si tu ne veux pas qu'elles reviennent). Le personnel et les spécialités de vacation ne sont pas concernés.")) return;
  state.assignments = {};
  state.fermetures = {};
  saveState();
  render();
});

// ---------- Gestion Personnel ----------

function generateStaffId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function specialiteOptionsHtml() {
  return Object.entries(SPECIALITES)
    .map(([key, spec]) => `<option value="${key}">${spec.label}</option>`)
    .join("");
}

function openStaffModal() {
  document.getElementById("staffModal").classList.remove("hidden");
  renderStaffModal();
}

function closeStaffModal() {
  document.getElementById("staffModal").classList.add("hidden");
}

function renderStaffModal() {
  const body = document.getElementById("staffModalBody");
  body.innerHTML = `
    <div class="staff-modal-actions">
      <button type="button" id="btnOpenStaffForm" class="btn-primary">+ Ajouter un membre</button>
      <button type="button" id="btnOpenBulkImport" class="btn-primary btn-outline">Importer en masse</button>
    </div>
    <div id="staffFormContainer"></div>
    <div id="bulkImportContainer"></div>
    <div id="staffModalList"></div>
  `;
  document.getElementById("btnOpenStaffForm").addEventListener("click", () => {
    document.getElementById("bulkImportContainer").innerHTML = "";
    renderStaffAddForm(document.getElementById("staffFormContainer"));
  });
  document.getElementById("btnOpenBulkImport").addEventListener("click", () => {
    document.getElementById("staffFormContainer").innerHTML = "";
    renderBulkImportForm(document.getElementById("bulkImportContainer"));
  });
  renderStaffModalList(document.getElementById("staffModalList"));
}

function renderStaffModalList(container) {
  container.innerHTML = "";
  const normal = state.staff.filter((p) => !p.horsSisu);
  const seniors = normal.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
  const internes = normal.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);
  // RG-016 (23/07/2026) : à part, jamais mélangées aux séniors/internes -- pas forcément de grade,
  // triées alphabétiquement (voir regles-gestion.md).
  const horsSisu = state.staff.filter((p) => p.horsSisu).sort(compareNomPrenom);

  const addSection = (label, people) => {
    if (people.length === 0) return;
    const h = document.createElement("div");
    h.className = "staff-modal-section";
    h.textContent = `${label} (${people.length})`;
    container.appendChild(h);

    people.forEach((person) => {
      const row = document.createElement("div");
      row.className = "staff-modal-row";

      const chip = document.createElement("span");
      applyChipVisual(chip, person);
      chip.textContent = `${person.prenom} ${person.nom}`;
      row.appendChild(chip);

      const specs = orderedSpecialites(person);
      const specLabel = specs.length
        ? specs.map((s) => SPECIALITES[s].label).join(" + ")
        : person.horsSisu ? "" : person.grade === "senior" ? "" : "Socle";
      const specSpan = document.createElement("span");
      specSpan.className = "staff-modal-spec";
      specSpan.textContent = specLabel;
      row.appendChild(specSpan);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "staff-modal-edit";
      editBtn.textContent = "Modifier";
      editBtn.addEventListener("click", () => {
        document.getElementById("bulkImportContainer").innerHTML = "";
        const formContainer = document.getElementById("staffFormContainer");
        renderStaffAddForm(formContainer, person);
        formContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      row.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "staff-modal-delete";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => deleteStaffMember(person.id));
      row.appendChild(delBtn);

      container.appendChild(row);
    });
  };

  addSection("Séniors", seniors);
  addSection("Internes", internes);
  addSection("Hors Sisu", horsSisu);

  if (state.staff.length === 0) {
    const empty = document.createElement("div");
    empty.className = "staff-modal-empty";
    empty.textContent = "Aucun membre pour l'instant.";
    container.appendChild(empty);
  }
}

function deleteStaffMember(personId) {
  const person = staffById(personId);
  if (!person) return;
  if (!confirm(`Retirer ${person.prenom} ${person.nom} du personnel ? Ses éventuelles assignations existantes seront simplement masquées, pas supprimées.`)) return;
  state.staff = state.staff.filter((p) => p.id !== personId);
  saveState();
  render();
  renderStaffModalList(document.getElementById("staffModalList"));
}

// Comme specialiteOptionsHtml(), avec une option vide en tête -- réservé au formulaire Hors Sisu
// (23/07/2026, RG-016), où une spécialité n'est jamais obligatoire. Fonction à part plutôt que de
// modifier specialiteOptionsHtml() elle-même, qui reste utilisée ici pour le cas normal (senior/
// interne) où le premier vrai choix doit rester présélectionné par défaut.
function specialiteOptionsHtmlWithNone() {
  return `<option value="">Aucune</option>${specialiteOptionsHtml()}`;
}

// existingPerson non fourni -> mode "ajouter". Fourni -> mode "modifier" (formulaire pré-rempli,
// mise à jour en place au lieu d'un push).
function renderStaffAddForm(container, existingPerson = null) {
  const specs = existingPerson ? orderedSpecialites(existingPerson) : [];
  const initialHorsSisu = existingPerson ? !!existingPerson.horsSisu : false;
  const initialGrade = existingPerson ? existingPerson.grade || "" : "senior";
  const initialType = specs.length === 2 ? "specialise" : "socle";

  container.innerHTML = `
    <div class="staff-form">
      <h3>${existingPerson ? "Modifier un membre" : "Ajouter un membre"}</h3>
      <div class="form-row">
        <label for="formPrenom">Prénom</label>
        <input type="text" id="formPrenom" autocomplete="off">
      </div>
      <div class="form-row">
        <label for="formNom">Nom</label>
        <input type="text" id="formNom" autocomplete="off">
      </div>
      <div class="form-row form-row-checkbox">
        <label for="formHorsSisu"><input type="checkbox" id="formHorsSisu"> Hors Sisu</label>
        <span class="form-hint">Personne à suivre (congés, gardes...) mais jamais postée sur une vacation -- grade et spécialité(s) deviennent optionnels.</span>
      </div>
      <div class="form-row" id="formGradeRow">
        <label for="formGrade">Grade</label>
        <select id="formGrade">
          <option value="">Non renseigné</option>
          <option value="senior">Sénior</option>
          <option value="interne">Interne</option>
        </select>
      </div>
      <div class="form-row" id="formInterneTypeRow">
        <label for="formInterneType">Statut</label>
        <select id="formInterneType">
          <option value="socle">Socle (pas encore de spécialité)</option>
          <option value="specialise">Spécialisé (2 spécialités)</option>
        </select>
      </div>
      <div class="form-row" id="formSpec1Row">
        <label id="formSpec1Label" for="formSpec1">Spécialité</label>
        <select id="formSpec1">${specialiteOptionsHtml()}</select>
      </div>
      <div class="form-row" id="formSpec2Row">
        <label id="formSpec2Label" for="formSpec2">2e spécialité</label>
        <select id="formSpec2">${specialiteOptionsHtml()}</select>
      </div>
      <div class="form-actions">
        <button type="button" id="formSubmit">${existingPerson ? "Enregistrer" : "Ajouter"}</button>
        <button type="button" id="formCancel">Annuler</button>
      </div>
      <div class="form-error" id="formError"></div>
    </div>
  `;

  const horsSisuCheckbox = document.getElementById("formHorsSisu");
  const gradeSelect = document.getElementById("formGrade");
  const typeSelect = document.getElementById("formInterneType");
  const spec1Select = document.getElementById("formSpec1");
  const spec2Select = document.getElementById("formSpec2");

  horsSisuCheckbox.checked = initialHorsSisu;

  if (existingPerson) {
    document.getElementById("formPrenom").value = existingPerson.prenom;
    document.getElementById("formNom").value = existingPerson.nom;
    gradeSelect.value = initialGrade;
    typeSelect.value = initialType;
    if (initialHorsSisu) {
      // Formulaire Hors Sisu : les 2 selects deviennent "Aucune"/spécialité 1/spécialité 2 sans
      // contrainte -- reconstruits avec l'option vide avant d'y remettre les valeurs existantes.
      spec1Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec2Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec1Select.value = specs[0] || "";
      spec2Select.value = specs[1] || "";
    } else {
      if (specs[0]) spec1Select.value = specs[0];
      spec2Select.value = specs[1] || (specs[0] === "uro" ? "digestif" : "uro");
    }
  } else {
    gradeSelect.value = "senior";
    spec2Select.selectedIndex = 1; // évite spé1 = spé2 par défaut
  }

  const updateVisibility = () => {
    const horsSisu = horsSisuCheckbox.checked;
    document.getElementById("formGradeRow").style.display = "flex"; // toujours visible (juste plus obligatoire si Hors Sisu)

    if (horsSisu) {
      // Pas de notion de "socle"/"spécialisé" pour Hors Sisu -- les 2 spécialités sont montrées
      // directement, chacune optionnelle (option "Aucune" en tête, voir specialiteOptionsHtmlWithNone()).
      document.getElementById("formInterneTypeRow").style.display = "none";
      document.getElementById("formSpec1Row").style.display = "flex";
      document.getElementById("formSpec2Row").style.display = "flex";
      document.getElementById("formSpec1Label").textContent = "Spécialité (optionnel)";
      document.getElementById("formSpec2Label").textContent = "2e spécialité (optionnel)";
      return;
    }

    const isInterne = gradeSelect.value === "interne";
    document.getElementById("formInterneTypeRow").style.display = isInterne ? "flex" : "none";
    const isSpecialise = !isInterne || typeSelect.value === "specialise";
    document.getElementById("formSpec1Row").style.display = isSpecialise ? "flex" : "none";
    document.getElementById("formSpec2Row").style.display = isInterne && isSpecialise ? "flex" : "none";
    document.getElementById("formSpec1Label").textContent = isInterne ? "1ère spécialité" : "Spécialité";
    document.getElementById("formSpec2Label").textContent = "2e spécialité";
  };
  gradeSelect.addEventListener("change", updateVisibility);
  typeSelect.addEventListener("change", updateVisibility);
  horsSisuCheckbox.addEventListener("change", () => {
    // Bascule vers les selects "avec option vide" (ou l'inverse) -- reconstruit les <option> plutôt
    // que de juste changer la visibilité, pour que "Aucune" existe seulement quand pertinent.
    if (horsSisuCheckbox.checked) {
      spec1Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec2Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec1Select.value = "";
      spec2Select.value = "";
      gradeSelect.value = "";
    } else {
      spec1Select.innerHTML = specialiteOptionsHtml();
      spec2Select.innerHTML = specialiteOptionsHtml();
      spec2Select.selectedIndex = 1;
      gradeSelect.value = "senior";
    }
    updateVisibility();
  });
  updateVisibility();

  document.getElementById("formCancel").addEventListener("click", () => {
    container.innerHTML = "";
  });

  document.getElementById("formSubmit").addEventListener("click", () => {
    const prenom = document.getElementById("formPrenom").value.trim();
    const nom = document.getElementById("formNom").value.trim();
    const horsSisu = horsSisuCheckbox.checked;
    const errorEl = document.getElementById("formError");
    errorEl.textContent = "";

    if (!prenom || !nom) {
      errorEl.textContent = "Le prénom et le nom sont obligatoires.";
      return;
    }

    let grade;
    let specialites = [];

    if (horsSisu) {
      // RG-016 : tout devient optionnel -- grade libre (y compris non renseigné), 0 à 2 spécialités
      // sans contrainte de correspondance avec le grade.
      grade = gradeSelect.value || null;
      const s1 = spec1Select.value || null;
      const s2 = spec2Select.value || null;
      if (s1 && s2 && s1 === s2) {
        errorEl.textContent = "Les deux spécialités doivent être différentes.";
        return;
      }
      specialites = [s1, s2].filter(Boolean);
    } else {
      grade = gradeSelect.value;
      if (!grade) {
        errorEl.textContent = "Le grade est obligatoire (sauf pour une personne \"Hors Sisu\").";
        return;
      }
      const isInterne = grade === "interne";
      if (!isInterne) {
        specialites = [spec1Select.value];
      } else if (typeSelect.value === "specialise") {
        const s1 = spec1Select.value;
        const s2 = spec2Select.value;
        if (s1 === s2) {
          errorEl.textContent = "Les deux spécialités doivent être différentes.";
          return;
        }
        specialites = [s1, s2];
      }
    }

    if (existingPerson) {
      existingPerson.prenom = prenom;
      existingPerson.nom = nom;
      existingPerson.horsSisu = horsSisu;
      existingPerson.grade = grade;
      existingPerson.specialites = specialites;
    } else {
      state.staff.push({ id: generateStaffId(), prenom, nom, horsSisu, grade, specialites });
    }
    saveState();
    render();
    renderStaffModalList(document.getElementById("staffModalList"));
    container.innerHTML = "";
  });
}

function renderBulkImportForm(container) {
  container.innerHTML = `
    <div class="staff-form">
      <h3>Import en masse</h3>
      <p class="bulk-hint">Colle un texte structuré : un en-tête de grade ("Seniors" / "Internes"), puis des en-têtes de spécialité ("Dig", "Uro"...), puis une personne par ligne. Le reste (statut, remarques entre parenthèses...) est ignoré automatiquement.</p>
      <textarea id="bulkText" rows="10" placeholder="Seniors&#10;&#10;Dig&#10;Prénom Nom (...)"></textarea>
      <div class="form-actions">
        <button type="button" id="bulkAnalyze">Analyser</button>
        <button type="button" id="bulkCancel">Annuler</button>
      </div>
      <div id="bulkPreview"></div>
    </div>
  `;

  document.getElementById("bulkCancel").addEventListener("click", () => {
    container.innerHTML = "";
  });
  document.getElementById("bulkAnalyze").addEventListener("click", () => {
    const parseResult = parseBulkStaffText(document.getElementById("bulkText").value);
    renderBulkPreview(document.getElementById("bulkPreview"), parseResult);
  });
}

function renderBulkPreview(container, parseResult) {
  const { results, ignored } = parseResult;
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML = '<p class="bulk-hint">Aucune personne détectée dans ce texte.</p>';
    return;
  }

  const list = document.createElement("div");
  list.className = "bulk-preview-list";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn-primary";

  const updateConfirmLabel = () => {
    const n = results.filter((r) => r.include).length;
    confirmBtn.textContent = `Confirmer l'import (${n})`;
    confirmBtn.disabled = n === 0;
  };

  results.forEach((r) => {
    const row = document.createElement("label");
    row.className = "bulk-preview-row" + (r.duplicate ? " bulk-preview-duplicate" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = r.include;
    cb.addEventListener("change", () => {
      r.include = cb.checked;
      updateConfirmLabel();
    });
    row.appendChild(cb);

    const chip = document.createElement("span");
    applyChipVisual(chip, { grade: r.grade, specialites: r.specialites });
    chip.textContent = `${r.prenom} ${r.nom}`;
    row.appendChild(chip);

    // RG-016 : un grade absent (personne Hors Sisu sans grade renseigné) n'est ni "Sénior" ni
    // "Interne" -- éviter de retomber sur "Interne" par défaut (trompeur, voir même piège déjà
    // corrigé dans renderStaffPerson()).
    const gradeLabel = r.grade === "senior" ? "Sénior" : r.grade === "interne" ? "Interne" : "Hors Sisu";
    const specLabel = r.specialites.length
      ? r.specialites.map((s) => SPECIALITES[s].label).join(" + ")
      : r.grade === "interne"
      ? "Socle"
      : r.grade === "senior"
      ? "spécialité non détectée"
      : "";
    const horsSisuSuffix = r.horsSisu && r.grade ? " · Hors Sisu" : ""; // grade absent -> déjà dit par gradeLabel, pas de doublon
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = `${gradeLabel}${specLabel ? " — " + specLabel : ""}${horsSisuSuffix}${r.duplicate ? " · déjà existant" : ""}`;
    row.appendChild(info);

    list.appendChild(row);
  });

  container.appendChild(list);

  if (ignored.length > 0) {
    const details = document.createElement("details");
    details.className = "bulk-ignored";
    const summary = document.createElement("summary");
    summary.textContent = `${plural(ignored.length, "ligne")} non reconnue${ignored.length > 1 ? "s" : ""}`;
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = ignored.join("\n");
    details.appendChild(pre);
    container.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    results
      .filter((r) => r.include)
      .forEach((r) => {
        state.staff.push({ id: generateStaffId(), prenom: r.prenom, nom: r.nom, grade: r.grade, specialites: r.specialites, horsSisu: !!r.horsSisu });
      });
    saveState();
    render();
    renderStaffModalList(document.getElementById("staffModalList"));
    document.getElementById("bulkImportContainer").innerHTML = "";
  });
  container.appendChild(confirmBtn);
}

document.getElementById("btnManageStaff").addEventListener("click", openStaffModal);
document.getElementById("staffModalClose").addEventListener("click", closeStaffModal);
document.getElementById("staffModal").addEventListener("click", (e) => {
  if (e.target.id === "staffModal") closeStaffModal();
});

// Les trois modes plein-écran (Trame / Congés / Stats) remplacent tous le contenu principal (voir
// render()) : mutuellement exclusifs, activer l'un désactive les deux autres.
// resetFullScreenModeButtons() factorise la remise à zéro du texte/état des boutons non concernés
// (ajouté le 24/07/2026 avec Stats -- avant, dupliqué à la main dans chaque handler pour 2 boutons).
function resetFullScreenModeButtons(exceptId) {
  [
    { id: "btnTrame", label: "Trame" },
    { id: "btnConges", label: "Congés" },
    { id: "btnStats", label: "Stats" },
  ].forEach(({ id, label }) => {
    if (id === exceptId) return;
    const btn = document.getElementById(id);
    btn.textContent = label;
    btn.classList.remove("btn-active");
  });
}

// RG-017 (24/07/2026) : "Trame" remplace l'ancien bouton isolé "Spécialités Vacations", déplacé à
// côté d'"Aujourd'hui" -- regroupe désormais 2 sous-vues (voir trameView, sous-onglets #trameSubNav
// dans index.html). Chaque OUVERTURE du mode retombe sur "Trame Personnel" par défaut (demande de
// Samir le 24/07/2026) -- pas de mémorisation du dernier onglet utilisé, contrairement au 1er jet.
document.getElementById("btnTrame").addEventListener("click", () => {
  editingTrame = !editingTrame;
  if (editingTrame) { editingConges = false; editingStats = false; trameView = "personnel"; }
  const btn = document.getElementById("btnTrame");
  btn.textContent = editingTrame ? "← Retour au planning" : "Trame";
  btn.classList.toggle("btn-active", editingTrame);
  resetFullScreenModeButtons("btnTrame");
  render();
});

document.querySelectorAll(".trame-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    trameView = tabBtn.dataset.trameView;
    render();
  });
});

document.getElementById("btnConges").addEventListener("click", () => {
  editingConges = !editingConges;
  if (editingConges) { editingTrame = false; editingStats = false; }
  const btn = document.getElementById("btnConges");
  btn.textContent = editingConges ? "← Retour au planning" : "Congés";
  btn.classList.toggle("btn-active", editingConges);
  resetFullScreenModeButtons("btnConges");
  render();
});

document.getElementById("btnStats").addEventListener("click", () => {
  editingStats = !editingStats;
  if (editingStats) { editingTrame = false; editingConges = false; }
  const btn = document.getElementById("btnStats");
  btn.textContent = editingStats ? "← Retour au planning" : "Stats";
  btn.classList.toggle("btn-active", editingStats);
  resetFullScreenModeButtons("btnStats");
  render();
});

// ---------- Fichier partagé : câblage des boutons ----------

document.getElementById("btnFileSync").addEventListener("click", openFileSyncModal);
document.getElementById("fileSyncModalClose").addEventListener("click", closeFileSyncModal);
document.getElementById("fileSyncModal").addEventListener("click", (e) => {
  if (e.target.id === "fileSyncModal") closeFileSyncModal();
});

// ---------- Import extract ARI (absences), 23/07/2026 ----------
// ARI est le vrai logiciel de planning de l'hôpital (pas d'accès direct, aucune RG codée dedans) --
// Samir y recopie à la main ce qu'il construit ici. Cet import fait le chemin inverse pour UNE
// seule chose : récupérer les congés annuels et gardes déjà connus côté ARI (via son onglet
// "Absences"), pour ne pas avoir à les ressaisir à la main dans cet outil.
//
// Robustesse volontaire face à un futur fichier "pas pile poil le même" (demande explicite de
// Samir, qui ne sera pas toujours là pour corriger) :
// - Les colonnes sont retrouvées par MOT-CLÉ dans l'en-tête (pas par position fixe) -- résiste à un
//   réordonnancement de colonnes par un futur export ARI.
// - Le nom "Prénom Nom" d'ARI est en réalité incohérent (parfois "NOM Prénom" en majuscules, parfois
//   "Prénom Nom" en casse normale, espaces parasites) -- la comparaison se fait par ENSEMBLE de mots
//   normalisés (accents retirés, casse ignorée), insensible à l'ordre.
// - Un nom qui ne correspond à personne EXACTEMENT est comparé par distance d'édition (Levenshtein)
//   à tout le personnel connu ; une correspondance proche (typo, accent manquant non résolu par la
//   normalisation) est proposée à la confirmation plutôt qu'appliquée silencieusement ou ignorée.

// Distance de Levenshtein classique (nombre minimal d'insertions/suppressions/substitutions pour
// passer d'une chaîne à l'autre) -- utilisée uniquement pour détecter les noms "proches mais mal
// écrits", jamais pour une correspondance exacte (voir tokenSetsEqual()).
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Normalise une chaîne pour comparaison de noms : accents retirés/casse ignorée via normalizeToken()
// (déjà utilisée par le parseur d'import en masse, voir plus haut) + ponctuation/chiffres remplacés
// par des espaces (garde les tirets, significatifs dans les prénoms/noms composés).
function normalizeAriToken(s) {
  return normalizeToken(s || "")
    .replace(/[^a-z\s-]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Ensemble de mots normalisés (espace ET tiret comme séparateurs) -- rend la comparaison insensible
// à l'ordre "NOM Prénom" vs "Prénom Nom" ET à la présence/absence de tiret (Jean-Paul / Jean Paul).
function ariNameTokenSet(s) {
  return new Set(normalizeAriToken(s).split(/[\s-]+/).filter(Boolean));
}

function tokenSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

// Nombre de mots qui diffèrent entre deux ensembles (dans un sens ou dans l'autre) -- contrairement
// à une distance de Levenshtein sur la chaîne entière, un mot ENTIER en trop (ex. nom de mariage/
// double nom de famille : "HUYNH CHARLIER Isabelle" vs "Isabelle Huynh") ne coûte qu'1 ici, pas la
// longueur du mot en caractères -- retrouvé le 23/07/2026 après un vrai cas manqué par la seule
// distance de Levenshtein (trop chère pour un mot ajouté, même si la personne est évidemment la même).
function tokenSetDiffSize(a, b) {
  let diff = 0;
  for (const t of a) if (!b.has(t)) diff++;
  for (const t of b) if (!a.has(t)) diff++;
  return diff;
}

// Cherche la personne de state.staff correspondant à un nom brut venu d'ARI. "exact" = mêmes mots,
// peu importe l'ordre/la casse/les accents/les tirets. "fuzzy" = rien d'exact mais une personne est
// assez proche pour être proposée à confirmation -- soit par mot(s) entier(s) en trop/manquant(s)
// (nom de mariage, second nom de famille...), soit par une petite distance d'édition classique
// (typo). "none" = rien d'assez proche, ignoré silencieusement (juste listé pour information).
function matchAriNameToStaff(ariRawName) {
  const ariTokens = ariNameTokenSet(ariRawName);
  if (ariTokens.size === 0) return { status: "none" };

  for (const person of state.staff) {
    if (tokenSetsEqual(ariTokens, ariNameTokenSet(`${person.prenom} ${person.nom}`))) {
      return { status: "exact", person };
    }
  }

  const ariSorted = [...ariTokens].sort().join(" ");
  let best = null;
  state.staff.forEach((person) => {
    const personTokens = ariNameTokenSet(`${person.prenom} ${person.nom}`);
    const tokenDiff = tokenSetDiffSize(ariTokens, personTokens);
    const charDist = levenshteinDistance(ariSorted, [...personTokens].sort().join(" "));
    // Le raccourci "mot(s) entier(s) en trop/manquant(s)" n'est fiable que si les DEUX noms ont au
    // moins 2 mots distincts -- sinon un nom réduit à un seul mot unique (ex. doublon prénom/nom
    // "Virginie Virginie", une erreur de saisie déjà présente dans le personnel) matcherait à tort
    // n'importe quel nom ARI contenant ce seul mot. Faux positif réel trouvé en testant le
    // 23/07/2026 ("Guyenne Virginie" matchait "Virginie Virginie") -- corrigé par ce garde-fou.
    const minTokenCount = Math.min(ariTokens.size, personTokens.size);
    const tokenScore = minTokenCount >= 2 ? tokenDiff * 2 : Infinity;
    // Un mot entier en trop/manquant compte pour 2 points de "distance équivalente" (arbitraire mais
    // volontairement moins cher qu'un mot de 6+ lettres en Levenshtein) -- le score retenu est le
    // meilleur des deux angles, pour capter aussi bien un mot ajouté qu'une simple faute de frappe.
    const score = Math.min(tokenScore, charDist);
    if (!best || score < best.score) best = { person, score, tokenDiff, charDist };
  });
  if (best && best.score <= 2) return { status: "fuzzy", person: best.person, distance: best.charDist, tokenDiff: best.tokenDiff };
  return { status: "none" };
}

function ariStripHtmlTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

// Convertit une date au format ARI "JJ/MM/AAAA" vers le format interne "AAAA-MM-JJ".
function ariDateToIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Retrouve une colonne par mot-clé dans la ligne d'en-tête plutôt que par position fixe -- résiste
// à un futur export ARI qui réordonnerait ses colonnes (demande explicite de Samir).
function findAriColumn(headerRow, keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeAriToken(String(headerRow[i] || ""));
    if (keywords.every((kw) => norm.includes(kw))) return i;
  }
  return -1;
}

// Lit le classeur ARI (déjà parsé par SheetJS) et n'extrait QUE ce qui intéresse Samir : congés
// annuels et repos de garde (voir CLAUDE.md/regles-gestion.md) -- les autres types d'absence
// (formation, réunion, "autre motif"...) rencontrés dans l'export réel sont ignorés volontairement.
function parseAriWorkbook(workbook) {
  const sheetName = workbook.SheetNames.find((n) => /absence/i.test(n)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { conges: [], gardes: [], error: "Aucune feuille lisible dans ce fichier." };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return { conges: [], gardes: [], error: `La feuille "${sheetName}" est vide.` };

  const header = rows[0];
  const typeCol = findAriColumn(header, ["type"]);
  const debutCol = findAriColumn(header, ["commenc"]);
  const finCol = findAriColumn(header, ["termine"]);
  const nomCol = findAriColumn(header, ["nom"]);
  if (typeCol === -1 || debutCol === -1 || finCol === -1 || nomCol === -1) {
    return { conges: [], gardes: [], error: `Colonnes attendues introuvables dans la feuille "${sheetName}" -- structure du fichier trop différente de celle prévue.` };
  }

  const conges = [];
  const gardes = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = normalizeAriToken(ariStripHtmlTags(row[typeCol]));
    const ariName = row[nomCol];
    const dateDebut = ariDateToIso(row[debutCol]);
    const dateFin = ariDateToIso(row[finCol]);
    if (!ariName || !dateDebut || !dateFin) continue;

    if (type.includes("conge") && type.includes("annuel")) {
      conges.push({ ariName, dateDebut, dateFin });
    } else if (type.includes("repos") && type.includes("garde")) {
      gardes.push({ ariName, date: dateDebut }); // toujours 1 seul jour côté ARI (dateDebut === dateFin) -- voir RG-013.
    }
  }
  return { conges, gardes, error: null };
}

// Croise les lignes extraites avec state.staff (matchAriNameToStaff()) et state.conges/state.gardes
// (déduplication -- un import répété du même fichier ne doit rien dupliquer). RG-013 : une ligne
// "Repos de garde" côté ARI pour le jour J devient une GARDE le jour J-1 dans notre modèle (le repos
// de garde n'est jamais stocké directement, toujours dérivé -- voir CLAUDE.md §4.9).
function buildAriImportPreview(parsed) {
  const exact = [];
  const fuzzy = [];
  const unrecognized = [];
  let alreadyPresentCount = 0;

  parsed.conges.forEach((row) => {
    const match = matchAriNameToStaff(row.ariName);
    if (match.status === "none") { unrecognized.push({ kind: "conge", ...row }); return; }
    const item = { kind: "conge", ...row, person: match.person, matchStatus: match.status, distance: match.distance };
    const exists = state.conges.some((c) => c.staffId === match.person.id && c.dateDebut === row.dateDebut && c.dateFin === row.dateFin);
    if (exists) { alreadyPresentCount++; return; }
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  parsed.gardes.forEach((row) => {
    const match = matchAriNameToStaff(row.ariName);
    if (match.status === "none") { unrecognized.push({ kind: "garde", ...row }); return; }
    const gardeDate = isoAddDays(row.date, -1);
    const item = { kind: "garde", ...row, gardeDate, person: match.person, matchStatus: match.status, distance: match.distance };
    if (isOnGardeDay(match.person.id, gardeDate)) { alreadyPresentCount++; return; }
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  return { exact, fuzzy, unrecognized, alreadyPresentCount };
}

function applyAriImportItems(items) {
  items.forEach((item) => {
    if (item.kind === "conge") {
      state.conges.push({ id: generateId(), staffId: item.person.id, dateDebut: item.dateDebut, dateFin: item.dateFin });
    } else {
      state.gardes.push({ id: generateId(), staffId: item.person.id, date: item.gardeDate });
    }
  });
  saveState();
  render();
}

function ariItemLabel(item) {
  const who = `${item.person.prenom} ${item.person.nom}`;
  if (item.kind === "conge") return `${who} — congé du ${item.dateDebut} au ${item.dateFin}`;
  return `${who} — garde le ${item.gardeDate} (repos de garde ARI le ${item.date})`;
}

function openAriImportModal() {
  document.getElementById("ariImportModal").classList.remove("hidden");
  document.getElementById("ariImportModalBody").innerHTML = `
    <p>Choisis le fichier extract ARI (.xlsx) tel quel, sans modification.</p>
    <button type="button" id="btnAriPickFile" class="btn-primary">Choisir le fichier</button>
  `;
  document.getElementById("btnAriPickFile").addEventListener("click", () => {
    document.getElementById("ariFileInput").click();
  });
}

function closeAriImportModal() {
  document.getElementById("ariImportModal").classList.add("hidden");
}

function renderAriImportPreview(preview) {
  const body = document.getElementById("ariImportModalBody");
  body.innerHTML = "";

  if (preview.exact.length === 0 && preview.fuzzy.length === 0) {
    body.innerHTML = '<p class="bulk-hint">Rien de nouveau à importer (déjà à jour, ou fichier non reconnu).</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "bulk-hint";
  summary.textContent = `${plural(preview.exact.length, "élément")} reconnu${preview.exact.length > 1 ? "s" : ""} automatiquement.` +
    (preview.alreadyPresentCount > 0 ? ` ${preview.alreadyPresentCount} déjà présent(s), ignoré(s).` : "");
  body.appendChild(summary);

  if (preview.fuzzy.length > 0) {
    const fuzzyTitle = document.createElement("p");
    fuzzyTitle.className = "bulk-hint";
    fuzzyTitle.textContent = "Noms proches mais pas identiques -- à vérifier avant import (décoche si erroné) :";
    body.appendChild(fuzzyTitle);
  }

  const list = document.createElement("div");
  list.className = "bulk-preview-list";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn-primary";

  const allItems = [...preview.exact, ...preview.fuzzy];
  allItems.forEach((item) => { item.include = true; });

  const updateConfirmLabel = () => {
    const n = allItems.filter((it) => it.include).length;
    confirmBtn.textContent = `Confirmer l'import (${n})`;
    confirmBtn.disabled = n === 0;
  };

  preview.fuzzy.forEach((item) => {
    const row = document.createElement("label");
    row.className = "bulk-preview-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => { item.include = cb.checked; updateConfirmLabel(); });
    row.appendChild(cb);
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = `ARI : "${item.ariName.trim()}" → ${ariItemLabel(item)}`;
    row.appendChild(info);
    list.appendChild(row);
  });

  preview.exact.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bulk-preview-row bulk-preview-duplicate";
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = ariItemLabel(item);
    row.appendChild(info);
    list.appendChild(row);
  });

  body.appendChild(list);

  if (preview.unrecognized.length > 0) {
    const details = document.createElement("details");
    details.className = "bulk-ignored";
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = `${plural(preview.unrecognized.length, "nom")} non reconnu${preview.unrecognized.length > 1 ? "s" : ""}, ignoré${preview.unrecognized.length > 1 ? "s" : ""}`;
    details.appendChild(summaryEl);
    const pre = document.createElement("pre");
    pre.textContent = preview.unrecognized.map((it) => it.ariName.trim()).join("\n");
    details.appendChild(pre);
    body.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    applyAriImportItems(allItems.filter((it) => it.include));
    closeAriImportModal();
  });
  body.appendChild(confirmBtn);
}

document.getElementById("btnImportAri").addEventListener("click", openAriImportModal);
document.getElementById("ariImportModalClose").addEventListener("click", closeAriImportModal);
document.getElementById("ariImportModal").addEventListener("click", (e) => {
  if (e.target.id === "ariImportModal") closeAriImportModal();
});

document.getElementById("ariFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const workbook = XLSX.read(new Uint8Array(reader.result), { type: "array" });
      const parsed = parseAriWorkbook(workbook);
      if (parsed.error) {
        document.getElementById("ariImportModalBody").innerHTML = `<p class="bulk-hint">${parsed.error}</p>`;
        return;
      }
      const preview = buildAriImportPreview(parsed);
      renderAriImportPreview(preview);
    } catch (err) {
      document.getElementById("ariImportModalBody").innerHTML = `<p class="bulk-hint">Fichier illisible : ${err.message}</p>`;
    }
  };
  reader.readAsArrayBuffer(file);
});

// ---------- Démarrage ----------

loadState();
render();
setFileSyncStatus(fileSyncStatus); // affiche "non connecté" dans la topbar avant même la tentative de connexion auto ci-dessous.
tryAutoConnectGitHub(); // async -- re-render si un jeton est déjà enregistré et valide.
