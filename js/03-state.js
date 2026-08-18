// ---------- État ----------

// Le fichier partagé (voir section "Fichier partagé" plus bas) devient la donnée de PRODUCTION à
// partir du 22/07/2026, plus une donnée de dev jetable comme l'était le localStorage jusqu'ici (le
// renommage de clé _v1 -> _v2 -> _v3 se contentait de tout jeter à chaque refonte de structure, ce
// qui n'est plus acceptable une fois que de vraies données de service sont en jeu). Toute évolution
// future de la structure de state doit donc passer par une entrée de STATE_MIGRATIONS plutôt que de
// casser silencieusement les fichiers déjà écrits sur le drive ou déjà exportés en JSON.
const STATE_SCHEMA_VERSION = 18;

// Moteur de règles paramétrable (09/08/2026, voir moteur-regles-brouillon.md) : remplace les
// anciennes RG-002/003/007/009/012 codées en dur par des données éditables depuis l'écran "Règles"
// (js/21-vue-regles.js). Définie ICI (pas dans js/07-validation-rg.js, qui charge après ce fichier)
// parce qu'elle sert de valeur par défaut au premier chargement de `state` juste en dessous --
// référencer un `const` d'un fichier chargé plus tard casserait au chargement (piège de hoisting
// entre <script> séparés, voir CLAUDE.md §2 point 4). `validateCompositionRules()`/
// `resolveCompositionRule()` (js/07-validation-rg.js) lisent `state.rules` à l'exécution, jamais
// cette constante directement -- elle ne sert qu'à amorcer un fichier neuf ou migrer un ancien
// (STATE_MIGRATIONS[10]/[17] plus bas).
//
// Restructurée le 18/08/2026 (RG-036, "je veux pouvoir dans la même fenêtre de modification choisir
// jour par jour si la règle s'applique le matin ou l'après-midi ou les deux") : UNE règle = UNE
// modalité (`activityId`/`labelPrefix`, partagés), contenant plusieurs SEGMENTS -- chacun son propre
// jour(s)/créneau(x)/composition, exactement ce qu'une règle "à plat" portait seule avant ce
// changement. Ce qui était 4 règles séparées pour Scan U (RG-002/003/007/012) devient une seule
// règle à 4 segments. `resolveCompositionRule()` (js/07-validation-rg.js) résout d'abord la modalité
// (une seule règle par activityId désormais, imposé par l'écran) puis le segment le plus spécifique
// (même algorithme "le moins de jours gagne" qu'avant, juste déplacé d'un cran) -- elle renvoie un
// objet APLATI (segment + activityId/labelPrefix du conteneur) identique en forme à l'ancienne règle
// à plat, donc TOUS les autres consommateurs (validateCompositionRules(), compositionShortfallMessage(),
// le générateur automatique...) continuent de fonctionner sans aucun changement.
// `rule.id` identifie la règle/modalité ; `segment.id` identifie un segment dans `rule.segments` --
// DISTINCT de `segment.rg`, qui n'est qu'un LABEL affiché (le badge coloré devant chaque violation/
// recommandation) : deux segments de la même modalité peuvent partager le même `rg` (ex. "Scan B"
// pour deux segments différents), jamais le même `id`. Pour les 5 segments historiques, `id` reprend
// le code RG-XXX (déjà unique) ; un segment créé depuis l'écran génère un id via generateSegmentId()
// (js/21-vue-regles.js) et utilise le nom de la modalité comme `rg` (label).
const DEFAULT_COMPOSITION_RULES = [
  {
    id: "rule-scan-u", activityId: "scan-u", labelPrefix: "Scan U",
    segments: [
      {
        id: "RG-002", rg: "RG-002", creneaux: ["matin"],
        days: ["Lundi", "Mardi", "Mercredi", "Vendredi"],
        seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2, requireSpecialite: false,
      },
      {
        id: "RG-007", rg: "RG-007", creneaux: ["matin"], days: ["Jeudi"],
        seniorMin: 2, seniorMax: 2, interneMin: null, interneMax: null, requireSpecialite: false,
      },
      {
        id: "RG-003", rg: "RG-003", creneaux: ["apres-midi"], days: DAYS,
        seniorMin: 2, seniorMax: 2, interneMin: 1, interneMax: 2, encourageInterneGrowth: true, requireSpecialite: false,
      },
      {
        id: "RG-012", rg: "RG-012", creneaux: ["astreinte"], days: DAYS,
        seniorMin: 0, seniorMax: 0, interneMin: 1, interneMax: null, requireSpecialite: false,
        mentionSeniorInText: false, allowSubstitution: false,
        seniorExcessMessage: "l'astreinte n'accueille que des internes",
        socleReinforcementIfSingleInterne: true,
        // RG-027 (10/08/2026) : "off" par défaut -- ne change rien tant que Samir ne l'active pas
        // explicitement depuis l'écran "Règles" (même prudence que requireSpecialite: false partout).
        astreinteExclusivityMode: "off",
      },
    ],
  },
  {
    id: "rule-scan-a", activityId: "scan-a", labelPrefix: "Scan A",
    segments: [
      {
        id: "RG-009", rg: "RG-009", creneaux: ["matin", "apres-midi"], days: DAYS,
        seniorMin: 1, seniorMax: 1, interneMin: 1, interneMax: 2, encourageInterneGrowth: true, requireSpecialite: false,
      },
    ],
  },
];

// Clone DEFAULT_COMPOSITION_RULES (ou tout tableau de règles au format conteneur+segments) sans
// jamais partager de référence d'objet avec la constante -- un simple `{...r}` par règle ne suffit
// plus depuis la restructuration en segments (18/08/2026) : `r.segments` resterait le MÊME tableau
// (et les MÊMES objets segment) que la constante, donc modifier un segment depuis l'écran (qui fait
// `Object.assign(existingSegment, payload)`, une mutation EN PLACE) mystifierait silencieusement
// DEFAULT_COMPOSITION_RULES pour le reste de la session. Clone donc aussi chaque segment (`days`/
// `creneaux` restent des références partagées avec la constante, mais jamais mutées en place --
// toujours remplacées en entier par le formulaire, comme avant cette restructuration).
function cloneCompositionRules(rules) {
  return rules.map((r) => ({ ...r, segments: r.segments.map((s) => ({ ...s })) }));
}

// Règle de garde (10/08/2026, "Rajoute moi un bloc 'règle de garde' qui permet de choisir la
// composition des personnes de garde") -- remplace la composition RG-015 codée en dur
// (`{ seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2 }` dans validateGardes(), js/07-
// validation-rg.js) par un unique objet éditable, `state.gardeRule`. Contrairement à `state.rules`
// (§ ci-dessus), ce n'est PAS un tableau -- la garde n'a ni modalité, ni créneau, ni jour variable
// (même composition tous les jours), une seule règle a donc un sens, pas une liste. Reproduit
// EXACTEMENT la valeur codée en dur avant ce changement.
const DEFAULT_GARDE_RULE = {
  seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2,
  encourageInterneGrowth: false, allowSubstitution: true,
};

// Ajoute 1 jour à la date ISO en tête d'une clé "YYYY-MM-DD" ou "YYYY-MM-DD|reste-de-la-clé" --
// utilisée uniquement par STATE_MIGRATIONS[11] (piège de fuseau horaire de weekKey(), voir cette
// entrée pour le contexte complet). `isoAddDays()` (js/06-conges-model.js, chargé après ce fichier)
// n'est référencée qu'à l'intérieur de ce corps de fonction, jamais exécutée immédiatement -- safe
// vis-à-vis de l'ordre de chargement des <script> (voir CLAUDE.md §2 point 4).
function shiftWeekKeyPrefixForward(key) {
  const parts = key.split("|");
  parts[0] = isoAddDays(parts[0], 1);
  return parts.join("|");
}

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
  // 5 -> 6 : ajout de `weekLocks` (verrouillage manuel des semaines, 29/07/2026) -- un objet vide
  // suffit, le comportement automatique (verrouillée si strictement passée) s'applique déjà sans
  // aucune entrée explicite.
  5: (data) => ({ ...data, weekLocks: data.weekLocks || {} }),
  // 6 -> 7 : ajout de `weekNotes` (annotations libres par semaine, 08/08/2026) -- un objet vide
  // suffit, aucune semaine n'a d'annotation par défaut.
  6: (data) => ({ ...data, weekNotes: data.weekNotes || {} }),
  // 7 -> 8 : ajout de `vacationSpecialitesWeekly` (RG-024, exception de spécialité par semaine,
  // 08/08/2026) -- un objet vide suffit, aucune vacation n'a d'exception par défaut (retombe sur
  // vacationSpecialites, comme avant).
  7: (data) => ({ ...data, vacationSpecialitesWeekly: data.vacationSpecialitesWeekly || {} }),
  // 8 -> 9 : ajout de statsColumnVisibility/statsCounterMode (colonnes Stats facultatives + badges
  // Congés/Repos de garde, 08/08/2026) -- statsColumnVisibility vide = tout visible (comportement
  // d'origine, voir sa lecture via `!== false`) ; statsCounterMode a besoin d'un défaut EXPLICITE
  // (pas juste {}) pour que Congés retombe bien sur "colonne" et Repos de garde sur "badge" -- un
  // objet vide ferait l'inverse pour Congés (voir renderStatsView(), le filtre lit `!== "column"`).
  8: (data) => ({
    ...data,
    statsColumnVisibility: data.statsColumnVisibility || {},
    statsCounterMode: data.statsCounterMode || { conges: "column", reposGarde: "badge" },
  }),
  // 9 -> 10 : choix Colonne/Badge étendu à Astreinte/Bureau/Off (09/08/2026, demande de Samir :
  // "donner ce choix pour tout") -- un fichier plus ancien a déjà conges/reposGarde dans
  // statsCounterMode (via la migration 8->9) mais jamais ces 3 nouvelles clés ; défaut "column" pour
  // les 3 (comportement visuel inchangé pour tout fichier existant -- elles restaient déjà toujours
  // des colonnes jusqu'ici). Merge (pas d'écrasement) pour ne jamais perdre un choix conges/reposGarde
  // déjà fait par Samir.
  9: (data) => ({
    ...data,
    statsCounterMode: { astreinte: "column", bureau: "column", off: "column", ...data.statsCounterMode },
  }),
  // 10 -> 11 : ajout de `rules` (moteur de règles paramétrable, 09/08/2026) -- un fichier plus ancien
  // n'a jamais eu ce champ, on l'amorce avec DEFAULT_COMPOSITION_RULES (clone superficiel, jamais la
  // même référence que la constante) pour reproduire EXACTEMENT RG-002/003/007/009/012 telles
  // qu'elles étaient codées en dur -- pas un tableau vide, qui ferait disparaître ces 5 règles au
  // premier chargement après mise à jour.
  10: (data) => ({
    ...data,
    rules: Array.isArray(data.rules) ? data.rules : cloneCompositionRules(DEFAULT_COMPOSITION_RULES),
  }),
  // 11 -> 12 : correction du piège de fuseau horaire de weekKey() (09/08/2026, voir sa déclaration
  // dans js/05-week.js) -- utilisait `.toISOString()` (conversion UTC), ce qui décale TOUJOURS
  // exactement -1 jour calendaire pour un fuseau en avance sur UTC (France : CET/CEST, jamais en
  // retard sur UTC -- soustraire n'importe quelle heure positive à minuit local retombe forcément sur
  // la veille en UTC, donc le décalage ne dépend ni de l'heure d'été/hiver ni de la date). Toute clé
  // écrite AVANT ce correctif (assignments/fermetures/vacationSpecialitesWeekly, préfixées par une
  // semaine ; weekLocks/weekNotes, dont la clé EST la semaine) porte donc ce décalage d'un jour trop
  // tôt -- cette migration les réaligne une seule fois en ajoutant +1 jour à chaque préfixe de
  // semaine, pour rester cohérent avec la weekKey() corrigée. Trouvé et vérifié sur un vrai export de
  // Samir (semaine du 5 octobre stockée sous "2026-10-04" -> "2026-10-05" après migration, qui est le
  // vrai lundi). `shiftWeekKeyPrefixForward()` gère aussi bien une clé composée
  // ("weekKey|activityId|jour|créneau") qu'une clé simple (weekKey seule, weekLocks/weekNotes).
  11: (data) => {
    const shiftKeys = (obj) => {
      const result = {};
      Object.entries(obj || {}).forEach(([key, value]) => {
        result[shiftWeekKeyPrefixForward(key)] = value;
      });
      return result;
    };
    return {
      ...data,
      assignments: shiftKeys(data.assignments),
      fermetures: shiftKeys(data.fermetures),
      vacationSpecialitesWeekly: shiftKeys(data.vacationSpecialitesWeekly),
      weekLocks: shiftKeys(data.weekLocks),
      weekNotes: shiftKeys(data.weekNotes),
    };
  },
  // 12 -> 13 : ajout de `rulesGroupOrder` (09/08/2026, réordonner par glisser-déposer les BLOCS par
  // modalité de l'écran Règles -- ex. faire passer le bloc "Scan A" avant le bloc "Scan U" -- distinct
  // du réordonnancement des règles À L'INTÉRIEUR d'un même bloc, déjà possible avant cette migration).
  // Un fichier plus ancien n'a jamais eu ce champ -- normalizeRulesGroupOrder(undefined) retombe sur
  // l'ordre naturel de `state.activities` (celui déjà affiché avant l'introduction de ce réglage),
  // donc aucun changement visuel pour un fichier existant tant que personne ne glisse un bloc.
  12: (data) => ({ ...data, rulesGroupOrder: normalizeRulesGroupOrder(data.rulesGroupOrder) }),
  // 13 -> 14 : ajout de `globalRules` (10/08/2026, règles globales transverses à toutes les
  // modalités -- 1er type : "Ignorer la Spé", voir js/21-vue-regles.js et hasSpecialiteMismatch()
  // dans js/07-validation-rg.js). Un fichier plus ancien n'a jamais eu ce champ -- tableau vide =
  // aucune règle globale active, comportement inchangé (RG-001 continue de s'appliquer normalement
  // à tout le monde).
  13: (data) => ({ ...data, globalRules: Array.isArray(data.globalRules) ? data.globalRules : [] }),
  // 14 -> 15 : ajout de `gardeRule` (10/08/2026, composition de la garde -- RG-015 -- devient
  // éditable depuis l'écran "Règles" au lieu d'être codée en dur). Un fichier plus ancien n'a jamais
  // eu ce champ -- `normalizeGardeRule(undefined)` retombe sur `DEFAULT_GARDE_RULE`, qui reproduit
  // exactement l'ancienne valeur codée en dur (1 sénior + 2 internes minimum) : aucun changement de
  // comportement pour un fichier existant tant que Samir n'a rien reconfiguré.
  14: (data) => ({ ...data, gardeRule: normalizeGardeRule(data.gardeRule) }),
  // 15 -> 16 : ajout de `fixedRuleToggles` (10/08/2026, RG-029..033 -- règles fixes codées en dur,
  // "je veux juste pouvoir les cocher/décocher", voir js/07-validation-rg.js). Un fichier plus ancien
  // n'a jamais eu ce champ -- objet vide = toutes décochées par défaut (aucune de ces 5 règles
  // n'existait avant, donc rien n'était vérifié -- comportement inchangé tant que Samir n'en coche
  // aucune).
  15: (data) => ({ ...data, fixedRuleToggles: data.fixedRuleToggles || {} }),
  // 16 -> 17 : ajout de `weekDayFlags` (11/08/2026, "jours à signaler" dans la vue Congés -- demande
  // de Samir : "un jour d'indicateur comme dans Jira... des journées où y'a très peu de monde"). Un
  // fichier plus ancien n'a jamais eu ce champ -- objet vide = aucun jour signalé, comportement
  // inchangé (purement visuel, ne pilote aucune règle).
  16: (data) => ({ ...data, weekDayFlags: data.weekDayFlags || {} }),
  // 17 -> 18 : restructuration de `rules` en conteneur+segments (18/08/2026, RG-036, "je veux pouvoir
  // dans la même fenêtre de modification choisir jour par jour si la règle s'applique le matin ou
  // l'après-midi ou les deux") -- voir le commentaire au-dessus de DEFAULT_COMPOSITION_RULES pour le
  // détail de la nouvelle forme. Regroupe les anciennes règles À PLAT par `activityId` (ordre de
  // première apparition préservé) ; chaque ancienne règle devient un SEGMENT de la règle de sa
  // modalité (activityId/labelPrefix remontent au conteneur, partagés par tous ses segments -- ils
  // étaient déjà identiques entre toutes les anciennes règles d'une même modalité). Comportement
  // strictement inchangé pour un fichier existant : resolveCompositionRule() résout la même
  // combinaison jour/créneau vers le même segment qu'avant vers la même règle (voir cette fonction).
  17: (data) => ({ ...data, rules: mergeFlatRulesIntoContainers(Array.isArray(data.rules) ? data.rules : []) }),
};

// Regroupe un tableau de règles À PLAT (forme d'avant le 18/08/2026 -- une entrée = une modalité +
// UN SEUL jeu de jours/créneaux/composition) en conteneurs "une règle par modalité, plusieurs
// segments dedans" -- utilisé uniquement par STATE_MIGRATIONS[17] ci-dessus (fichier écrit avant la
// restructuration). Générateur d'id auto-suffisant (pas d'appel à generateRuleId(), défini dans
// js/21-vue-regles.js qui charge après ce fichier -- safe de toute façon puisque cette fonction n'est
// jamais exécutée au chargement, voir CLAUDE.md §2 point 4, mais autant rester indépendant).
function mergeFlatRulesIntoContainers(flatRules) {
  const byActivity = new Map();
  flatRules.forEach((r) => {
    if (!byActivity.has(r.activityId)) byActivity.set(r.activityId, { labelPrefix: r.labelPrefix, segments: [] });
    const { activityId, labelPrefix, ...segmentFields } = r;
    byActivity.get(r.activityId).segments.push(segmentFields);
  });
  return [...byActivity.entries()].map(([activityId, group], i) => ({
    id: "rule" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6),
    activityId,
    labelPrefix: group.labelPrefix,
    segments: group.segments,
  }));
}

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
const PERSISTED_KEYS = ["staff", "assignments", "vacationSpecialites", "vacationSpecialitesWeekly", "fermetures", "conges", "gardes", "trame", "tempsPartiel", "weekOffset", "statsColumnOrder", "statsColumnVisibility", "statsCounterMode", "customColors", "weekLocks", "weekNotes", "rules", "rulesGroupOrder", "globalRules", "gardeRule", "fixedRuleToggles", "weekDayFlags"];

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
const DEFAULT_STATS_COLUMN_ORDER = ["total", "vacations", "astreinte", "bureau", "off", "conges", "reposGarde"];

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

// Ordre des blocs "par modalité" de l'écran Règles (09/08/2026, demande de Samir : réordonner
// pas seulement les règles d'un même bloc mais les blocs eux-mêmes, ex. "Scan A" avant "Scan U").
// Même principe que normalizeStatsColumnOrder() ci-dessus, mais la liste "canonique" est
// `state.activities` (pas une constante à part comme DEFAULT_STATS_COLUMN_ORDER) : jamais de
// modalité perdue si une activité est retirée du code, jamais d'erreur si `rulesGroupOrder`
// contient un id qui n'existe plus.
function normalizeRulesGroupOrder(order) {
  // RG-038 (18/08/2026) : ALL_REAL_VACATIONS_ID rejoint la liste canonique -- le bloc "Toutes les
  // vraies vacations" se réordonne/plie exactement comme un bloc de modalité normale dans l'écran
  // Règles, sans nouvelle migration de schéma nécessaire (auto-guéri à chaque applyPersistedState(),
  // même mécanisme qu'une modalité ajoutée au code après un vieil export).
  const allIds = [...state.activities.map((a) => a.id), ALL_REAL_VACATIONS_ID];
  const valid = Array.isArray(order) ? order.filter((id) => allIds.includes(id)) : [];
  allIds.forEach((id) => {
    if (!valid.includes(id)) valid.push(id);
  });
  return valid;
}

// Complète un `state.gardeRule` persisté avec les champs de DEFAULT_GARDE_RULE manquants -- un
// fichier plus ancien (sans ce champ du tout) ou un objet partiellement corrompu ne doit jamais
// faire planter checkComposition() (qui a besoin de tous ces champs), même principe défensif que
// normalizeStatsColumnOrder()/normalizeRulesGroupOrder() ci-dessus.
function normalizeGardeRule(rule) {
  return { ...DEFAULT_GARDE_RULE, ...(rule || {}) };
}

// ⚠️ Bug réel trouvé le 08/08/2026 en ajoutant vacationSpecialitesWeekly : cette fonction listait
// CHAQUE champ de PERSISTED_KEYS à la main plutôt que de boucler dessus -- weekLocks (29/07/2026) et
// weekNotes (08/08/2026, session précédente) avaient bien été ajoutés à PERSISTED_KEYS/buildPersistedState()
// (donc correctement ÉCRITS dans le fichier/localStorage/export) mais jamais recopiés ICI, donc
// jamais RELUS au chargement -- un verrou ou une annotation posés ne survivaient probablement pas à
// un rechargement de page ou une resynchro GitHub, silencieusement. Remplacé par une boucle générique
// sur PERSISTED_KEYS pour qu'un futur champ ajouté ne puisse plus être oublié de cette façon --
// SPECIAL_APPLY_KEYS liste les 3 exceptions qui ont besoin d'un traitement différent d'un simple
// `data[key] || {}` (staff : conditionnel non-vide, weekOffset : nombre, statsColumnOrder : normalisé).
const ARRAY_PERSISTED_KEYS = new Set(["conges", "gardes", "rules", "globalRules"]);
const SPECIAL_APPLY_KEYS = new Set(["staff", "weekOffset", "statsColumnOrder", "rulesGroupOrder", "gardeRule"]);
function applyPersistedState(rawData) {
  const data = migrateState(rawData);
  state.weekOffset = data.weekOffset || 0;
  state.statsColumnOrder = normalizeStatsColumnOrder(data.statsColumnOrder);
  state.rulesGroupOrder = normalizeRulesGroupOrder(data.rulesGroupOrder);
  state.gardeRule = normalizeGardeRule(data.gardeRule);
  if (Array.isArray(data.staff) && data.staff.length > 0) {
    state.staff = data.staff;
  }
  PERSISTED_KEYS.forEach((key) => {
    if (SPECIAL_APPLY_KEYS.has(key)) return;
    state[key] = ARRAY_PERSISTED_KEYS.has(key) ? (Array.isArray(data[key]) ? data[key] : []) : (data[key] || {});
  });
  applyCustomColors();
}

let state = {
  staff: DEMO_STAFF,
  activities: ACTIVITIES,
  assignments: {}, // key: `${weekKey}|${activityId}|${day}|${creneauId}` -> [staffId, ...]
  // Spécialité "propriétaire" d'une vacation (ex. Scan B le mardi matin = Gynéco), indépendante de
  // la semaine (structurel, change rarement) -> clé SANS le weekKey, voir vacationSpecKey().
  vacationSpecialites: {}, // key: `${activityId}|${day}|${creneauId}` -> "digestif"|"uro"|"gyneco"|"thorax"|"os"
  // RG-024 (08/08/2026) : exception à vacationSpecialites PROPRE À UNE SEMAINE -- pour une vacation
  // qui change de spécialité chaque semaine (ex. Scan B mardi : Thorax une semaine, Gynéco la
  // suivante), sans quoi changer la valeur structurelle réécrirait aussi les stats des semaines
  // passées. Clé AVEC weekKey cette fois -- voir effectiveVacationSpecialiteForWeek().
  vacationSpecialitesWeekly: {}, // key: `${weekKey}|${activityId}|${day}|${creneauId}` -> "digestif"|"uro"|"gyneco"|"thorax"|"os"
  // Fermeture d'une vacation : à l'inverse de vacationSpecialites, c'est HEBDOMADAIRE (clé AVEC
  // weekKey, via cellKey() comme assignments) -- une vacation fermée cette semaine peut rouvrir la
  // semaine suivante sans rien reconfigurer. Bloque l'assignation (voir RG-010 dans regles-gestion.md).
  fermetures: {}, // key: cellKey(activityId, day, creneauId) -> true
  // Congés déclarés : données personnelles structurelles (comme staff/vacationSpecialites),
  // indépendantes de la semaine affichée -- voir 4.7 dans CLAUDE.md et quarterWeeks() plus bas.
  // demiJournee (05/08/2026, congé demi-journée) : optionnel, "matin"|"apres-midi" -- absent/undefined
  // = journée entière (comportement historique). Uniquement sur un enregistrement d'UN SEUL jour
  // (dateDebut === dateFin), jamais sur une plage -- voir setCongeHalfDay().
  conges: [], // { id, staffId, dateDebut: "YYYY-MM-DD", dateFin: "YYYY-MM-DD", demiJournee?: "matin"|"apres-midi" }
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
  // Moteur de règles paramétrable (09/08/2026) : composition attendue par vacation, éditable depuis
  // l'écran "Règles" -- voir DEFAULT_COMPOSITION_RULES juste au-dessus pour la forme d'une règle et
  // js/07-validation-rg.js pour l'interpréteur générique (validateCompositionRules()).
  rules: cloneCompositionRules(DEFAULT_COMPOSITION_RULES),
  // Ordre des BLOCS par modalité de l'écran Règles (09/08/2026, réordonnables par glisser-déposer
  // des en-têtes de bloc, ex. "Scan A" avant "Scan U") -- distinct de l'ordre des règles À
  // L'INTÉRIEUR d'un bloc (déjà géré par l'ordre naturel de `state.rules`). Valeur par défaut =
  // ordre naturel de `state.activities` -- voir normalizeRulesGroupOrder().
  rulesGroupOrder: [...ACTIVITIES.map((a) => a.id), ALL_REAL_VACATIONS_ID],
  // Règles globales (10/08/2026) : transverses à toutes les modalités, distinctes de state.rules
  // (composition PAR modalité) -- 1er type : "ignoreSpecialite" (voir GLOBAL_RULE_STATUS_OPTIONS et
  // specialiteOverrideForPerson() dans js/07-validation-rg.js, écran dans js/21-vue-regles.js).
  // { id, type: "ignoreSpecialite", staffIds: [...], statuses: [...], activityIds: [...], mode: "ignore"|"downgrade" }
  globalRules: [],
  // Règle de garde (10/08/2026) : composition attendue de garde (RG-015), un unique objet éditable
  // -- pas un tableau comme state.rules, la garde n'a ni modalité ni créneau ni jour variable. Voir
  // DEFAULT_GARDE_RULE plus haut et js/21-vue-regles.js (renderGardeRuleSection()).
  gardeRule: { ...DEFAULT_GARDE_RULE },
  // Règles fixes cochables (10/08/2026, RG-029..033) : "je veux juste pouvoir les cocher/décocher"
  // -- pas de ciblage personnes/statuts/modalités comme les règles globales, juste un booléen par
  // RG. Clé absente ou `false` = décochée (comportement par défaut, rien vérifié). Voir
  // FIXED_RULE_FAMILIES (js/07-validation-rg.js) pour la définition de chaque règle.
  fixedRuleToggles: {}, // key: "RG-029".."RG-033" -> true (cochée)
  weekOffset: 0,
  // Ordre des colonnes de la vue Stats (24/07/2026, réordonnables par glisser-déposer des en-têtes,
  // voir renderStatsView()) -- "Personnel" n'en fait pas partie, toujours fixe en 1re position.
  statsColumnOrder: DEFAULT_STATS_COLUMN_ORDER.slice(),
  // Colonnes/badges facultatifs de la vue Stats (08/08/2026, demande de Samir) -- clé absente ou
  // `true` = visible (voir sa lecture via `!== false`, pour qu'un vieux fichier sans ce champ du
  // tout affiche tout comme avant, sans rien à migrer explicitement).
  statsColumnVisibility: {}, // key: colId ("total"|"vacations"|"astreinte"|"bureau"|"off"|"conges"|"reposGarde") -> false pour masquer
  // Mode d'affichage de chaque compteur facultatif -- "column" = colonne dédiée, "badge" = badge dans
  // la colonne Vacations. Par défaut : tout en colonne (comportement d'origine) sauf Repos de garde
  // en badge (demande explicite de Samir, 08/08/2026). Étendu à Astreinte/Bureau/Off le 09/08/2026
  // ("donner ce choix pour tout") -- Congés/Repos de garde restaient les deux seuls réglables jusque-là.
  statsCounterMode: { astreinte: "column", bureau: "column", off: "column", conges: "column", reposGarde: "badge" },
  // Personnalisation (25/07/2026, ⚙ → "Personnalisation") : quelques couleurs éditables sans coder
  // -- voir CUSTOM_COLOR_FIELDS/applyCustomColors(). Clé absente = valeur par défaut du CSS.
  customColors: {}, // key: voir CUSTOM_COLOR_FIELDS -> "#rrggbb"
  // Verrouillage manuel des semaines (29/07/2026, "des modifications ont été reversées sur des
  // semaines qu'on avait faites, sans savoir comment") -- voir isWeekLocked()/toggleCurrentWeekLock().
  // Clé absente = comportement automatique (verrouillée si strictement passée) ; true/false = override
  // manuel qui gagne toujours sur l'automatique.
  weekLocks: {}, // key: weekKey (Lundi ISO) -> true (verrouillée) | false (déverrouillée explicitement)
  // Annotations libres par semaine (08/08/2026, clic sur "Semaine du..." dans la topbar) -- structurel
  // comme weekLocks (clé = weekKey), jamais réinitialisé par "Réinitialiser le planning". Clé absente
  // ou vide = pas d'annotation pour cette semaine.
  weekNotes: {}, // key: weekKey (Lundi ISO) -> texte libre
  // "Jours à signaler" (11/08/2026, vue Congés, demande de Samir : "un jour d'indicateur comme dans
  // Jira... des journées où y'a très peu de monde") -- purement visuel, ne pilote aucune règle/
  // validation, juste un repère manuel. Clé absente ou tableau vide = rien signalé cette semaine-là ;
  // une entrée jamais laissée à `[]` (voir toggleWeekDayFlag(), js/10-vue-conges.js -- la clé est
  // retirée entièrement dès que le dernier jour coché est décoché, même convention que weekNotes).
  weekDayFlags: {}, // key: weekKey (Lundi ISO) -> tableau de DAYS (ex. ["Jeudi", "Vendredi"])
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

