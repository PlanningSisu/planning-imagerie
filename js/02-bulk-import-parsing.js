// currentQuarter() vit ici (pas dans 06-conges-model.js avec le reste de son sujet) car
// congesQuarter plus bas dans ce fichier l'appelle immédiatement au chargement -- avec le
// découpage en plusieurs <script>, le hoisting de fonction ne traverse plus les fichiers.
function currentQuarter(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

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

// Affichage des badges "manquant" (05/08/2026, §6.42) -- décoché par défaut ("pour masquer
// l'affichage des manquants dans un premier temps", demande de Samir, "on verra à l'usage") :
// transitoire, non persisté, repart décoché à chaque rechargement comme statsMode.
let statsShowMissing = false;

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
// grades: "senior" | "interne" | "cca" | "tempsPlein". specialites: "digestif"|"uro"|"gyneco"|"thorax"|"socle".
// Réutilisés tels quels par la vue Congés (colonnes filtrées par les mêmes puces, voir 6.x
// CLAUDE.md) -- volontairement le même state partagé, pas une copie, pour rester cohérent
// entre les deux vues sans dupliquer la logique de filtre.
// "cca" (29/07/2026) : pas un grade à part entière (aucun person.grade ne vaut jamais "cca"), juste
// une 3e VALEUR dans le même Set que "senior"/"interne" -- CCA est un sous-ensemble de Sénior
// (person.cca === true implique toujours person.grade === "senior"). Grâce au OR déjà en place dans
// cette catégorie, cliquer "Sénior" seul montre tous les séniors CCA compris (ils ont grade==="senior",
// donc matchent déjà) ; cliquer "CCA" seul isole les CCA ; cocher les deux ne change rien de plus que
// "Sénior" seul (CCA ⊆ Sénior) -- exactement le comportement demandé par Samir, sans code spécial.
// "tempsPlein" (05/08/2026) : même principe qu'CCA, une 4e VALEUR dans le même Set -- mais
// contrairement à CCA, PAS un sous-ensemble d'un seul grade (visible/cochable pour un sénior comme
// pour un interne, voir renderStaffAddForm()) : cliquer "TP" seul isole tout le monde en Temps Plein,
// peu importe le grade.
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
    const matchesGrade = [...staffFilters.grades].some((g) => {
      if (g === "cca") return !!person.cca;
      if (g === "tempsPlein") return !!person.tempsPlein;
      return person.grade === g;
    });
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

function creneauLabel(creneauId) {
  const creneau = CRENEAUX.find((c) => c.id === creneauId);
  return creneau ? creneau.label : creneauId;
}

// Seule Scan U utilise le créneau "astreinte" ; pour toute autre activité, cette case n'existe pas
// fonctionnellement (pas d'assignation, pas de spécialité/fermeture) -- voir regles-gestion.md RG-012.
function isCreneauApplicable(activityId, creneauId) {
  return creneauId !== "astreinte" || activityId === "scan-u";
}

const STORAGE_KEY = "planningAppState_v3";

