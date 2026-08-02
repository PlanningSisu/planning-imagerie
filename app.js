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

// Compétences (26/07/2026, demande de Samir) : cases à cocher indépendantes de `person.specialites`
// -- 0 à 5 parmi les mêmes clés (`SPECIALITE_ORDER`), sans contrainte liée au grade. Aucune
// représentation visuelle (pas de couleur/dégradé, contrairement à specialites) -- affichées
// uniquement au survol (voir personTooltip()) et destinées au futur moteur de règles.
function orderedCompetences(person) {
  const set = new Set(person.competences || []);
  return SPECIALITE_ORDER.filter((k) => set.has(k));
}

// Texte de survol standard pour une personne -- nom complet, plus la liste de ses compétences si
// elle en a (rien d'ajouté sinon, pour ne pas alourdir le tooltip des personnes sans compétence
// renseignée). Centralisé pour que toutes les vues qui affichent un nom au survol restent cohérentes.
function personTooltip(person) {
  const base = `${person.prenom} ${person.nom}`;
  const competences = orderedCompetences(person);
  if (competences.length === 0) return base;
  return `${base} — Compétences : ${competences.map((k) => SPECIALITES[k].label).join(", ")}`;
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

// Bascule Semaine/Période de la vue Stats (24/07/2026, demande de Samir) : "week" utilise la semaine
// affichée (state.weekOffset, comportement d'origine) ; "period" calcule sur une plage de dates
// choisie via 2 <input type="date"> ("un mois par exemple", mais une plage arbitraire). Transitoire,
// non persisté (comme editingStats/congesYear) -- repart en mode "Semaine" à chaque rechargement.
// `statsRangeStart`/`statsRangeEnd` ("YYYY-MM-DD") ne sont initialisées qu'à la première bascule en
// mode "Période" (voir defaultStatsPeriod() dans renderStatsView()), pas ici.
let statsMode = "week";
let statsRangeStart = null;
let statsRangeEnd = null;

// Focus jour / demi-journée (24/07/2026) : cliquer sur l'en-tête d'un jour (ou d'un créneau précis
// sous ce jour) dans le tableau principal filtre le panneau Personnel (#staffList) pour ne montrer
// que les personnes PRÉSENTES ce jour-là (RG-014 : ni congé ni repos de garde) ET PAS DÉJÀ POSTÉES
// sur ce jour/créneau. `creneauId: null` = jour entier (les 3 créneaux comptent comme "posté" s'ils
// ont ne serait-ce qu'une assignation) ; `creneauId` renseigné = seul ce créneau précis compte.
// Non persisté (comme currentView) -- state transitoire d'UI, remis à zéro au rechargement.
// Un second clic sur exactement la même cible (même day + même creneauId) l'annule -- voir
// toggleStaffFocusFilter().
let staffFocusFilter = null;

// Recherche par nom/prénom dans "Gestion Personnel" (29/07/2026, demande de Samir) -- transitoire
// comme les autres states d'UI ci-dessus, remise à vide à chaque ouverture de la modale
// (openStaffModal()) mais PAS à chaque re-rendu de la liste (ajout/modif/suppression) : Samir
// cherche "Dubois", modifie la fiche, la liste doit rester filtrée sur "Dubois" après coup plutôt
// que de revenir silencieusement à la liste complète.
let staffModalSearchQuery = "";

// Filtres du panneau Personnel : OR à l'intérieur d'une catégorie, ET entre les deux catégories.
// grades: "senior" | "interne" | "cca". specialites: "digestif"|"uro"|"gyneco"|"thorax"|"socle".
// Réutilisés tels quels par la vue Congés (colonnes filtrées par les mêmes puces, voir 6.x
// CLAUDE.md) -- volontairement le même state partagé, pas une copie, pour rester cohérent
// entre les deux vues sans dupliquer la logique de filtre.
// "cca" (29/07/2026) : pas un grade à part entière (aucun person.grade ne vaut jamais "cca"), juste
// une 3e VALEUR dans le même Set que "senior"/"interne" -- CCA est un sous-ensemble de Sénior
// (person.cca === true implique toujours person.grade === "senior"). Grâce au OR déjà en place dans
// cette catégorie, cliquer "Sénior" seul montre tous les séniors CCA compris (ils ont grade==="senior",
// donc matchent déjà) ; cliquer "CCA" seul isole les CCA ; cocher les deux ne change rien de plus que
// "Sénior" seul (CCA ⊆ Sénior) -- exactement le comportement demandé par Samir, sans code spécial.
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
  if (staffFilters.grades.size > 0) {
    const matchesGrade = [...staffFilters.grades].some((g) => (g === "cca" ? !!person.cca : person.grade === g));
    if (!matchesGrade) return false;
  }
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
  { id: "bureau", nom: "Bureau", group: "bureau-start" },
  { id: "off", nom: "Off", group: "bureau-end" },
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
const STATE_SCHEMA_VERSION = 5;

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
  // 2 -> 3 : ajout de `statsColumnOrder` (colonnes de la vue Stats réordonnables à la main,
  // 24/07/2026) -- un fichier plus ancien n'a jamais eu ce champ, `normalizeStatsColumnOrder()`
  // (appelée aussi bien ici qu'à chaque rendu, voir renderStatsView()) retombe sur l'ordre par
  // défaut le cas échéant, donc une simple valeur vide suffit ici, la normalisation fait le reste.
  2: (data) => ({ ...data, statsColumnOrder: Array.isArray(data.statsColumnOrder) ? data.statsColumnOrder : [] }),
  // 3 -> 4 : ajout de `tempsPartiel` (RG-020, Temps Partiel, 25/07/2026) -- un fichier plus ancien
  // n'a jamais eu ce champ, un objet vide suffit (personne n'est en Temps Partiel par défaut).
  3: (data) => ({ ...data, tempsPartiel: data.tempsPartiel || {} }),
  // 4 -> 5 : ajout de `customColors` (personnalisation de quelques couleurs sans coder, 25/07/2026)
  // -- un objet vide suffit (aucune couleur personnalisée = valeurs par défaut du CSS).
  4: (data) => ({ ...data, customColors: data.customColors || {} }),
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
const PERSISTED_KEYS = ["staff", "assignments", "vacationSpecialites", "fermetures", "conges", "gardes", "trame", "tempsPartiel", "weekOffset", "statsColumnOrder", "customColors"];

// Personnalisation (25/07/2026, ⚙ → "Personnalisation") : quelques couleurs éditables depuis
// l'appli sans toucher au code -- une entrée par variable CSS `--custom-xxx` (voir :root dans
// style.css pour les valeurs par défaut). `state.customColors[key]` absent/vide = valeur par défaut
// du CSS (ne rien poser en style inline pour cette variable-là).
// `widthKey`/`widthVar` (25/07/2026, demande de Samir) : seul le séparateur de jour a en plus un
// réglage d'épaisseur (px) -- pas généralisé aux 3 autres couleurs, qui n'en ont pas besoin.
const CUSTOM_COLOR_FIELDS = [
  { key: "daySeparator", cssVar: "--custom-day-start", label: "Séparateur de jour", widthKey: "daySeparatorWidth", widthVar: "--custom-day-start-width" },
  { key: "absence", cssVar: "--custom-absence", label: "Congé / repos de garde" },
  { key: "tempsPartiel", cssVar: "--custom-tp", label: "Temps Partiel" },
  { key: "off", cssVar: "--custom-off", label: "Off" },
];

// Applique state.customColors sur les variables CSS du document -- appelée au chargement et à
// chaque modification depuis le panneau de personnalisation. Une clé absente/vide retire la
// variable en style inline (retombe sur la valeur par défaut de :root dans style.css).
function applyCustomColors() {
  CUSTOM_COLOR_FIELDS.forEach(({ key, cssVar, widthKey, widthVar }) => {
    const value = state.customColors[key];
    if (value) {
      document.documentElement.style.setProperty(cssVar, value);
    } else {
      document.documentElement.style.removeProperty(cssVar);
    }
    if (widthKey) {
      const width = state.customColors[widthKey];
      if (width) {
        document.documentElement.style.setProperty(widthVar, `${width}px`);
      } else {
        document.documentElement.style.removeProperty(widthVar);
      }
    }
  });
}

function buildPersistedState() {
  const data = { schemaVersion: STATE_SCHEMA_VERSION };
  PERSISTED_KEYS.forEach((key) => { data[key] = state[key]; });
  return data;
}

// Applique un objet de données (fichier partagé, localStorage, ou import JSON manuel) au state en
// mémoire, après migration. Ne touche jamais state.activities, quoi que contienne rawData.
// Ordre par défaut des colonnes de la vue Stats (24/07/2026, colonnes réordonnables à la main) --
// "Personnel" n'en fait pas partie, elle reste toujours fixe en 1re position (colonne figée).
const DEFAULT_STATS_COLUMN_ORDER = ["total", "vacations", "astreinte", "bureau", "off"];

// Valide/complète un ordre de colonnes Stats persisté -- un fichier plus ancien (sans ce champ du
// tout), corrompu, ou une future colonne ajoutée par le code mais absente d'un vieil export ne doit
// JAMAIS faire planter le rendu ni faire disparaître une colonne : on filtre les identifiants
// inconnus (ex. une colonne retirée depuis), puis on complète avec les colonnes par défaut
// manquantes (à la fin, dans leur ordre canonique) -- jamais de colonne perdue silencieusement.
function normalizeStatsColumnOrder(order) {
  const valid = Array.isArray(order) ? order.filter((id) => DEFAULT_STATS_COLUMN_ORDER.includes(id)) : [];
  DEFAULT_STATS_COLUMN_ORDER.forEach((id) => {
    if (!valid.includes(id)) valid.push(id);
  });
  return valid;
}

function applyPersistedState(rawData) {
  const data = migrateState(rawData);
  state.assignments = data.assignments || {};
  state.weekOffset = data.weekOffset || 0;
  state.vacationSpecialites = data.vacationSpecialites || {};
  state.fermetures = data.fermetures || {};
  state.conges = Array.isArray(data.conges) ? data.conges : [];
  state.gardes = Array.isArray(data.gardes) ? data.gardes : [];
  state.trame = data.trame || {};
  state.tempsPartiel = data.tempsPartiel || {};
  state.statsColumnOrder = normalizeStatsColumnOrder(data.statsColumnOrder);
  state.customColors = data.customColors || {};
  if (Array.isArray(data.staff) && data.staff.length > 0) {
    state.staff = data.staff;
  }
  applyCustomColors();
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
  // Temps Partiel (RG-020, 25/07/2026) : créneaux structurellement NON travaillés d'une personne à
  // temps partiel -- clé PAR PERSONNE (pas d'activité concernée, voir tpKey()), structurel comme la
  // trame. Bloque toute affectation sur ce créneau dans la Trame Personnel elle-même ; sur le
  // planning réel (semaines), ne bloque plus rien depuis le 25/07/2026 (juste une violation
  // signalée, voir isPersonTPOnSlot()) -- et reste totalement exclu des Stats.
  tempsPartiel: {}, // key: `${staffId}|${day}|${creneauId}` -> true
  weekOffset: 0,
  // Ordre des colonnes de la vue Stats (24/07/2026, réordonnables par glisser-déposer des en-têtes,
  // voir renderStatsView()) -- "Personnel" n'en fait pas partie, toujours fixe en 1re position.
  statsColumnOrder: DEFAULT_STATS_COLUMN_ORDER.slice(),
  // Personnalisation (25/07/2026, ⚙ → "Personnalisation") : quelques couleurs éditables sans coder
  // -- voir CUSTOM_COLOR_FIELDS/applyCustomColors(). Clé absente = valeur par défaut du CSS.
  customColors: {}, // key: voir CUSTOM_COLOR_FIELDS -> "#rrggbb"
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

// RG-017 (26/07/2026, retour de Samir) : une semaine déjà "touchée" (matérialisée dans
// state.assignments, donc devenue indépendante de la trame -- voir ensureMaterializedAssignments())
// ignorait complètement toute évolution ultérieure de la trame, y compris un simple AJOUT --
// résultat gênant : ajouter quelqu'un dans sa trame ne le faisait apparaître nulle part sur une
// semaine déjà en cours d'utilisation. Corrigé en propageant les AJOUTS (jamais les retraits, voir
// juste en dessous) vers toute semaine actuelle/future déjà matérialisée pour ce créneau précis --
// sans jamais retirer qui que ce soit d'autre déjà présent. Les semaines PAS encore touchées n'ont
// besoin d'aucune propagation : effectiveAssignedIds() reflète déjà la trame en direct pour elles.
// **Volontairement asymétrique** : retirer quelqu'un de sa trame ne le retire PAS des semaines déjà
// matérialisées (décision explicite de Samir, "je gère les retraits à la main au cas par cas") --
// seule une semaine jamais touchée voit un retrait de trame se répercuter, ce qui est déjà le
// comportement par défaut d'effectiveAssignedIds(), sans code supplémentaire ici.
// Renvoie le nombre d'ajouts réellement effectués (0 si rien à faire) -- utilisé par
// resyncTrameToTouchedWeeks() pour afficher un résumé à Samir après une resynchronisation manuelle.
function propagateTrameAdditionToTouchedWeeks(activityId, day, creneauId, staffId) {
  const currentWeekKey = weekKey(getMonday(0)); // semaine réelle actuelle (pas state.weekOffset,
  // qui reflète juste la semaine affichée à l'écran au moment de l'édition, sans rapport ici).
  const suffix = `${activityId}|${day}|${creneauId}`;
  let addedCount = 0;
  Object.keys(state.assignments).forEach((assignKey) => {
    const parts = assignKey.split("|");
    if (parts.length !== 4 || `${parts[1]}|${parts[2]}|${parts[3]}` !== suffix) return;
    const assignWeekKey = parts[0];
    if (assignWeekKey < currentWeekKey) return; // jamais les semaines passées, comme RG-017.
    if (!state.assignments[assignKey].includes(staffId)) {
      state.assignments[assignKey].push(staffId);
      addedCount++;
    }
  });
  return addedCount;
}

// Resynchronisation manuelle (26/07/2026, ⚙ → "Resynchroniser la trame") : applique
// rétroactivement propagateTrameAdditionToTouchedWeeks() à TOUTE la trame déjà saisie -- rattrape
// les ajouts faits AVANT que cette propagation n'existe (une trame remplie plus tôt n'a jamais pu
// déclencher la propagation, qui n'existait pas encore). Jamais de retrait, comme au fil de l'eau.
function resyncTrameToTouchedWeeks() {
  let count = 0;
  Object.keys(state.trame).forEach((trameKeyStr) => {
    const [activityId, day, creneauId] = trameKeyStr.split("|");
    (state.trame[trameKeyStr] || []).forEach((staffId) => {
      count += propagateTrameAdditionToTouchedWeeks(activityId, day, creneauId, staffId);
    });
  });
  return count;
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
          const person = staffById(staffId);
          if (!person) return;
          if (activity.id !== "off" && isPersonAbsentOnDay(staffId, day)) {
            // Off ne compte pas comme un conflit avec une absence (congé/repos de garde) : les deux
            // disent la même chose ("cette personne ne travaille pas"), jamais une contradiction --
            // demande de Samir le 29/07/2026 ("si je suis en congés et qu'on m'a mis un Off, c'est
            // pas grave").
            violations.push({
              rg: "RG-014",
              message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} est absent(e) ce jour-là.`,
            });
          } else if (isPersonTPOnSlot(staffId, day, creneau.id)) {
            // RG-020 : plus aucun blocage à l'ajout depuis le 25/07/2026 (ni popover, ni glisser-
            // déposer) -- ce message est désormais le seul signal de la contradiction.
            violations.push({
              rg: "RG-020",
              message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là.`,
            });
          }
          // RG-018 (conflit Off) fusionnée dans RG-021 le 29/07/2026 -- voir validateActivityExclusivity(),
          // qui couvre désormais Off comme n'importe quelle autre activité. Ne plus réintroduire de
          // branche dédiée ici, ça produirait un double signalement du même conflit.
        });
      });
    });
  });

  return { violations, recommendations };
}

// RG-021 (29/07/2026, généralise RG-018/RG-019) : voir hasActivityExclusivityConflict() pour le
// détail de la règle. Fonction à PART (pas ajoutée à validateAbsences(), pourtant thématiquement
// proche), mais parcourt désormais TOUTES les activités (pas seulement Scan U/Echo U comme
// l'ancienne RG-019) puisque n'importe quelle paire peut désormais entrer en conflit -- `reported`
// déduplique par personne pour chaque (jour, créneau), pour ne compter le même conflit qu'une seule
// fois même s'il est retrouvé depuis plusieurs des activités impliquées.
function validateActivityExclusivity() {
  const violations = [];

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      if (creneau.id === "astreinte") return; // hors-sujet, voir hasActivityExclusivityConflict().
      const reported = new Set();
      state.activities.forEach((activity) => {
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return;
        effectiveAssignedIds(key).forEach((staffId) => {
          if (reported.has(staffId)) return;
          const person = staffById(staffId);
          if (!person) return;
          if (hasActivityExclusivityConflict(staffId, day, creneau.id, activity.id)) {
            reported.add(staffId);
            violations.push({
              rg: "RG-021",
              message: `${day} ${creneau.label} : ${person.prenom} ${person.nom} est posté(e) sur plusieurs activités à la fois.`,
            });
          }
        });
      });
    });
  });

  return { violations, recommendations: [] };
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
  const results = [validateScanU(), validateScanA(), validateAbsences(), validateGardes(), validateActivityExclusivity()];
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
  // RG-020 (25/07/2026) : idem pour un conflit Temps Partiel. RG-021 (29/07/2026, généralise
  // RG-018/RG-019) : idem pour un double-positionnement sur une autre activité ce même créneau --
  // Off n'est plus un cas particulier, voir hasActivityExclusivityConflict().
  const [activityId, , creneauId] = trameKeyFromCellKey(key).split("|");
  if (activityId !== "off" && isPersonAbsentOnDay(person.id, day)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est absent(e) ce jour-là`;
  } else if (isPersonTPOnSlot(person.id, day, creneauId)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là`;
  } else if (hasActivityExclusivityConflict(person.id, day, creneauId, activityId)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est déjà posté(e) ailleurs ce créneau-là`;
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
//
// RG-014/RG-018/RG-019/RG-020 (25/07/2026, revu -- retour de Samir "je ne veux plus de blocage
// quand je positionne quelqu'un sur le planning") : une personne en congé, en repos de garde, en
// Off ce créneau-là, en Temps Partiel, ou déjà postée ailleurs en conflit avec Scan U/Echo U N'EST
// PLUS bloquée ici -- le glisser-déposer aboutit toujours, la contradiction remonte uniquement via
// la violation + contour rouge existants (voir buildAssignedChip()/buildModaliteTag(), déjà le seul
// mécanisme pour un conflit glissé via le popover, jamais filtré). Ancien comportement : un
// `isAssignmentBlocked()` dédié refusait le dépôt avant cette date -- retiré, plus aucun appelant.
function handleAssignmentDrop(e, targetKey) {
  const staffId = e.dataTransfer.getData("text/plain");
  if (!staffId || !staffById(staffId)) return false;
  const sourceKey = e.dataTransfer.getData("application/x-source-key");
  if (sourceKey && sourceKey === targetKey) return false;

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
  sizeTableWrapMaxHeight();
  stackStickyHeaderRows();
}

// Hauteur max de .table-wrap calculée en JS (24/07/2026, "figer le volet des jours") -- PAS en CSS/
// flexbox : une tentative flexbox pleine page a été abandonnée le même jour (comprimait le tableau
// même quand il tenait très bien avant en empêchant la page de simplement défiler comme avant pour
// les vues courtes -- voir piège en section 2 de CLAUDE.md). Mesure la place réellement disponible
// jusqu'en bas de la fenêtre à partir de la position réelle de .table-wrap (pas une valeur devinée,
// même principe que sizeCongesRows() un peu plus bas) : si le contenu tient déjà dans cet espace,
// cette max-height ne change rien de visible (aucun scroll, comportement identique à avant) ; sinon,
// .table-wrap (overflow-y:auto, voir style.css) défile en interne avec en-tête/colonne gelés
// (position: sticky, déjà posé pour la colonne figée, voir §6.18 CLAUDE.md).
function sizeTableWrapMaxHeight() {
  const margin = 16; // même marge que le padding de `main`, pour ne pas coller au bord de la fenêtre
  const minHeight = 160; // plancher pour rester utilisable même sur une petite fenêtre
  document.querySelectorAll(".table-wrap").forEach((wrap) => {
    if (wrap.offsetParent === null) return; // masqué (display:none sur wrap lui-même ou un ancêtre .hidden)
    const top = wrap.getBoundingClientRect().top;
    const maxH = Math.max(minHeight, Math.floor(window.innerHeight - top - margin));
    wrap.style.maxHeight = `${maxH}px`;
  });
}

// Empile les 2 lignes d'en-tête (jours, puis matin/astreinte/après-midi) au lieu de les superposer
// (24/07/2026, corrige un 2e passage sur "figer le volet des jours") -- `thead th { position:
// sticky; top: 0 }` (style.css) donne le MÊME top:0 aux deux lignes de <thead> (vue Modalité/
// Personnel/Trame Vacation et Trame Personnel ont chacune 2 lignes : `.day-header` puis
// `.creneau-header`, voir renderTable()/renderTramePersonnelView()). Au scroll, les deux lignes se
// collaient donc au même endroit et la 2e (créneaux, plus loin dans le DOM) recouvrait la 1re
// (jours) -- symptôme remonté par Samir : "matin/astreinte/après-midi" semblait figé, "les jours"
// non (en réalité toujours là, juste caché dessous). Fix : mesurer la hauteur réelle de la 1re ligne
// et décaler la 2e d'autant via un `top` inline -- pas une valeur CSS fixe, la 1re ligne peut
// grandir (chips de garde RG-015 dans l'en-tête de jour, voir §6.1) donc la hauteur n'est pas
// constante d'une semaine à l'autre. Congés/Stats n'ont qu'une seule ligne d'en-tête : `rows.length
// < 2` les laisse intactes (déjà correctement gelées par la seule règle CSS top:0).
function stackStickyHeaderRows() {
  document.querySelectorAll(".table-wrap table thead").forEach((thead) => {
    const rows = thead.querySelectorAll("tr");
    if (rows.length < 2) return;
    const firstRowHeight = rows[0].getBoundingClientRect().height;
    rows[1].querySelectorAll("th").forEach((th) => {
      th.style.top = `${firstRowHeight}px`;
    });
  });
}

let tableWrapResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(tableWrapResizeTimer);
  tableWrapResizeTimer = setTimeout(() => {
    sizeTableWrapMaxHeight();
    stackStickyHeaderRows();
  }, 150);
});

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
  sizeTableWrapMaxHeight();
  stackStickyHeaderRows();
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
  addChip("CCA", "grades", "cca", neutral);

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
    th.className = "day-header day-header-focusable day-start"; // séparateur de jour, voir §6.28/§6.29
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
    CRENEAUX.forEach((c, creneauIdx) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "creneau-header creneau-header-focusable";
      if (creneauIdx === 0) th.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
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
// (RG-013) le jour `day` de la semaine ACTUELLEMENT AFFICHÉE (state.weekOffset). Centralisé ici
// pour une seule définition de "absent(e)", consultée par le blocage total de la case en vue
// Personnel (renderPersonnelRows()), le moteur de validation (validateAbsences()) et le contour
// rouge de violation (buildAssignedChip()/buildModaliteTag()) -- depuis le 25/07/2026, ne bloque
// PLUS le glisser-déposer en vue Modalité (handleAssignmentDrop()), voir le commentaire dédié là-bas.
function isPersonAbsentOnDay(staffId, day) {
  const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
  return isOnCongeDay(staffId, iso) || isOnReposGardeDay(staffId, iso);
}

// RG-018 ("Jour Off", 24/07/2026, demande de Samir) : "Off" (nom interne d'activité `off`, voir
// ACTIVITIES) se déclare comme n'importe quelle modalité -- typiquement dans la Trame Personnel
// (RG-017), d'où un effet sur la semaine affichée via effectiveAssignedIds() (trame ou affectation
// réelle de cette semaine précise, peu importe). Contrairement à RG-014 (congé/repos, toute la
// journée), Off bloque seulement le CRÉNEAU précis où il est posé (demi-journée) -- Off le matin
// n'empêche pas de poster la même personne l'après-midi du même jour.
function isPersonOffOnSlot(staffId, day, creneauId) {
  return effectiveAssignedIds(cellKey("off", day, creneauId)).includes(staffId);
}

// RG-020 (Temps Partiel, 25/07/2026, demande de Samir) : une personne à temps partiel n'est pas
// disponible sur les créneaux hors de son contrat -- donnée STRUCTURELLE (comme la trame), jamais
// liée à une semaine précise (pas de notion d'"override" ponctuel comme assignments/trame). Bloque
// dans la Trame Personnel elle-même (décision explicite du 25/07/2026) ; sur le planning réel, ne
// bloque plus le glisser-déposer depuis le même jour (retour de Samir, voir handleAssignmentDrop()/
// handleModaliteDrop()) -- juste une violation signalée, comme congé/Off/l'exclusivité Scan U.
function tpKey(staffId, day, creneauId) {
  return `${staffId}|${day}|${creneauId}`;
}

function isPersonTPOnSlot(staffId, day, creneauId) {
  return !!state.tempsPartiel[tpKey(staffId, day, creneauId)];
}

// RG-021 (29/07/2026, demande de Samir -- généralise RG-018/RG-019) : deux activités DIFFÉRENTES
// sont désormais toujours exclusives sur un même jour+créneau, quelles qu'elles soient -- une
// personne postée au Scan B ne peut plus être postée aussi en Mammo le même créneau, exactement
// comme Scan U/Echo U l'étaient déjà entre elles depuis le 24/07/2026. Off n'est plus un cas
// particulier : c'est juste une activité comme les autres pour ce calcul (avant le 29/07/2026, RG-018
// et RG-019 étaient deux implémentations séparées de la même idée, l'une bornée à Off, l'autre bornée
// à Scan U/Echo U -- fusionnées ici en une seule fonction, RG-006 "double-positionnement" n'a donc
// plus de cas non couvert). Symétrique : `activityId` peut être l'activité qu'on essaie de poser (on
// vérifie alors si la personne est déjà ailleurs) ou une activité déjà en place (on vérifie alors si
// elle est postée sur une autre activité).
// Ne concerne QUE Matin/Après-midi -- l'astreinte (créneau à part, propre à Scan U, RG-012) reste
// hors-sujet ("l'astreinte c'est autre chose", confirmé par Samir le 24/07/2026) : elle ne peut de
// toute façon accueillir que Scan U (isCreneauApplicable()), aucun double-positionnement possible.
function hasActivityExclusivityConflict(staffId, day, creneauId, activityId) {
  if (creneauId === "astreinte") return false;
  return state.activities.some((activity) => {
    if (activity.id === activityId) return false;
    const key = cellKey(activity.id, day, creneauId);
    // RG-010 : une case fermée n'a plus de composition attendue, jamais un conflit -- notamment pour
    // une vieille fermeture antérieure au 24/07/2026 qui n'a jamais matérialisé state.assignments à
    // vide (bug corrigé depuis pour toute nouvelle fermeture, voir setDayClosedForActivity()) : sans
    // ce garde-fou, le repli trame de la case fermée continue de "compter" indéfiniment pour RG-021,
    // invisible à l'écran puisque la case n'affiche qu'une croix.
    if (state.fermetures[key]) return false;
    return effectiveAssignedIds(key).includes(staffId);
  });
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

// `staffId` est-elle déjà postée sur CE créneau précis -- toutes activités confondues ? Utilisée
// uniquement pour un focus demi-journée (voir personMatchesFocusFilter()) -- le focus jour entier a
// sa propre logique depuis le 25/07/2026, voir isPersonUnavailableAllDay() juste en dessous.
function isPersonPostedOnCreneau(staffId, day, creneauId) {
  return state.activities.some((activity) => effectiveAssignedIds(cellKey(activity.id, day, creneauId)).includes(staffId));
}

// RG-018/RG-020 (25/07/2026, retour de Samir sur le focus JOUR ENTIER) : une personne est
// indisponible "toute la journée" si Off et/ou Temps Partiel couvrent les 2 demi-journées (matin ET
// après-midi -- jamais l'astreinte, hors sujet pour ces deux statuts). Peu importe lequel des deux
// statuts couvre quelle moitié : Temps Partiel le matin + Off l'après-midi compte aussi comme
// indisponible toute la journée (union des deux, demandé explicitement).
function isPersonUnavailableAllDay(staffId, day) {
  return ["matin", "apres-midi"].every((creneauId) =>
    isPersonTPOnSlot(staffId, day, creneauId) || isPersonOffOnSlot(staffId, day, creneauId)
  );
}

// Filtre du panneau Personnel dérivé du focus actif (voir staffFocusFilter). Congé/repos de garde
// (RG-014) exclut toujours, jour entier ou demi-journée.
// - **Focus JOUR ENTIER** (revu le 25/07/2026, retour de Samir) : n'exclut plus rien d'autre que
//   congé/repos et "indisponible toute la journée" (voir isPersonUnavailableAllDay() ci-dessus). Le
//   check "déjà postée quelque part ce jour" (n'importe quelle activité, une seule demi-journée
//   suffisait) a été RETIRÉ -- il masquait à tort quelqu'un qui n'avait qu'une seule demi-journée
//   occupée, remplacé par ce critère plutôt que cumulé avec.
// - **Focus DEMI-JOURNÉE** (inchangé) : Temps Partiel ce créneau précis, ou déjà postée sur CE
//   créneau précis (Off y compris, une activité comme une autre pour ce check).
function personMatchesFocusFilter(person) {
  if (!staffFocusFilter) return true;
  const { day, creneauId } = staffFocusFilter;
  if (isPersonAbsentOnDay(person.id, day)) return false;
  if (!creneauId) return !isPersonUnavailableAllDay(person.id, day);
  if (isPersonTPOnSlot(person.id, day, creneauId)) return false;
  return !isPersonPostedOnCreneau(person.id, day, creneauId);
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

      // RG-014/RG-021 : une personne absente, ou postée sur une autre activité ce même créneau
      // (double-positionnement, RG-021 généralise l'ancienne RG-018/RG-019 depuis le 29/07/2026),
      // peut se retrouver assignée malgré tout -- ni le glisser-déposer ni le popover d'ajout ne
      // bloquent plus rien (25/07/2026, retour de Samir : "je ne veux plus de blocage quand je
      // positionne quelqu'un"), donc ce contour rouge est désormais le SEUL signal de la
      // contradiction, en plus de la violation dans la zone du moteur (validateAbsences()/
      // validateActivityExclusivity()). L'absence reste ignorée sur la case Off elle-même (RG-014,
      // "être en congés et avoir un Off, c'est pas grave") ; le double-positionnement, lui,
      // s'applique désormais aussi à Off comme à n'importe quelle autre activité.
      if (
        people.some((p) =>
          (activity.id !== "off" && isPersonAbsentOnDay(p.id, day)) ||
          hasActivityExclusivityConflict(p.id, day, creneau.id, activity.id)
        )
      ) {
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
        if (!handleAssignmentDrop(e, key)) {
          // Dépôt sans effet (source === cible, ou dataTransfer invalide) -- flash rouge bref pour
          // signaler que le glisser-déposer n'a rien fait, plutôt qu'un échec silencieux qui
          // pourrait passer pour un bug. Ne couvre plus RG-014/018/019/020 depuis le 25/07/2026 :
          // le dépôt aboutit désormais toujours pour ces cas, voir handleAssignmentDrop().
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
        CRENEAUX.forEach((creneau, creneauIdx) => {
          const cell = buildModaliteCell(activity, day, creneau);
          if (creneauIdx === 0) cell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
          tr.appendChild(cell);
        });
      } else {
        // RG-012 : l'astreinte n'existe pas ici -- au lieu d'une case grisée à part, on fusionne
        // la colonne Astreinte dans la case Après-midi (colSpan 2) : la case reste une case
        // Après-midi normale, juste visuellement plus large, la colonne Astreinte "disparaît".
        const matinCell = buildModaliteCell(activity, day, CRENEAU_MATIN);
        matinCell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
        tr.appendChild(matinCell);
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
    // "popover-anchor" (24/07/2026, fermeture en masse) : PAS ".slot-cell" -- cette classe porte
    // beaucoup de styles visuels (hover, teintes, curseur bloqué...) qui n'ont rien à faire sur le
    // nom de l'activité. Marqueur purement fonctionnel, exempté du même titre que ".slot-cell" par
    // le gestionnaire de clic global (voir plus bas) pour que le popover qu'il ouvre ne se referme
    // pas tout seul aussitôt ouvert (même piège déjà rencontré avec le bandeau congés, voir 6.11
    // CLAUDE.md : sans cette exemption, le clic qui ouvre le popover remonte ensuite jusqu'au
    // gestionnaire document et le referme dans la foulée).
    nameCell.className = "activity-cell popover-anchor" + (activity.urgence ? " urgence" : "");
    nameCell.title = "Cliquer pour fermer cette vacation sur toute la semaine ou certains jours";
    nameCell.addEventListener("click", () => openBulkFermeturePopover(activity, nameCell));
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      if (activity.id === "scan-u") {
        CRENEAUX.forEach((creneau, creneauIdx) => {
          const cell = buildVacationSpecCell(activity, day, creneau);
          if (creneauIdx === 0) cell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
          tr.appendChild(cell);
        });
      } else {
        // RG-012 : même fusion Astreinte+Après-midi que dans la vue Modalité, voir buildModaliteCell().
        const matinCell = buildVacationSpecCell(activity, day, CRENEAU_MATIN);
        matinCell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
        tr.appendChild(matinCell);
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

// Positionnement partagé par les 6 popovers de l'appli (tous réutilisent #assignPopover) -- ergonomie
// revue le 29/07/2026 (retour de Samir sur la Trame Personnel, "la liste déroulante peut s'afficher
// tout en bas et ne me permet pas de l'utiliser même si je scroll down") : sur un tableau proche de
// la hauteur de la fenêtre (§6.21), une case cliquée en bas de page plaçait le popover sous elle sans
// jamais vérifier qu'il restait dans la fenêtre -- rien ne le ramenait à l'écran, ni le scroll de la
// page (capté par le défilement interne de `.table-wrap` tant que la souris reste dessus) ni le
// scroll de la liste interne (`.popover-select-list`, qui ne fait que 220px de haut, bien plus petite
// que le dépassement réel). Fix : mesurer la taille RÉELLE du popover une fois son contenu déjà rendu
// (`renderXPopoverContent()` doit toujours être appelé AVANT), puis le basculer au-dessus de la case
// si la place manque en dessous ET qu'il y a davantage de place au-dessus -- sinon le garder en
// dessous (mieux que de le coller au bord du haut si les deux côtés sont serrés). Toujours appelé en
// dernier par chaque `open*Popover()`, à la place de la séquence dupliquée `pop.style.top/left` +
// `pop.classList.remove("hidden")`.
function positionPopover(pop, cellEl) {
  const rect = cellEl.getBoundingClientRect();
  pop.classList.remove("hidden"); // doit être visible pour mesurer sa vraie taille (display:none -> 0).
  const popRect = pop.getBoundingClientRect();
  const margin = 8;

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < popRect.height + margin && spaceAbove > spaceBelow;

  let top = flipUp
    ? window.scrollY + rect.top - popRect.height - 4
    : window.scrollY + rect.bottom + 4;
  top = Math.max(window.scrollY + margin, top); // jamais au-dessus du tout début de la page.

  let left = window.scrollX + rect.left;
  const maxLeft = window.scrollX + window.innerWidth - popRect.width - margin;
  left = Math.min(left, Math.max(window.scrollX + margin, maxLeft)); // jamais hors écran à droite/gauche.

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

// Bascule la liste déroulante interne (`.popover-select-list`, celle qui liste les personnes/modalités
// à ajouter) -- même souci que positionPopover() ci-dessus, mais pour ce second niveau : elle s'ouvre
// toujours vers le bas en CSS (`top: calc(100% + 4px)`), sans jamais vérifier la place disponible.
// Bascule vers le haut (`.popover-select-list-up`, voir style.css) si la place manque en dessous ET
// qu'il y en a davantage au-dessus du déclencheur.
function togglePopoverSelectList(trigger, list) {
  const opening = list.classList.contains("hidden");
  list.classList.toggle("hidden");
  list.classList.remove("popover-select-list-up");
  if (!opening) return;
  const triggerRect = trigger.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  if (spaceBelow < listRect.height + 8 && spaceAbove > spaceBelow) {
    list.classList.add("popover-select-list-up");
  }
}

function openVacationSpecPopover(specKey, cellEl, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  renderVacationSpecPopoverContent(specKey, activity, day, creneau);
  positionPopover(pop, cellEl);
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
      // Bug remonté par Samir le 24/07/2026 : fermer une case ne dépostait personne -- la personne
      // restait dans state.assignments (juste masquée visuellement), donc encore comptée "postée"
      // partout où l'app lit effectiveAssignedIds() directement sans vérifier state.fermetures (ex.
      // le filtre "Focus jour/créneau", §6.17). Fix : fermer = matérialiser la case à vide, EXACTEMENT
      // comme si on avait retiré chaque personne à la main (×) -- ne touche jamais state.trame.
      state.assignments[closureKey] = [];
      saveState();
      render();
      renderVacationSpecPopoverContent(specKey, activity, day, creneau);
    });
    optionsList.appendChild(closeRow);
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

// ---------- Fermeture en masse depuis Trame Vacation (24/07/2026, demande de Samir) ----------
// Cliquer le NOM d'une activité (pas une case précise) en Trame Vacation propose de la fermer sur
// toute la semaine affichée ou sur des jours précis, en un seul geste, plutôt que de rouvrir le
// popover case par case pour chaque jour/créneau. RG-010 (fermeture, hebdomadaire) reste la même
// donnée sous-jacente (`state.fermetures`) -- ceci n'est qu'un raccourci de saisie en masse.
//
// RG-011 (vacation "Os" jamais staffée) prime toujours : ces fonctions ne touchent JAMAIS une case
// dont la spécialité propriétaire est "os" (voir isVacationCellOs()) -- la seule façon de fermer une
// case Os reste de retirer d'abord la mention Os dessus (mode Trame Vacation, case par case), puis
// de la fermer à la main. Un jour/toute la semaine entièrement Os n'a donc simplement RIEN à fermer
// ici (voir le garde-fou `.length > 0` dans les deux fonctions "FullyClosed" ci-dessous : sans lui,
// un jour 100% Os serait considéré comme "jamais entièrement fermé", ce qui est correct, mais un
// jour sans AUCUNE case Os serait à tort traité pareil si on ne testait pas explicitement ce cas).

// Créneaux applicables à cette activité, tous jours confondus (RG-012 : astreinte réservée à Scan U).
function activityApplicableCreneaux(activity) {
  return CRENEAUX.filter((c) => isCreneauApplicable(activity.id, c.id));
}

function isVacationCellOs(activity, day, creneau) {
  return state.vacationSpecialites[vacationSpecKey(activity.id, day, creneau.id)] === "os";
}

// Cases (jour+créneau) de CE jour réellement fermables pour cette activité -- Os toujours exclue.
function fermableCellsForDay(activity, day) {
  return activityApplicableCreneaux(activity)
    .filter((creneau) => !isVacationCellOs(activity, day, creneau))
    .map((creneau) => ({ day, creneau }));
}

// Toutes les cases fermables de la semaine affichée pour cette activité (tous jours confondus).
function fermableCellsForWeek(activity) {
  return DAYS.flatMap((day) => fermableCellsForDay(activity, day));
}

function isDayFullyClosedForActivity(activity, day) {
  const cells = fermableCellsForDay(activity, day);
  return cells.length > 0 && cells.every(({ creneau }) => state.fermetures[cellKey(activity.id, day, creneau.id)]);
}

function isWeekFullyClosedForActivity(activity) {
  const cells = fermableCellsForWeek(activity);
  return cells.length > 0 && cells.every(({ day, creneau }) => state.fermetures[cellKey(activity.id, day, creneau.id)]);
}

// Ferme et, dans le même geste, DÉPOSTE tout le monde de la case (24/07/2026, bug remonté par
// Samir -- voir le commentaire équivalent sur l'option "Fermé" du popover case par case) :
// `state.assignments[key] = []` matérialise la case à vide, exactement comme un retrait manuel (×),
// pour que la personne redevienne "disponible" partout où l'app lit effectiveAssignedIds() sans
// vérifier state.fermetures (ex. le filtre Focus jour/créneau). Ne touche jamais state.trame.
function setDayClosedForActivity(activity, day, closed) {
  fermableCellsForDay(activity, day).forEach(({ creneau }) => {
    const key = cellKey(activity.id, day, creneau.id);
    if (closed) {
      state.fermetures[key] = true;
      state.assignments[key] = [];
    } else {
      delete state.fermetures[key];
    }
  });
}

function setWeekClosedForActivity(activity, closed) {
  fermableCellsForWeek(activity).forEach(({ day, creneau }) => {
    const key = cellKey(activity.id, day, creneau.id);
    if (closed) {
      state.fermetures[key] = true;
      state.assignments[key] = [];
    } else {
      delete state.fermetures[key];
    }
  });
}

function openBulkFermeturePopover(activity, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderBulkFermeturePopoverContent(activity);
  positionPopover(pop, cellEl);
}

// Même patron visuel que renderCongePopoverContent() (bouton "toute la semaine" en toggle + une
// rangée de pilules jour par jour) -- demande explicite de Samir ("une pop propre un peu comme
// celle des gardes et des congés"). Couleur sombre/neutre (.ferm-*) plutôt que le vert/indigo des
// pilules congé/garde, pour rester cohérent avec le noir déjà utilisé partout ailleurs pour
// "fermé" (.fermeture-tag, .closed-mark) -- jamais la même couleur qu'une action différente.
function renderBulkFermeturePopoverContent(activity) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "300px";
  const monday = getMonday(state.weekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const weekFullyClosed = isWeekFullyClosedForActivity(activity);

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${activity.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${formatShort(monday)} → ${formatShort(friday)}</span>
    <button type="button" id="fermWeekBtn" class="ferm-week-btn${weekFullyClosed ? " active" : ""}">${weekFullyClosed ? "Rouvrir toute la semaine" : "Fermer toute la semaine"}</button>
    <div class="ferm-pill-row" id="fermPillRow"></div>
    <div class="empty-hint" style="margin-top:8px;">Les cases en spécialité Os ne sont jamais fermées ici.</div>
  `;

  const pillRow = document.getElementById("fermPillRow");
  DAYS.forEach((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dayFullyClosed = isDayFullyClosedForActivity(activity, day);
    const hasFermableCells = fermableCellsForDay(activity, day).length > 0;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ferm-pill" + (dayFullyClosed ? " active" : "");
    btn.textContent = `${day.slice(0, 3)} ${d.getDate()}`;
    if (!hasFermableCells) {
      btn.disabled = true;
      btn.title = "Toutes les cases de ce jour sont en spécialité Os -- rien à fermer ici";
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setDayClosedForActivity(activity, day, !dayFullyClosed);
      saveState();
      render();
      renderBulkFermeturePopoverContent(activity);
    });
    pillRow.appendChild(btn);
  });

  document.getElementById("fermWeekBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    setWeekClosedForActivity(activity, !weekFullyClosed);
    saveState();
    render();
    renderBulkFermeturePopoverContent(activity);
  });

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
    nameCell.title = personTooltip(person);
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
      const absenceClass = onConge ? "cell-absence-conge" : onRepos ? "cell-absence-repos" : null;

      // Case "postable" normale pour UN créneau précis -- factorisée pour être appelée aussi bien
      // pour une case isolée que pour matin/astreinte quand l'après-midi seul est fusionné plus bas.
      const buildNormalCell = (creneau) => {
        const td = document.createElement("td");
        td.className = "slot-cell";
        const activitiesHere = activitiesForPersonSlot(person.id, day, creneau.id);
        // RG-018 : Off se déclare comme une activité normale (via la Trame Personnel typiquement),
        // donc son étiquette s'affiche ici comme n'importe quelle autre -- pas de blocage total de
        // la case façon congé (qui se gère depuis une vue séparée) : on peut toujours cliquer pour
        // gérer/retirer Off via le popover. Seul l'AJOUT d'une autre activité par-dessus est
        // bloqué, au niveau du glisser-déposer (handleModaliteDrop()) -- le popover, lui, n'est
        // volontairement pas filtré (même logique que RG-014, voir buildModaliteCell()) : un ajout
        // malgré tout remonte en violation + contour rouge sur l'étiquette en cause.
        const isOff = isPersonOffOnSlot(person.id, day, creneau.id);

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

        if (isOff) td.classList.add("cell-off-marked");

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
          if (!handleModaliteDrop(e, person.id, day, creneau.id)) {
            td.classList.add("drop-rejected");
            setTimeout(() => td.classList.remove("drop-rejected"), 400);
          }
        });

        return td;
      };

      // Case bloquée (congé/repos/Temps Partiel), fusionnée sur `colSpan` colonnes -- pas
      // d'écouteurs, comme avant (case non interactive).
      const buildBlockedCell = (label, extraClass, colSpan) => {
        const td = document.createElement("td");
        td.className = `slot-cell cell-absence-blocked ${extraClass}`;
        td.colSpan = colSpan;
        const badge = document.createElement("span");
        badge.className = "absence-label";
        badge.textContent = label;
        td.appendChild(badge);
        return td;
      };

      // RG-014/018/020 (25/07/2026, demande de Samir) : fusionner matin/astreinte/après-midi en une
      // seule case (au lieu de 3 identiques) si la personne est indisponible TOUTE LA JOURNÉE
      // (congé/repos -- toujours journée entière -- ou Temps Partiel matin ET après-midi à la fois) ;
      // fusionner seulement astreinte+après-midi si l'indisponibilité (Temps Partiel) ne couvre que
      // l'après-midi. Congé/repos étant toujours journée entière, seul Temps Partiel peut produire
      // le cas "après-midi seul" ou "matin seul" (ce dernier, non prévu par la règle, ne fusionne
      // rien : la case matin affiche juste son étiquette, astreinte/après-midi restent normales).
      const morningUnavailable = !!absenceLabel || isPersonTPOnSlot(person.id, day, "matin");
      const afternoonUnavailable = !!absenceLabel || isPersonTPOnSlot(person.id, day, "apres-midi");
      const label = absenceLabel || "Temps Partiel";
      const extraClass = absenceClass || "cell-absence-tp";

      // .day-start (25/07/2026) : séparateur de jour plus visible, voir §6.28/style.css -- posé sur
      // la 1re case du jour, qu'elle soit fusionnée (colSpan 3) ou non (matin seul).
      if (morningUnavailable && afternoonUnavailable) {
        const cell = buildBlockedCell(label, extraClass, 3);
        cell.classList.add("day-start");
        tr.appendChild(cell);
      } else {
        const morningCell = morningUnavailable ? buildBlockedCell(label, extraClass, 1) : buildNormalCell(CRENEAUX[0]);
        morningCell.classList.add("day-start");
        tr.appendChild(morningCell);
        if (afternoonUnavailable) {
          tr.appendChild(buildBlockedCell(label, extraClass, 2));
        } else {
          tr.appendChild(buildNormalCell(CRENEAUX[1]));
          tr.appendChild(buildNormalCell(CRENEAUX[2]));
        }
      }
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
  const [, tagDay, tagCreneauId] = trameKeyFromCellKey(key).split("|");
  const vacSpec = state.vacationSpecialites[trameKeyFromCellKey(key)];
  // RG-014/RG-020/RG-021 : même logique de contour rouge que buildAssignedChip() côté vue
  // Modalité -- peut désormais arriver aussi bien via le popover que via le glisser-déposer (plus
  // aucun des deux n'est bloqué depuis le 25/07/2026, voir handleModaliteDrop()) : ce contour rouge
  // est le seul signal de la contradiction, pas un filet de sécurité pour un cas résiduel. RG-021
  // (29/07/2026) généralise l'ancienne RG-018/RG-019 -- Off n'est plus un cas particulier.
  const isAbsenceViolation = activity.id !== "off" && isPersonAbsentOnDay(staffId, tagDay);
  const isTPViolation = !isAbsenceViolation && isPersonTPOnSlot(staffId, tagDay, tagCreneauId);
  const isExclusivityViolation = !isAbsenceViolation && !isTPViolation && hasActivityExclusivityConflict(staffId, tagDay, tagCreneauId, activity.id);
  const isViolation = isAbsenceViolation || isTPViolation || isExclusivityViolation;
  tag.className = "chip modalite-tag" +
    (activity.urgence ? " urgence-tag" : "") +
    (vacSpec ? ` spec-${vacSpec}` : "") +
    (isViolation ? " chip-absence-violation" : "");
  if (isViolation) {
    const person = staffById(staffId);
    if (person) {
      tag.title = isAbsenceViolation
        ? `${person.prenom} ${person.nom} est absent(e) ce jour-là`
        : isTPViolation
          ? `${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là`
          : `${person.prenom} ${person.nom} est déjà posté(e) ailleurs ce créneau-là`;
    }
  }
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
  if (!activityId) return false;
  if (!isCreneauApplicable(activityId, targetCreneauId)) return false; // RG-012 : astreinte réservée à Scan U.
  const draggedStaffId = e.dataTransfer.getData("text/plain");
  const sourceKey = e.dataTransfer.getData("application/x-source-key");
  const targetKey = cellKey(activityId, targetDay, targetCreneauId);
  if (sourceKey === targetKey) return false;

  // RG-014/RG-018/RG-019/RG-020 (25/07/2026, revu -- retour de Samir "je ne veux plus de blocage
  // quand je positionne quelqu'un sur le planning") : glisser une autre activité par-dessus une
  // case Off/congé/Temps Partiel, ou par-dessus/depuis Scan U/Echo U en conflit, n'est plus
  // refusé -- le dépôt aboutit toujours, la contradiction remonte via le contour rouge existant
  // (buildModaliteTag()), déjà le seul mécanisme pour un conflit glissé via le popover.

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
  return true;
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
  li.title = personTooltip(person); // compétences (26/07/2026) affichées uniquement ici, au survol.

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
    span.title = personTooltip(p);
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
  positionPopover(pop, cellEl);
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

  // RG-013 (24/07/2026, retour de Samir) : une garde le dimanche génère un repos de garde le lundi
  // (jour calendaire suivant), mais DAYS s'arrête au lundi -- sans cette pilule, aucun moyen de
  // déclarer cette garde-là, donc le repos du lundi ne pouvait jamais être affiché. Garde
  // UNIQUEMENT (pas de pilule Congé équivalente : un congé isolé le dimanche ne serait affiché
  // nulle part, aucune colonne ne le montrerait, contrairement à la garde qui a un effet visible
  // via le repos du lendemain). Placée avant "Lun" dans la rangée Garde, chronologiquement en tête.
  const sundayDate = new Date(monday);
  sundayDate.setDate(monday.getDate() - 1);
  const sundayIso = toISODateLocal(sundayDate);
  const sundayGardeBtn = document.createElement("button");
  sundayGardeBtn.type = "button";
  sundayGardeBtn.className = "conge-pill conge-pill-garde" + (isOnGardeDay(person.id, sundayIso) ? " active" : "");
  sundayGardeBtn.textContent = `Dim ${sundayDate.getDate()}`;
  sundayGardeBtn.title = "Garde du dimanche -- génère le repos de garde du lundi";
  sundayGardeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGardeDay(person.id, sundayIso);
    saveState();
    render();
    renderCongePopoverContent(person, monday);
  });
  gardeRow.appendChild(sundayGardeBtn);

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

const STATS_FAMILY_LABELS = { scan: "Scan", irm: "IRM", ecn: "ECN", mammo: "Mammo" };
const STATS_TYPE_ORDER = ["Scan", "IRM", "ECN", "Mammo"];

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
//
// Bureau/Off (24/07/2026, demande de Samir) : colonnes dédiées dans la vue Stats, comme l'astreinte
// -- ne comptent JAMAIS dans `total` ni dans `badges`/`days`, et ne fusionnent plus entre elles en un
// seul badge "Bureau" (comportement d'avant ce changement). `bureau` compte un point par créneau
// (matin/après-midi) posté sur la modalité Bureau cette semaine ; `off` de même pour Off -- Off n'a
// jamais de créneau astreinte (RG-012/isCreneauApplicable), donc ce compte est déjà "à la demi-
// journée près" par construction (1 point = 1 créneau = une demi-journée), sans calcul supplémentaire.
function computeVacationStatsForWeek(monday) {
  const stats = new Map(); // staffId -> { total, badges: Map(groupKey -> {count, label, specialite, isUrgence, activityId}), days: Set, bureau, off }

  const ensureEntry = (staffId) => {
    if (!stats.has(staffId)) stats.set(staffId, { total: 0, badges: new Map(), days: new Set(), bureau: 0, off: 0 });
    return stats.get(staffId);
  };

  state.activities.forEach((activity) => {
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        // 24/07/2026 (demande de Samir) : l'astreinte est traitée à part dans cette vue -- elle a
        // sa propre colonne dédiée (voir computePastAstreinteCounts()/renderStatsView()), un cumul
        // sur plusieurs semaines (avant + affichée + suivante, voir computePastAstreinteCounts()),
        // pas juste la semaine affichée comme le reste de cette fonction. Elle ne doit donc jamais compter
        // comme "1 Scan U" dans le total/les badges de cette fonction, aussi contre-intuitif que ça
        // paraisse (Samir l'a dit lui-même) -- sinon elle serait comptée deux fois (ici ET dans sa
        // colonne dédiée), et fausserait aussi statsAvailabilityTier() (qui ne doit jamais tenir
        // compte de l'astreinte, voir sa déclaration).
        if (creneau.id === "astreinte") return;
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return;
        const assigned = effectiveAssignedIds(key).filter(Boolean);
        if (assigned.length === 0) return;

        if (activity.id === "bureau") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).bureau++;
          });
          return;
        }
        if (activity.id === "off") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).off++;
          });
          return;
        }

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
          const entry = ensureEntry(staffId);
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

// Colonne "Astreinte" dédiée de la vue Stats (24/07/2026, demande de Samir) : contrairement à
// toutes les autres colonnes de cette vue, ce n'est PAS un décompte de la seule semaine affichée --
// c'est un CUMUL. **Borne revue une 2e fois le 24/07/2026 (retour de Samir, "revenir en arrière") :
// ne compte plus la semaine SUIVANTE (N+1)** -- le comptage jusqu'à N+1 inclus (tenté le même jour)
// est retiré ; compte désormais les semaines jusqu'à N (semaine affichée) incluse, N+1 et au-delà
// exclues.
//
// Repli sur la trame ajouté le 24/07/2026 (bug remonté par Samir : "je ne vois pas le compteur
// s'incrémenter") -- une astreinte posée uniquement via la Trame Personnel (RG-017) n'est JAMAIS
// matérialisée dans state.assignments pour une semaine précise tant que personne n'y touche à la
// main. Deux cas distincts :
// - **Semaines strictement avant N** (`trackedWeeks`) : repli trame borné aux semaines ayant une
//   AUTRE preuve d'usage réel (au moins une affectation posée, n'importe quelle activité) -- pour ne
//   jamais inventer une astreinte sur une semaine d'avant que l'outil ne soit réellement utilisé.
// - **N** : repli trame SANS cette condition -- une semaine courante suit toujours la trame par
//   défaut (RG-017, `effectiveAssignedIds()`), pas besoin d'une preuve d'usage supplémentaire.
// Une vraie entrée dans state.assignments (même un tableau vide, ex. astreinte explicitement retirée)
// reste toujours prioritaire sur le repli trame, quelle que soit la semaine. Astreinte n'est possible
// que sur Scan U (RG-012), donc seules les clés "<semaine>|scan-u|<jour>|astreinte" sont concernées ;
// comparaison de `weekKeyPart` en chaîne ISO (comme partout ailleurs, l'ordre lexicographique suffit
// pour des dates "YYYY-MM-DD").
function computePastAstreinteCounts(monday) {
  const counts = new Map(); // staffId -> nombre d'astreintes sur des semaines jusqu'à N incluse.
  const currentWeekKey = weekKey(monday);

  const addCount = (staffId) => {
    if (!staffById(staffId)) return;
    counts.set(staffId, (counts.get(staffId) || 0) + 1);
  };

  // Semaines pour lesquelles l'outil a une preuve d'usage réel (au moins une affectation posée,
  // n'importe quelle activité) -- sert de borne au repli trame des semaines STRICTEMENT avant N,
  // pour ne jamais inventer une semaine antérieure à l'usage réel de l'outil.
  const trackedWeeks = new Set();
  Object.keys(state.assignments).forEach((key) => trackedWeeks.add(key.split("|")[0]));

  trackedWeeks.forEach((wk) => {
    if (wk >= currentWeekKey) return; // N traitée séparément juste en dessous.
    DAYS.forEach((day) => {
      const key = `${wk}|scan-u|${day}|astreinte`;
      if (Object.prototype.hasOwnProperty.call(state.assignments, key)) return; // vraie valeur déjà là, traitée juste en dessous, prioritaire sur la trame.
      if (state.fermetures[key]) return; // RG-010 : case fermée cette semaine-là, rien de réel dessus.
      (state.trame[`scan-u|${day}|astreinte`] || []).forEach(addCount);
    });
  });

  // N : repli trame inconditionnel (comme effectiveAssignedIds() pour une semaine courante), aucune
  // condition de semaine "suivie" nécessaire.
  DAYS.forEach((day) => {
    const key = `${currentWeekKey}|scan-u|${day}|astreinte`;
    if (state.fermetures[key]) return; // RG-010 : case fermée cette semaine-là, rien de réel dessus.
    const assigned = Object.prototype.hasOwnProperty.call(state.assignments, key)
      ? state.assignments[key]
      : state.trame[`scan-u|${day}|astreinte`] || [];
    assigned.forEach(addCount);
  });

  // Semaines strictement avant N, matérialisées directement dans state.assignments (prioritaire sur
  // le repli trame ci-dessus, voir le `hasOwnProperty` check).
  Object.keys(state.assignments).forEach((key) => {
    const [weekKeyPart, activityId, , creneauId] = key.split("|");
    if (activityId !== "scan-u" || creneauId !== "astreinte") return;
    if (weekKeyPart >= currentWeekKey) return; // N déjà traitée juste au-dessus.
    if (state.fermetures[key]) return; // RG-010 : case fermée cette semaine-là, rien de réel dessus.
    (state.assignments[key] || []).forEach(addCount);
  });

  return counts;
}

// Regroupement par disponibilité (24/07/2026, demande de Samir) : au-delà du tri habituel
// (compareStaffOrder -- grade/spécialité/alphabétique), les lignes de la vue Stats sont d'abord
// réparties en 3 blocs :
// 0 (haut) = a AU MOINS UNE vacation cette semaine, peu importe combien de jours couverts ;
// 1 (milieu) = aucune vacation du tout cette semaine, et PAS en congé -- vraiment libre, à solliciter ;
// 2 (tout en bas) = en congé toute la semaine (`isFullyOnLeaveThisWeek()`) -- hors-jeu cette semaine,
//     un total à 0 ici ne veut pas dire "libre" comme pour le bloc 1, ne pas les mélanger. Vérifié EN
//     PREMIER, avant le nombre de jours couverts : un congé toute la semaine prime sur n'importe quel
//     décompte de vacations (en pratique déjà 0, RG-014 empêchant l'assignation via la vue Personnel,
//     mais le popover d'ajout reste une porte de sortie).
// **Revu le 24/07/2026 (même jour, retour de Samir) : l'ancien 4e bloc ("postée tous les jours",
// qui passait APRÈS le bloc "aucune vacation") est retiré.** Il faisait remonter des personnes
// entièrement libres au-dessus de personnes avec 8-9 vacations dans la semaine -- contraire à la
// demande explicite : "toutes les personnes qui ont des vacations doivent être en haut", peu
// importe si la semaine est complète ou pas. Les 2 anciens blocs (partiel + complet) sont donc
// fusionnés en un seul bloc 0 ; le tri habituel (compareStaffOrder) s'applique ensuite à l'intérieur
// de ce bloc comme des 2 autres, exactement comme avant.
// **Revu une 2e fois le 24/07/2026 (retour de Samir, suite à la séparation des colonnes Bureau/Off,
// voir 6.16) : "avoir des données" ne se limite plus aux badges Vacations.** Depuis que Bureau/Off
// sont sortis du calcul de `days`/`total` (leur propre colonne, jamais dans les badges), quelqu'un
// avec UNIQUEMENT du Bureau ou de l'Off cette semaine (aucun vrai badge Vacations) retombait à tort
// dans le bloc 1 ("vraiment libre"), mélangé par le tri habituel avec des personnes qui n'ont
// STRICTEMENT rien -- confirmé sur une vraie capture d'écran (des personnes avec Bureau=1 ou Off=1
// intercalées parmi des lignes à 0 partout). Fix : le bloc 0 regarde maintenant aussi `entry.bureau`/
// `entry.off`, pas seulement `entry.days` -- Bureau/Off comptent comme "des données" même s'ils ne
// produisent pas de badge. **L'astreinte reste volontairement exclue** de ce calcul (voir plus haut,
// "jamais prise en compte pour des questions d'ordre", demande antérieure de Samir toujours valable)
// -- c'est un cumul historique, pas un signal de disponibilité de la semaine affichée.
// `stats` est le résultat de computeVacationStatsForWeek(), déjà calculé une fois par rendu.
function statsAvailabilityTier(person, stats) {
  if (isFullyOnLeaveThisWeek(person)) return 2;
  const entry = stats.get(person.id);
  const hasData = entry && (entry.days.size > 0 || entry.bureau > 0 || entry.off > 0);
  return hasData ? 0 : 1;
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

// Lundi de la semaine contenant `d` (24/07/2026, mode "Période") -- même logique que getMonday(),
// mais pour une date arbitraire au lieu de "aujourd'hui + un décalage de semaines". Nécessaire pour
// convertir une date quelconque d'une période choisie vers la même weekKey que celle utilisée par
// cellKey()/le reste de l'appli (state.assignments est toujours keyé par semaine, jamais par date).
function mondayOfDate(d) {
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() + diffToMonday);
  return monday;
}

// Jours ouvrés (Lundi-Vendredi) entre deux dates ISO incluses (mode "Période", 24/07/2026), avec le
// nom de jour et la weekKey correspondante déjà calculés -- pour construire directement les mêmes
// clés que cellKey() sans repasser par state.weekOffset (sans objet ici, une période peut mélanger
// semaines passées et futures).
function isoWeekdaysInRange(startIso, endIso) {
  const result = [];
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    const dow = cursor.getDay(); // 0 = dimanche ... 6 = samedi
    if (dow >= 1 && dow <= 5) {
      result.push({
        iso: toISODateLocal(cursor),
        dayName: DAYS[dow - 1],
        weekKeyPart: weekKey(mondayOfDate(cursor)),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// Période par défaut à la première bascule en mode "Période" (24/07/2026) : le mois en cours
// ("un mois par exemple", demande de Samir) -- dernier jour du mois via le "jour 0" du mois suivant,
// un idiome standard pour ne pas recalculer le nombre de jours du mois à la main.
function defaultStatsPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end) };
}

// Équivalent de effectiveAssignedIds(), mais pour une semaine ARBITRAIRE (pas forcément celle
// affichée dans le planning principal) -- 29/07/2026, bug remonté par Samir : le mode "Période"
// (voir computeVacationStatsForPeriod() juste en dessous) lisait state.assignments à sec, sans
// jamais retomber sur la trame, alors que le mode "Semaine" (via effectiveAssignedIds()) le fait
// pour la semaine actuelle/future -- résultat, une même période choisie dans les deux modes donnait
// des totaux différents (ex. Off/Bureau posés seulement dans la trame de Dubois : visibles en mode
// Semaine sur la semaine du 27/07, disparus en mode Période sur cette même semaine). Cause racine :
// effectiveAssignedIds() teste `state.weekOffset >= 0` (la semaine AFFICHÉE dans le planning
// principal), une notion sans rapport avec une semaine arbitraire parcourue ici -- le mode Période
// itère potentiellement plusieurs semaines (passées ET futures) dans une même plage, donc un seul
// flag global ne peut pas trancher correctement pour chacune. Cette variante compare directement la
// weekKey de la semaine en question à celle de la semaine réelle actuelle (comparaison de chaînes
// ISO, comme partout ailleurs dans le fichier) -- chaque semaine de la période reçoit donc sa propre
// décision, correcte même quand la plage mélange passé et futur.
function effectiveAssignedIdsForWeek(key, weekKeyPart) {
  if (Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    return state.assignments[key];
  }
  if (weekKeyPart >= weekKey(getMonday(0))) {
    return state.trame[trameKeyFromCellKey(key)] || [];
  }
  return [];
}

// Équivalent de computeVacationStatsForWeek() pour le mode "Période" (24/07/2026) -- même forme de
// résultat (avec `astreinte` en plus directement dans l'entrée, voir plus bas). Consulte désormais la
// trame via effectiveAssignedIdsForWeek() ci-dessus (29/07/2026, voir son commentaire) exactement
// comme le mode Semaine, pour que les deux modes restent cohérents sur une même période.
function computeVacationStatsForPeriod(startIso, endIso) {
  const stats = new Map(); // staffId -> { total, badges, days: Set(iso), bureau, off, astreinte }

  const ensureEntry = (staffId) => {
    if (!stats.has(staffId)) stats.set(staffId, { total: 0, badges: new Map(), days: new Set(), bureau: 0, off: 0, astreinte: 0 });
    return stats.get(staffId);
  };

  isoWeekdaysInRange(startIso, endIso).forEach(({ iso, dayName, weekKeyPart }) => {
    state.activities.forEach((activity) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = `${weekKeyPart}|${activity.id}|${dayName}|${creneau.id}`;
        if (state.fermetures[key]) return;
        const assigned = effectiveAssignedIdsForWeek(key, weekKeyPart);
        if (assigned.length === 0) return;

        if (creneau.id === "astreinte") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).astreinte++;
          });
          return;
        }
        if (activity.id === "bureau") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).bureau++;
          });
          return;
        }
        if (activity.id === "off") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).off++;
          });
          return;
        }

        let groupKey, label, specialite, isUrgence;
        if (activity.urgence) {
          groupKey = `urgence:${activity.id}`;
          label = activity.nom;
          specialite = null;
          isUrgence = true;
        } else {
          const family = activityStatsFamily(activity);
          specialite = state.vacationSpecialites[vacationSpecKey(activity.id, dayName, creneau.id)] || null;
          groupKey = `${family}:${specialite || "none"}`;
          label = STATS_FAMILY_LABELS[family] || activity.nom;
          isUrgence = false;
        }

        assigned.forEach((staffId) => {
          if (!staffById(staffId)) return;
          const entry = ensureEntry(staffId);
          entry.total++;
          entry.days.add(iso);
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

// Équivalent de isFullyOnLeaveThisWeek(), mais pour une plage de jours ouvrés ARBITRAIRE (mode
// "Période", 29/07/2026, bug remonté par Samir : "les Bureau/Off/Congés sont gérés différemment
// entre Semaine et Période sur les mêmes dates"). `businessDaysIso` = tableau de dates ISO déjà
// calculé une fois par rendu (voir periodDaysIso dans renderStatsView()), pour ne pas recalculer
// isoWeekdaysInRange() à chaque personne/comparaison de tri. Une plage vide n'est jamais "en congé".
function isFullyOnLeaveForRange(staffId, businessDaysIso) {
  return businessDaysIso.length > 0 && businessDaysIso.every((iso) => isOnCongeDay(staffId, iso) || isOnReposGardeDay(staffId, iso));
}

// Regroupement par disponibilité en mode "Période" (24/07/2026, revu le 29/07/2026) -- même principe
// que statsAvailabilityTier() (mode Semaine) : un congé couvrant TOUTE la période choisie prime sur
// n'importe quel décompte, même logique de généralisation qu'isFullyOnLeaveForRange() ci-dessus.
// **Avant le 29/07/2026, ce bloc n'existait pas du tout** ("pas de bloc congé toute la période...
// ne se généralise pas proprement à une plage arbitraire sans plus de précisions de Samir") -- une
// personne en congé sur toute une période se retrouvait mélangée avec les personnes réellement
// libres (bloc 1), ce qui a motivé le retour de Samir.
function statsPeriodTier(person, stats, periodDaysIso) {
  if (isFullyOnLeaveForRange(person.id, periodDaysIso)) return 2;
  const entry = stats.get(person.id);
  const hasData = entry && (entry.days.size > 0 || entry.bureau > 0 || entry.off > 0);
  return hasData ? 0 : 1;
}

function renderStatsView() {
  const container = document.getElementById("statsView");
  container.innerHTML = "";

  // Mode "Période" (24/07/2026) : initialise la plage par défaut (mois en cours) à la toute première
  // bascule, puis corrige silencieusement une plage inversée (fin choisie avant le début) plutôt que
  // d'afficher une période vide déroutante.
  if (statsMode === "period") {
    if (!statsRangeStart || !statsRangeEnd) {
      const def = defaultStatsPeriod();
      statsRangeStart = def.start;
      statsRangeEnd = def.end;
    }
    if (statsRangeStart > statsRangeEnd) {
      [statsRangeStart, statsRangeEnd] = [statsRangeEnd, statsRangeStart];
    }
  }

  const monday = getMonday(state.weekOffset);
  const stats = statsMode === "period"
    ? computeVacationStatsForPeriod(statsRangeStart, statsRangeEnd)
    : computeVacationStatsForWeek(monday);
  // En mode Semaine uniquement -- voir computePastAstreinteCounts() (cumul sur plusieurs semaines).
  // En mode Période, l'astreinte est directement dans `stats` (entry.astreinte), voir
  // computeVacationStatsForPeriod().
  const pastAstreintes = statsMode === "week" ? computePastAstreinteCounts(monday) : null;
  // Jours ouvrés de la période choisie, calculés une seule fois par rendu (29/07/2026) -- réutilisé
  // par statsPeriodTier() ci-dessous ET par la colonne Vacations plus bas (isFullyOnLeaveForRange()),
  // pour ne jamais recalculer isoWeekdaysInRange() par personne.
  const periodDaysIso = statsMode === "period" ? isoWeekdaysInRange(statsRangeStart, statsRangeEnd).map((d) => d.iso) : null;

  // Tri à deux niveaux : d'abord le bloc de disponibilité (statsAvailabilityTier() en mode Semaine,
  // statsPeriodTier() en mode Période, plus simple -- voir sa déclaration), puis le tri habituel
  // (grade/spécialité/alphabétique) à l'intérieur d'un bloc. L'astreinte n'entre JAMAIS dans ce tri.
  const people = state.staff.filter(personMatchesFilters).sort((a, b) => {
    const tierDiff = statsMode === "period"
      ? statsPeriodTier(a, stats, periodDaysIso) - statsPeriodTier(b, stats, periodDaysIso)
      : statsAvailabilityTier(a, stats) - statsAvailabilityTier(b, stats);
    if (tierDiff !== 0) return tierDiff;
    return compareStaffOrder(a, b);
  });

  // Bascule Semaine/Période (24/07/2026, demande de Samir) -- affichée avant tout le reste, y compris
  // si le filtre en cours ne matche personne, pour toujours pouvoir changer de mode/de plage.
  const modeBar = document.createElement("div");
  modeBar.className = "stats-mode-bar";
  const tabs = document.createElement("div");
  tabs.className = "stats-mode-tabs";
  [["week", "Semaine"], ["period", "Période"]].forEach(([mode, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stats-mode-tab" + (statsMode === mode ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (statsMode === mode) return;
      statsMode = mode;
      render();
    });
    tabs.appendChild(btn);
  });
  modeBar.appendChild(tabs);
  if (statsMode === "period") {
    const picker = document.createElement("div");
    picker.className = "stats-period-picker";
    const startInput = document.createElement("input");
    startInput.type = "date";
    startInput.value = statsRangeStart;
    startInput.addEventListener("change", () => {
      if (!startInput.value) return;
      statsRangeStart = startInput.value;
      render();
    });
    const sep = document.createElement("span");
    sep.textContent = "au";
    const endInput = document.createElement("input");
    endInput.type = "date";
    endInput.value = statsRangeEnd;
    endInput.addEventListener("change", () => {
      if (!endInput.value) return;
      statsRangeEnd = endInput.value;
      render();
    });
    picker.append(startInput, sep, endInput);
    modeBar.appendChild(picker);
  }
  container.appendChild(modeBar);

  if (people.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Aucune personne ne correspond aux filtres sélectionnés.";
    container.appendChild(hint);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "stats-table";
  const periodLabel = statsMode === "period"
    ? `du ${formatShort(new Date(`${statsRangeStart}T00:00:00`))} au ${formatShort(new Date(`${statsRangeEnd}T00:00:00`))}`
    : currentWeekLabel();
  const astreinteTitle = statsMode === "period"
    ? "Cumul des astreintes sur la période choisie"
    : "Cumul des astreintes jusqu'à la semaine affichée incluse (semaines d'avant + semaine affichée)";
  const noDataText = statsMode === "period" ? "Aucune vacation sur cette période." : "Aucune vacation cette semaine.";

  // Colonnes réordonnables à la main par glisser-déposer des en-têtes (24/07/2026, demande de Samir)
  // -- "Personnel" reste TOUJOURS fixe en 1re position (colonne figée), les 5 autres suivent l'ordre
  // choisi par Samir (state.statsColumnOrder, persisté). Chaque colonne = un descripteur d'en-tête
  // (libellé/classe/title) + une fonction qui construit sa cellule pour une ligne donnée -- un seul
  // endroit à modifier pour ajouter/changer une colonne, en-tête et corps du tableau restent
  // forcément synchronisés (jamais 2 listes à maintenir en parallèle).
  const columnDefs = {
    total: {
      label: "Total",
      headerClass: "stats-total-header",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.total : 0;
        td.appendChild(badge);
        return td;
      },
    },
    vacations: {
      label: `Vacations (${periodLabel})`,
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-badges-cell";
        if (statsMode === "week" && isFullyOnLeaveThisWeek(person)) {
          // Ligne gardée visible plutôt que masquée (contrairement au panneau Personnel, voir
          // isFullyOnLeaveThisWeek()) : un total à 0 sans explication laisserait croire à un oubli
          // plutôt qu'à une absence -- voir aussi buildAbsenceBar() pour la même logique ailleurs.
          const absence = document.createElement("span");
          absence.className = "stats-absence-label";
          absence.textContent = "Congés toute la semaine";
          td.appendChild(absence);
        } else if (statsMode === "period" && isFullyOnLeaveForRange(person.id, periodDaysIso)) {
          // Équivalent période (29/07/2026) -- voir isFullyOnLeaveForRange()/statsPeriodTier() : avant
          // ce fix, une personne en congé sur toute la période choisie tombait dans la branche `!entry`
          // juste en dessous (texte générique "Aucune vacation..."), indiscernable d'une personne
          // simplement libre -- désormais le même message explicite qu'en mode Semaine, adapté au mot
          // "période".
          const absence = document.createElement("span");
          absence.className = "stats-absence-label";
          absence.textContent = "Congés toute la période";
          td.appendChild(absence);
        } else if (!entry) {
          const empty = document.createElement("span");
          empty.className = "empty-hint";
          empty.textContent = noDataText;
          td.appendChild(empty);
        } else {
          sortedStatsBadges(entry).forEach((badge) => {
            const span = document.createElement("span");
            span.className = statBadgeClass(badge) + " stats-badge";
            span.textContent = `${badge.count} ${badge.label}`;
            td.appendChild(span);
          });
        }
        return td;
      },
    },
    astreinte: {
      label: "Astreinte",
      headerClass: "stats-total-header",
      headerTitle: astreinteTitle,
      // Cumul multi-semaines en mode Semaine (computePastAstreinteCounts()), décompte direct de la
      // période choisie en mode Période (entry.astreinte, voir computeVacationStatsForPeriod()).
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = statsMode === "period" ? (entry ? entry.astreinte : 0) : (pastAstreintes.get(person.id) || 0);
        td.appendChild(badge);
        return td;
      },
    },
    bureau: {
      label: "Bureau",
      headerClass: "stats-total-header",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.bureau : 0;
        td.appendChild(badge);
        return td;
      },
    },
    off: {
      label: "Off",
      headerClass: "stats-total-header",
      headerTitle: "Nombre de demi-journées (créneaux matin/après-midi)",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.off : 0;
        td.appendChild(badge);
        return td;
      },
    },
  };

  const columnOrder = normalizeStatsColumnOrder(state.statsColumnOrder);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const personnelTh = document.createElement("th");
  personnelTh.className = "activity-cell person-name-cell";
  personnelTh.textContent = "Personnel";
  headRow.appendChild(personnelTh);

  columnOrder.forEach((colId) => {
    const def = columnDefs[colId];
    const th = document.createElement("th");
    if (def.headerClass) th.className = def.headerClass;
    th.textContent = def.label;
    if (def.headerTitle) th.title = def.headerTitle;
    // Glisser-déposer d'en-tête pour réordonner (24/07/2026) : `dataset.columnId` identifie la
    // colonne, le drop recalcule l'ordre complet et le persiste (saveState()) -- même patron visuel
    // (.dragging/.drag-over) que le reste des glisser-déposer de l'appli.
    th.draggable = true;
    th.dataset.columnId = colId;
    th.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", colId);
      e.dataTransfer.effectAllowed = "move";
      th.classList.add("dragging");
    });
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (e) => {
      e.preventDefault();
      th.classList.add("drag-over");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drag-over"));
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      th.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === colId || !columnDefs[draggedId]) return;
      const order = normalizeStatsColumnOrder(state.statsColumnOrder);
      const fromIdx = order.indexOf(draggedId);
      const targetIdxBefore = order.indexOf(colId); // AVANT le retrait, pour savoir le sens du glissé.
      if (fromIdx === -1 || targetIdxBefore === -1) return;
      order.splice(fromIdx, 1);
      let insertAt = order.indexOf(colId); // position de la cible APRÈS le retrait (a pu décaler de 1).
      // Glissé vers l'avant (la cible était après la colonne déplacée) -> insertion APRÈS la cible,
      // pas avant -- sinon glisser une colonne sur sa voisine immédiate suivante ne bougeait rien
      // (le retrait + une insertion "avant" la remettait exactement à sa place d'origine).
      if (fromIdx < targetIdxBefore) insertAt += 1;
      order.splice(insertAt, 0, draggedId);
      state.statsColumnOrder = order;
      saveState();
      render();
    });
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  people.forEach((person) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = `${person.prenom[0]}. ${person.nom}`;
    nameCell.title = personTooltip(person);
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    const entry = stats.get(person.id);

    columnOrder.forEach((colId) => {
      tr.appendChild(columnDefs[colId].buildCell(person, entry));
    });

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

// RG-020 (Temps Partiel, 25/07/2026) : (dé)marque un créneau de la trame comme Temps Partiel pour
// une personne. Bloqué partout, y compris dans la Trame Personnel elle-même (contrairement à Off/
// RG-018) -- marquer Temps Partiel vide donc d'abord ce créneau de toute modalité déjà posée dans la
// trame, pour ne jamais laisser coexister les deux.
function setPersonTPForSlot(staffId, day, creneauId, value) {
  const flagKey = tpKey(staffId, day, creneauId);
  if (value) {
    state.activities.forEach((activity) => {
      const key = trameKey(activity.id, day, creneauId);
      if (state.trame[key]) state.trame[key] = state.trame[key].filter((id) => id !== staffId);
    });
    state.tempsPartiel[flagKey] = true;
  } else {
    delete state.tempsPartiel[flagKey];
  }
  saveState();
  render();
}

// Étiquette "Temps Partiel" affichée dans le popover Trame Personnel (RG-020) -- même patron que
// buildFermetureTag() (Trame Vacation) : un `×` retire le marquage, la case redevient "+ ajouter".
function buildTPTag(flagKey) {
  const tag = document.createElement("span");
  tag.className = "chip vacation-spec-tag tp-tag";
  tag.textContent = "Temps Partiel";
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    delete state.tempsPartiel[flagKey];
    saveState();
    render();
  });
  tag.appendChild(remove);
  return tag;
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
  // RG-020 : Temps Partiel bloque même dans la Trame Personnel elle-même (contrairement à Off).
  if (isPersonTPOnSlot(targetStaffId, targetDay, targetCreneauId)) return;
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
    propagateTrameAdditionToTouchedWeeks(activityId, targetDay, targetCreneauId, targetStaffId);
  }
  saveState();
  render();
}

function openTramePersonPopover(person, day, creneau, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderTramePersonPopoverContent(person, day, creneau);
  positionPopover(pop, cellEl);
}

// Équivalent de renderPersonPopoverContent() pour la trame -- écrit dans state.trame, pas de
// mention de semaine dans l'en-tête du popover (juste "(trame)"). RG-020 (25/07/2026) : Temps
// Partiel se gère depuis ce même popover (décision explicite de Samir, "éditable comme Off/Bureau")
// -- une case marquée Temps Partiel n'offre plus d'ajouter de modalité (bloqué même dans la trame
// elle-même), seulement de retirer le marquage ; une case normale gagne une option "Marquer Temps
// Partiel" en plus des modalités, même patron que l'option "Fermé" de la Trame Vacation.
function renderTramePersonPopoverContent(person, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  const flagKey = tpKey(person.id, day, creneau.id);
  const isTP = !!state.tempsPartiel[flagKey];
  const assignedActivities = isTP ? [] : trameActivitiesForPersonSlot(person.id, day, creneau.id);
  const assignedIds = new Set(assignedActivities.map((a) => a.id));
  // RG-012 : le créneau "astreinte" ne propose que Scan U (voir isCreneauApplicable()).
  const available = isTP ? [] : state.activities.filter((a) => !assignedIds.has(a.id) && isCreneauApplicable(a.id, creneau.id));

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${person.prenom} ${person.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label} (trame)</span>
    <div id="popAssigned" class="popover-assigned"></div>
    ${isTP ? "" : `<div class="popover-select" id="popCustomSelect">
      <button type="button" class="popover-select-trigger" id="popTrigger">-- Ajouter une modalité --</button>
      <div class="popover-select-list hidden" id="popList"></div>
    </div>`}
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (isTP) {
    assignedContainer.appendChild(buildTPTag(flagKey));
    assignedContainer.querySelector(".tp-tag .remove").addEventListener("click", () =>
      renderTramePersonPopoverContent(person, day, creneau)
    );
  } else if (assignedActivities.length === 0) {
    assignedContainer.innerHTML = '<span class="empty-hint">Aucune modalité assignée pour l\'instant</span>';
  } else {
    assignedActivities.forEach((activity) => {
      const key = trameKey(activity.id, day, creneau.id);
      const tag = buildTrameModaliteTag(activity, key, person.id);
      tag.querySelector(".remove").addEventListener("click", () => renderTramePersonPopoverContent(person, day, creneau));
      assignedContainer.appendChild(tag);
    });
  }

  if (!isTP) {
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
            propagateTrameAdditionToTouchedWeeks(activity.id, day, creneau.id, person.id);
            saveState();
            render();
            renderTramePersonPopoverContent(person, day, creneau);
          }
        });
        list.appendChild(row);
      });
    }

    // RG-020 : option distincte de la liste des modalités (même patron que l'option "Fermé" de la
    // Trame Vacation) -- vide d'abord ce créneau de toute modalité déjà posée (setPersonTPForSlot()).
    const tpRow = document.createElement("div");
    tpRow.className = "popover-select-option tp-option";
    tpRow.textContent = "Marquer Temps Partiel";
    tpRow.addEventListener("click", () => {
      setPersonTPForSlot(person.id, day, creneau.id, true);
      renderTramePersonPopoverContent(person, day, creneau);
    });
    list.appendChild(tpRow);

    document.getElementById("popTrigger").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopoverSelectList(e.currentTarget, list);
    });
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

// Jour ouvré actuel ("Lundi".."Vendredi"), ou `null` le week-end -- la Trame Personnel n'a pas de
// notion de semaine (contrairement à Congés/.conges-current-week), le jour du calendrier en tient
// lieu pour le repère "on est ici" (voir renderTramePersonnelView()).
function todayDayName() {
  const idx = new Date().getDay() - 1; // getDay() : 0=dimanche..6=samedi -> idx 0=Lundi..4=Vendredi
  return idx >= 0 && idx < DAYS.length ? DAYS[idx] : null;
}

function renderTramePersonnelView() {
  const container = document.getElementById("tramePersonnelView");
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "trame-personnel-table";

  const thead = document.createElement("thead");

  // Surlignage au survol (26/07/2026, demande de Samir -- même principe que la vue Congés,
  // voir personHeaderCells/.conges-highlight) : `dayHeaderCells`/`creneauHeaderCells` gardent une
  // référence vers chaque en-tête pour les mettre en valeur au survol d'une case du corps.
  const dayHeaderCells = {}; // day -> th (ligne du haut, colSpan=3)
  const creneauHeaderCells = {}; // `${day}|${creneauId}` -> th (ligne du bas)
  const today = todayDayName(); // pas de notion de semaine ici (contrairement à Congés) -- le jour
  // ouvré du calendrier en tient lieu pour le repère "on est ici" (null le week-end, rien surligné).

  const dayRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "corner-cell";
  dayRow.appendChild(corner);
  DAYS.forEach((day) => {
    const th = document.createElement("th");
    th.colSpan = CRENEAUX.length;
    th.className = "day-header day-start"; // séparateur de jour, voir §6.28/§6.29
    if (day === today) th.classList.add("trame-current-day");
    const label = document.createElement("div");
    label.className = "day-header-label";
    label.textContent = day;
    th.appendChild(label);
    dayRow.appendChild(th);
    dayHeaderCells[day] = th;
  });
  thead.appendChild(dayRow);

  const creneauRow = document.createElement("tr");
  const cornerLabel = document.createElement("th");
  cornerLabel.className = "modalite-header";
  cornerLabel.textContent = "Personnel";
  creneauRow.appendChild(cornerLabel);
  DAYS.forEach((day) => {
    CRENEAUX.forEach((c, creneauIdx) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "creneau-header";
      if (creneauIdx === 0) th.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
      creneauRow.appendChild(th);
      creneauHeaderCells[`${day}|${c.id}`] = th;
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
    nameCell.title = personTooltip(person);
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      const morningTP = isPersonTPOnSlot(person.id, day, "matin");
      const afternoonTP = isPersonTPOnSlot(person.id, day, "apres-midi");

      // Case normale (postable) pour UN créneau précis -- couvre aussi le Temps Partiel isolé
      // (matin seul, non fusionné -- voir la règle de fusion juste en dessous).
      const buildCell = (creneau) => {
        const td = document.createElement("td");
        td.className = "slot-cell";

        // RG-020 (Temps Partiel, 25/07/2026) : bloqué même dans la Trame Personnel elle-même
        // (décision explicite de Samir) -- une case marquée affiche juste "Temps Partiel", aucune
        // modalité ne peut être posée dessus (voir handleTrameModaliteDrop()/renderTramePersonPopoverContent()).
        const isTP = isPersonTPOnSlot(person.id, day, creneau.id);
        const activitiesHere = isTP ? [] : trameActivitiesForPersonSlot(person.id, day, creneau.id);

        if (isTP) {
          td.classList.add("cell-tp-marked");
          const badge = document.createElement("span");
          badge.className = "absence-label";
          badge.textContent = "Temps Partiel";
          td.appendChild(badge);
        } else if (activitiesHere.length === 0) {
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

        // RG-018 : simple repère visuel ici (pas de blocage -- la trame elle-même n'empêche pas de
        // cumuler Off et une autre activité sur le même créneau, seule la semaine réelle l'interdit,
        // voir handleAssignmentDrop()/handleModaliteDrop()). But : voir d'un coup d'œil qu'un
        // créneau Off existe déjà avant d'y ajouter autre chose par erreur.
        if (activitiesHere.some((a) => a.id === "off")) td.classList.add("cell-off-marked");

        // Toujours cliquable, même en Temps Partiel (RG-020, "éditable comme Off/Bureau") -- le
        // popover propose alors uniquement de retirer le marquage (voir renderTramePersonPopoverContent()).
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

        // Surlignage au survol (26/07/2026) : met en valeur le nom (ligne) et le créneau précis
        // (colonne) -- même principe que la vue Congés (personHeaderCells/.conges-highlight).
        const creneauHeaderCell = creneauHeaderCells[`${day}|${creneau.id}`];
        td.addEventListener("mouseenter", () => {
          nameCell.classList.add("trame-highlight");
          creneauHeaderCell.classList.add("trame-highlight");
        });
        td.addEventListener("mouseleave", () => {
          nameCell.classList.remove("trame-highlight");
          creneauHeaderCell.classList.remove("trame-highlight");
        });

        return td;
      };

      // RG-020 (25/07/2026, demande de Samir) : fusionne matin+astreinte+après-midi (colSpan=3) si
      // Temps Partiel matin ET après-midi à la fois, ou seulement astreinte+après-midi (colSpan=2)
      // si Temps Partiel après-midi seul -- même règle que la vue Personnel réelle
      // (renderPersonnelRows()/isPersonUnavailableAllDay(), pas de congé possible ici). Ancre le
      // clic/glisser-déposé sur "après-midi" (toujours Temps Partiel dans les deux cas fusionnés) --
      // retirer Temps Partiel depuis une case fusionnée ne clarifie donc que la moitié après-midi ;
      // si les deux moitiés étaient fusionnées, un second clic sur la case matin (redevenue
      // distincte au rendu suivant) reste nécessaire pour tout effacer -- limite acceptée pour ne
      // pas complexifier le popover (voir regles-gestion.md RG-020).
      const buildMergedTPCell = (colSpan) => {
        const td = document.createElement("td");
        td.className = "slot-cell cell-tp-marked";
        td.colSpan = colSpan;
        const badge = document.createElement("span");
        badge.className = "absence-label";
        badge.textContent = "Temps Partiel";
        td.appendChild(badge);
        td.addEventListener("click", () => openTramePersonPopover(person, day, CRENEAUX[2], td));
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
          handleTrameModaliteDrop(e, person.id, day, "apres-midi");
        });

        // Surlignage au survol : une case fusionnée couvre plusieurs créneaux, donc la case
        // "colonne" mise en valeur est l'en-tête du JOUR entier (pas un créneau précis).
        const dayHeaderCell = dayHeaderCells[day];
        td.addEventListener("mouseenter", () => {
          nameCell.classList.add("trame-highlight");
          dayHeaderCell.classList.add("trame-highlight");
        });
        td.addEventListener("mouseleave", () => {
          nameCell.classList.remove("trame-highlight");
          dayHeaderCell.classList.remove("trame-highlight");
        });
        return td;
      };

      // .day-start (25/07/2026) : séparateur de jour plus visible, voir §6.28/style.css.
      if (morningTP && afternoonTP) {
        const cell = buildMergedTPCell(3);
        cell.classList.add("day-start");
        tr.appendChild(cell);
      } else {
        const morningCell = buildCell(CRENEAUX[0]);
        morningCell.classList.add("day-start");
        tr.appendChild(morningCell);
        if (afternoonTP) {
          tr.appendChild(buildMergedTPCell(2));
        } else {
          tr.appendChild(buildCell(CRENEAUX[1]));
          tr.appendChild(buildCell(CRENEAUX[2]));
        }
      }
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
  positionPopover(pop, cellEl);
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
    togglePopoverSelectList(e.currentTarget, list);
  });
}

// Popover symétrique pour la vue Personnel : personne + créneau fixés, on choisit la modalité.
function openPersonAssignPopover(person, day, creneau, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderPersonPopoverContent(person, day, creneau);
  positionPopover(pop, cellEl);
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
    togglePopoverSelectList(e.currentTarget, list);
  });
}

document.addEventListener("click", (e) => {
  const pop = document.getElementById("assignPopover");
  if (!pop.contains(e.target) && !e.target.closest(".slot-cell") && !e.target.closest(".popover-anchor")) {
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

// Titre "Planning Imagerie" devenu bouton (24/07/2026, demande de Samir, remplace l'ancien bouton
// "Retour Planning" séparé -- même comportement, juste porté par le titre) : toujours au même
// endroit dans la topbar (à gauche, avant le statut de synchro), quel que soit l'écran affiché --
// contrairement aux boutons Trame/Congés/Stats, qui ne redeviennent "← Retour au planning" que
// lorsque LEUR PROPRE mode est actif (donc jamais au même endroit selon d'où on revient). Un seul
// clic ici désactive les 3 modes plein-écran d'un coup, peu importe lequel était actif.
document.getElementById("btnPlanningHome").addEventListener("click", () => {
  editingTrame = false;
  editingConges = false;
  editingStats = false;
  resetFullScreenModeButtons(); // aucun exceptId -- remet les 3 boutons à leur libellé/état normal.
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

// RG-017 (26/07/2026, ⚙ → "Resynchroniser la trame") : rattrape en une fois les ajouts de trame
// faits AVANT que propagateTrameAdditionToTouchedWeeks() n'existe -- purement additif (jamais de
// retrait), donc confirm() en amont est plus une précaution qu'un vrai risque de perte de données.
document.getElementById("btnResyncTrame").addEventListener("click", () => {
  if (!confirm("Resynchroniser la trame vers les semaines déjà touchées ? Chaque personne présente dans la Trame Personnel sera ajoutée sur les semaines actuelle/futures qui ont déjà une affectation différente pour ce créneau précis -- rien n'est jamais retiré ni remplacé.")) return;
  const count = resyncTrameToTouchedWeeks();
  saveState();
  render();
  alert(count > 0 ? `${plural(count, "ajout")} appliqué${count > 1 ? "s" : ""} sur les semaines déjà touchées.` : "Rien à ajouter -- les semaines déjà touchées correspondaient déjà à la trame.");
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
  staffModalSearchQuery = "";
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
    <input type="text" id="staffSearchInput" class="staff-search-input" placeholder="Rechercher un nom ou prénom...">
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
  const searchInput = document.getElementById("staffSearchInput");
  searchInput.value = staffModalSearchQuery;
  searchInput.addEventListener("input", () => {
    staffModalSearchQuery = searchInput.value;
    renderStaffModalList(document.getElementById("staffModalList"));
  });
  renderStaffModalList(document.getElementById("staffModalList"));
}

// Insensible aux accents/casse (normalizeToken(), déjà utilisée pour l'import ARI/en masse) --
// cherche le texte tapé comme sous-chaîne dans "prénom nom", donc "dubois" ou "maeva" (sans tréma)
// matchent aussi bien que "Dubois"/"Maëva".
function personMatchesSearch(person, query) {
  if (!query.trim()) return true;
  const haystack = normalizeToken(`${person.prenom} ${person.nom}`);
  return haystack.includes(normalizeToken(query));
}

function renderStaffModalList(container) {
  container.innerHTML = "";
  const searched = state.staff.filter((p) => personMatchesSearch(p, staffModalSearchQuery));
  const normal = searched.filter((p) => !p.horsSisu);
  const seniors = normal.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
  const internes = normal.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);
  // RG-016 (23/07/2026) : à part, jamais mélangées aux séniors/internes -- pas forcément de grade,
  // triées alphabétiquement (voir regles-gestion.md).
  const horsSisu = searched.filter((p) => p.horsSisu).sort(compareNomPrenom);

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
  } else if (searched.length === 0) {
    const empty = document.createElement("div");
    empty.className = "staff-modal-empty";
    empty.textContent = "Aucun membre ne correspond à cette recherche.";
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
      <div class="form-row form-row-checkbox" id="formCCARow">
        <label for="formCCA"><input type="checkbox" id="formCCA"> CCA</label>
        <span class="form-hint">Un type de sénior -- filtrable à part dans le panneau Personnel.</span>
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
      <div class="form-row form-row-competences">
        <label>Compétences</label>
        <div class="form-competences-list">
          ${SPECIALITE_ORDER.map((k) => `<label class="form-competence-option"><input type="checkbox" class="formCompetence" value="${k}"> ${SPECIALITES[k].label}</label>`).join("")}
        </div>
        <span class="form-hint">Indépendant de la spécialité ci-dessus -- sert au futur moteur de règles, affiché seulement au survol (jamais de couleur).</span>
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
  const ccaCheckbox = document.getElementById("formCCA");
  const typeSelect = document.getElementById("formInterneType");
  const spec1Select = document.getElementById("formSpec1");
  const spec2Select = document.getElementById("formSpec2");

  horsSisuCheckbox.checked = initialHorsSisu;
  ccaCheckbox.checked = existingPerson ? !!existingPerson.cca : false;

  const competenceCheckboxes = [...container.querySelectorAll(".formCompetence")];
  if (existingPerson) {
    const initialCompetences = new Set(existingPerson.competences || []);
    competenceCheckboxes.forEach((cb) => { cb.checked = initialCompetences.has(cb.value); });
  }

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

    // CCA n'a de sens que pour un sénior (grade === "senior") -- masqué et décoché sinon, pour ne
    // jamais enregistrer un CCA fantôme sur un interne ou une personne sans grade renseigné.
    const isSenior = gradeSelect.value === "senior";
    document.getElementById("formCCARow").style.display = isSenior ? "flex" : "none";
    if (!isSenior) ccaCheckbox.checked = false;

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

    // Compétences : indépendantes du grade/de la spécialité, aucune contrainte de nombre.
    const competences = competenceCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    // CCA : un type de sénior -- jamais vrai si le grade final n'est pas "senior" (la case est de
    // toute façon masquée/décochée par updateVisibility() dans ce cas, ce garde-fou est redondant
    // mais évite tout risque si le DOM était dans un état inattendu).
    const cca = grade === "senior" && ccaCheckbox.checked;

    if (existingPerson) {
      existingPerson.prenom = prenom;
      existingPerson.nom = nom;
      existingPerson.horsSisu = horsSisu;
      existingPerson.grade = grade;
      existingPerson.specialites = specialites;
      existingPerson.competences = competences;
      existingPerson.cca = cca;
    } else {
      state.staff.push({ id: generateStaffId(), prenom, nom, horsSisu, grade, specialites, competences, cca });
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

// ---------- Import trame personnel (Off / Bureau / Temps Partiel), 25/07/2026 ----------
// Texte libre collé par Samir (liste RH type "Off le mercredi" / "Bureau le mardi après-midi" /
// "Présent(e) le lundi matin"), à ne pas confondre avec l'extract ARI ci-dessus (fichier .xlsx,
// congés/gardes). Écrit dans state.trame (Off/Bureau, RG-017) et state.tempsPartiel (RG-020).

const DAY_NAME_RE = /(lundi|mardi|mercredi|jeudi|vendredi)/i;

// Isole le nom de jour (n'importe où dans le fragment -- inutile de retirer "le"/"la"/"les" avant,
// la regex le trouve directement) et ce qui suit ("après-midi", "toute la journée"...).
function describeDayFragment(fragment) {
  const m = DAY_NAME_RE.exec(fragment);
  if (!m) return null;
  const day = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const rest = fragment.slice(m.index + m[0].length).trim();
  return { day, slotText: rest, hasExplicitSlot: rest.length > 0 };
}

// "" ou "toute la journée" -> jour entier ; "après-midi"/"après midi"/"apres-midi" (tolérant à
// l'absence de tiret, rencontrée dans le texte réel) -> après-midi seul ; "matin" -> matin seul.
function slotTextToCreneaux(slotText) {
  const norm = normalizeToken(slotText || "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (!norm || norm.includes("toute")) return ["matin", "apres-midi"];
  if (norm.includes("apres") && norm.includes("midi")) return ["apres-midi"];
  if (norm.includes("matin")) return ["matin"];
  return ["matin", "apres-midi"]; // texte non reconnu -- jour entier par défaut plutôt que rien.
}

// Analyse un texte de jours/créneaux ("le mardi après-midi et vendredi matin", "mardi toute la
// journée", "lundi et mardi toute la journée"...) en une liste de {day, creneauId}. Cas particulier :
// "jourA et jourB <suffixe>" où seul jourB porte un suffixe explicite (matin/après-midi/toute la
// journée) -- ce suffixe s'applique alors AUSSI à jourA (ex. "lundi et mardi toute la journée" = les
// deux jours entiers), distinct du cas où les deux jours ont chacun leur propre suffixe (ex. "jeudi
// matin et vendredi toute la journée", traités indépendamment).
function parseDaySlotsText(text) {
  const result = [];
  const addFragment = (desc) => {
    if (!desc) return;
    slotTextToCreneaux(desc.slotText).forEach((creneauId) => result.push({ day: desc.day, creneauId }));
  };

  String(text || "").split(/\s*,\s*/).forEach((commaPart) => {
    const etParts = commaPart.split(/\s+et\s+/i);
    if (etParts.length === 2) {
      const a = describeDayFragment(etParts[0]);
      const b = describeDayFragment(etParts[1]);
      if (a && b && !a.hasExplicitSlot) {
        addFragment({ day: a.day, slotText: b.slotText });
        addFragment(b);
      } else {
        addFragment(a);
        addFragment(b);
      }
    } else {
      addFragment(describeDayFragment(commaPart));
    }
  });
  return result;
}

// En-têtes de section reconnus dans le texte collé -- tout ce qui précède le premier en-tête
// reconnu est ignoré (pas de section active). "Temps pleins"/"CCA" partagent le même format
// (Off + Bureau, multi-lignes par personne) ; "Temps partiel" a son propre format (1 ligne par
// personne, "Prénom Nom Présent(e) ...").
const TRAME_IMPORT_SECTION_RE = /^(temps\s*plein|cca|temps\s*partiel)s?$/i;

function parseTrameImportText(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fullEntries = []; // { rawName, offSlots: [...], bureauSlots: [...] }
  const tpEntries = []; // { rawName, presentSlots: [...] }

  let section = null; // "full" | "tp"
  let current = null; // entrée "full" en cours (rattache les lignes "Off"/"Bureau" suivantes)

  lines.forEach((line) => {
    if (TRAME_IMPORT_SECTION_RE.test(line)) {
      section = /partiel/i.test(line) ? "tp" : "full";
      current = null;
      return;
    }
    if (!section) return;

    if (section === "tp") {
      const m = /^(.+?)\s+Pr[ée]sente?\s+(.+)$/i.exec(line);
      if (m) tpEntries.push({ rawName: m[1].trim(), presentSlots: parseDaySlotsText(m[2].trim()) });
      return;
    }

    const offMatch = /^Off\s+(.+)$/i.exec(line);
    const bureauMatch = /^Bureau\s+(.+)$/i.exec(line);
    if (offMatch && current) {
      current.offSlots = parseDaySlotsText(offMatch[1].trim());
    } else if (bureauMatch && current) {
      current.bureauSlots = parseDaySlotsText(bureauMatch[1].trim());
    } else {
      current = { rawName: line, offSlots: [], bureauSlots: [] };
      fullEntries.push(current);
    }
  });

  return { fullEntries, tpEntries };
}

// Rapprochement tolérant aux fautes -- réutilise matchAriNameToStaff() (générique malgré son nom,
// compare simplement un nom brut à state.staff par ensemble de mots normalisés), même pattern
// exact/fuzzy/non-reconnu que l'import ARI.
function buildTrameImportPreview(parsed) {
  const exact = [];
  const fuzzy = [];
  const unrecognized = [];

  parsed.fullEntries.forEach((entry) => {
    const match = matchAriNameToStaff(entry.rawName);
    if (match.status === "none") { unrecognized.push({ rawName: entry.rawName }); return; }
    const item = { kind: "full", rawName: entry.rawName, person: match.person, offSlots: entry.offSlots, bureauSlots: entry.bureauSlots };
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  parsed.tpEntries.forEach((entry) => {
    const match = matchAriNameToStaff(entry.rawName);
    if (match.status === "none") { unrecognized.push({ rawName: entry.rawName }); return; }
    const item = { kind: "tp", rawName: entry.rawName, person: match.person, presentSlots: entry.presentSlots };
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  return { exact, fuzzy, unrecognized };
}

function clearTrameActivitiesForSlot(staffId, day, creneauId) {
  state.activities.forEach((activity) => {
    const key = trameKey(activity.id, day, creneauId);
    if (state.trame[key]) state.trame[key] = state.trame[key].filter((id) => id !== staffId);
  });
}

// Idempotent, comme l'import ARI : ré-appliquer le même texte (ou un texte mis à jour) ne laisse
// jamais de trace de l'ancien horaire -- pour "full", ajoute simplement (sans dupliquer) ; pour
// "tp", recalcule les 10 créneaux (5 jours x matin/après-midi) en entier à chaque fois (les
// créneaux "présents" redeviennent normaux, les autres repassent/restent Temps Partiel).
function applyTrameImportItems(items) {
  items.forEach((item) => {
    if (item.kind === "full") {
      item.offSlots.forEach(({ day, creneauId }) => {
        const key = trameKey("off", day, creneauId);
        if (!state.trame[key]) state.trame[key] = [];
        if (!state.trame[key].includes(item.person.id)) state.trame[key].push(item.person.id);
      });
      item.bureauSlots.forEach(({ day, creneauId }) => {
        const key = trameKey("bureau", day, creneauId);
        if (!state.trame[key]) state.trame[key] = [];
        if (!state.trame[key].includes(item.person.id)) state.trame[key].push(item.person.id);
      });
    } else {
      const presentSet = new Set(item.presentSlots.map(({ day, creneauId }) => `${day}|${creneauId}`));
      DAYS.forEach((day) => {
        ["matin", "apres-midi"].forEach((creneauId) => {
          const flagKey = tpKey(item.person.id, day, creneauId);
          if (presentSet.has(`${day}|${creneauId}`)) {
            delete state.tempsPartiel[flagKey];
          } else {
            clearTrameActivitiesForSlot(item.person.id, day, creneauId);
            state.tempsPartiel[flagKey] = true;
          }
        });
      });
    }
  });
  saveState();
  render();
}

function trameImportSlotsLabel(slots) {
  return slots.map((s) => `${s.day} ${s.creneauId === "matin" ? "matin" : "après-midi"}`).join(", ");
}

function trameImportItemLabel(item) {
  const who = `${item.person.prenom} ${item.person.nom}`;
  if (item.kind === "full") {
    const parts = [];
    if (item.offSlots.length) parts.push(`Off : ${trameImportSlotsLabel(item.offSlots)}`);
    if (item.bureauSlots.length) parts.push(`Bureau : ${trameImportSlotsLabel(item.bureauSlots)}`);
    return `${who} — ${parts.join(" · ") || "rien à appliquer"}`;
  }
  return `${who} — Temps Partiel (présent : ${trameImportSlotsLabel(item.presentSlots) || "aucun créneau"})`;
}

function openTrameImportModal() {
  document.getElementById("trameImportModal").classList.remove("hidden");
  document.getElementById("trameImportModalBody").innerHTML = `
    <p class="bulk-hint">Colle le texte listant Off / Bureau (Temps pleins, CCA) et Temps partiel, puis clique sur Analyser.</p>
    <textarea id="trameImportTextarea" rows="14" style="width:100%;box-sizing:border-box;"></textarea>
    <button type="button" id="btnTrameImportParse" class="btn-primary" style="margin-top:8px;">Analyser</button>
  `;
  document.getElementById("btnTrameImportParse").addEventListener("click", () => {
    const text = document.getElementById("trameImportTextarea").value;
    const preview = buildTrameImportPreview(parseTrameImportText(text));
    renderTrameImportPreview(preview);
  });
}

function closeTrameImportModal() {
  document.getElementById("trameImportModal").classList.add("hidden");
}

function renderTrameImportPreview(preview) {
  const body = document.getElementById("trameImportModalBody");
  body.innerHTML = "";

  if (preview.exact.length === 0 && preview.fuzzy.length === 0) {
    body.innerHTML = '<p class="bulk-hint">Rien de reconnu dans ce texte (vérifie le format, ou tout le monde est déjà à jour).</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "bulk-hint";
  summary.textContent = `${plural(preview.exact.length, "personne")} reconnue${preview.exact.length > 1 ? "s" : ""} automatiquement.`;
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
    info.textContent = `"${item.rawName}" → ${trameImportItemLabel(item)}`;
    row.appendChild(info);
    list.appendChild(row);
  });

  preview.exact.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bulk-preview-row bulk-preview-duplicate";
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = trameImportItemLabel(item);
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
    pre.textContent = preview.unrecognized.map((it) => it.rawName).join("\n");
    details.appendChild(pre);
    body.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    applyTrameImportItems(allItems.filter((it) => it.include));
    closeTrameImportModal();
  });
  body.appendChild(confirmBtn);
}

document.getElementById("btnImportTrame").addEventListener("click", openTrameImportModal);
document.getElementById("trameImportModalClose").addEventListener("click", closeTrameImportModal);
document.getElementById("trameImportModal").addEventListener("click", (e) => {
  if (e.target.id === "trameImportModal") closeTrameImportModal();
});

// ---------- Personnalisation (25/07/2026) ----------
// Quelques couleurs éditables depuis l'appli sans passer par un changement de code (demande de
// Samir, suite aux allers-retours sur la couleur du séparateur de jour, §6.28) -- voir
// CUSTOM_COLOR_FIELDS/applyCustomColors() plus haut (state.customColors, persistée comme le reste).

function openCustomizeModal() {
  document.getElementById("customizeModal").classList.remove("hidden");
  renderCustomizeModalBody();
}

function closeCustomizeModal() {
  document.getElementById("customizeModal").classList.add("hidden");
}

function renderCustomizeModalBody() {
  const body = document.getElementById("customizeModalBody");
  body.innerHTML = '<p class="bulk-hint">Ajuste quelques couleurs de l\'appli -- appliqué immédiatement, sans recharger.</p>';

  CUSTOM_COLOR_FIELDS.forEach(({ key, cssVar, label, widthKey, widthVar }) => {
    const row = document.createElement("div");
    row.className = "customize-row";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = "color";
    // Valeur actuelle = state.customColors[key] si personnalisée, sinon la valeur par défaut
    // définie dans :root (style.css) -- un <input type="color"> exige toujours une vraie valeur.
    input.value = state.customColors[key] || getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    input.addEventListener("input", () => {
      state.customColors[key] = input.value;
      applyCustomColors();
      saveState();
    });
    row.appendChild(input);

    // Réglage d'épaisseur (25/07/2026, demande de Samir) : seul le séparateur de jour en a un.
    if (widthKey) {
      const defaultWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue(widthVar), 10) || 2;
      const widthInput = document.createElement("input");
      widthInput.type = "range";
      widthInput.min = "1";
      widthInput.max = "6";
      widthInput.step = "1";
      widthInput.className = "customize-width-input";
      widthInput.title = "Épaisseur du trait";
      widthInput.value = state.customColors[widthKey] || defaultWidth;
      widthInput.addEventListener("input", () => {
        state.customColors[widthKey] = widthInput.value;
        applyCustomColors();
        saveState();
      });
      row.appendChild(widthInput);
    }

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "customize-reset-btn";
    resetBtn.textContent = "Réinitialiser";
    resetBtn.addEventListener("click", () => {
      delete state.customColors[key];
      if (widthKey) delete state.customColors[widthKey];
      applyCustomColors();
      saveState();
      renderCustomizeModalBody();
    });
    row.appendChild(resetBtn);

    body.appendChild(row);
  });
}

document.getElementById("btnCustomize").addEventListener("click", openCustomizeModal);
document.getElementById("customizeModalClose").addEventListener("click", closeCustomizeModal);
document.getElementById("customizeModal").addEventListener("click", (e) => {
  if (e.target.id === "customizeModal") closeCustomizeModal();
});

// ---------- Démarrage ----------

loadState();
render();
setFileSyncStatus(fileSyncStatus); // affiche "non connecté" dans la topbar avant même la tentative de connexion auto ci-dessous.
tryAutoConnectGitHub(); // async -- re-render si un jeton est déjà enregistré et valide.
