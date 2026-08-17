// ---------- Génération automatique de planning (11/08/2026, brouillon) ----------
// 1re itération d'un générateur "glouton + réparation locale" (voir la discussion avec Samir) :
// comble les trous d'une plage de semaines en respectant state.rules/globalRules/gardeRule --
// PAS un vrai solveur de contraintes (backtracking complet), volontairement, pour rester simple à
// débugger et à faire évoluer par petites touches ("on y va à tâtons"). Bouton ⚙ → "Générer planning
// (auto)" (#btnGenerate).
//
// Périmètre VOLONTAIREMENT limité pour cette 1re version, à discuter/étendre avec Samir :
// - Ne touche QUE les activités qui ont au moins une règle de composition dans state.rules (Scan U,
//   Scan A/B, IRM 1.5T/3T, Mammo, Echo U, ECN-1/2 aujourd'hui) -- Bureau/Off/Hors-sisu/gardes restent
//   entièrement manuels, aucune RG de composition ne les couvre.
// - Ne réassigne JAMAIS une case déjà matérialisée AVANT la génération (une case où Samir a déjà posé
//   quelqu'un à la main n'est jamais vidée/remplacée) -- seuls les trous (case encore purement issue
//   de la trame, ou déjà matérialisée mais sous le minimum) sont comblés. Repartir d'un planning vide
//   (voir la conversation avec Samir, fichier de test anonymisé) est le cas d'usage prévu.
//   ⚠️ PROVISOIREMENT DÉSACTIVÉ le 11/08/2026 (voir GENERATION_RESET_TO_TRAME_FIRST juste plus bas) :
//   tant que les règles changent souvent, chaque génération repart entièrement de la trame plutôt que
//   de ne combler que les trous -- sinon une case déjà remplie par un ancien run/une ancienne règle
//   masquerait l'effet réel d'un changement de règle en cours de test. À remettre à `false` une fois
//   les règles stabilisées (mots de Samir : "tant que c'est pas stable on va faire ça").
// - Une semaine verrouillée (RG-022) n'est jamais touchée, comme partout ailleurs dans l'appli.
// - Équité (demande de Samir, 11/08/2026) : NORMALISÉE par la disponibilité réelle sur toute la plage
//   générée ("un mi-temps doit avoir moitié moins de tout qu'un temps plein") -- ratio
//   charge/disponibilité (matin+après-midi uniquement, l'astreinte est exclue du calcul d'équité,
//   comme dans la vue Stats existante -- voir §6.16 CLAUDE.md), pas un simple compte brut. Le
//   générateur choisit toujours, à besoin égal, la personne dont ce ratio est le plus bas.
// - Hiérarchie de préférence par candidat (le "scoring" demandé) : (0) vraie spécialité, compétence
//   "cheat code" (RG-001), ou passe-droit -- ignore/downgrade (RG-026) -- toutes équivalentes et
//   préférées en priorité ; (1) passe-droit downgrade -- déjà couvert au rang 0 en réalité, voir
//   generationSpecialiteTier() ; quelqu'un qui ne correspond pas du tout et n'a AUCUN passe-droit
//   n'est JAMAIS choisi (mieux vaut un trou visible qu'une composition qui a l'air bonne mais ne
//   respecte pas la spécialité).
// - Trame = base qu'on ne modifie qu'en dernier recours (demande de Samir) : le générateur essaie
//   D'ABORD de trouver quelqu'un de dispo et non encore posté ce jour+créneau ; s'il n'y a personne,
//   il tente de "voler" une personne déjà posée (via la trame) sur une AUTRE activité du même
//   jour+créneau -- mais SEULEMENT si la case source garde son propre minimum une fois cette personne
//   retirée (jamais un simple déplacement de trou). Chaque vol est un "déplacement minimal" au sens où
//   un seul candidat est déplacé par trou, jamais toute une case réorganisée. Marqué visuellement par
//   un cercle orange (voir trameDeviationMissingIds() dans js/05-week.js, purement dérivé -- aucun
//   nouvel état persisté nécessaire pour ça).
// - Si aucun candidat ET aucun vol possible : la case reste incomplète, volontairement -- pas de
//   "proposition de fermeture" automatique construite ici (Samir l'a suggéré comme option) : le moteur
//   de validation existant (runValidation(), voir js/07-validation-rg.js) signale déjà cette case en
//   violation, et le mécanisme de fermeture en masse existe déjà depuis Trame Vacation (§6.26
//   CLAUDE.md) si Samir décide de fermer après coup -- pas besoin de dupliquer cette action dans une
//   nouvelle UI pour cette 1re itération. Le résumé affiché après génération liste ces cases pour que
//   Samir sache où regarder sans avoir à tout relire.
// - La garde (RG-015) N'EST PAS générée ici -- state.gardes reste une donnée déclarée à la main,
//   hors du périmètre "vacations" demandé par Samir pour ce générateur.
// - RG-034 (11/08/2026) : pour un interne double-spécialisé UNIQUEMENT, tente en plus d'approcher un
//   tiers urgence (Scan U/Echo U 50/50) / tiers spé1 / tiers spé2 (chaque tiers spé réparti entre les
//   familles Scan/IRM/ECN/Mammo où cette spécialité est réellement présente) -- voir le bloc dédié
//   plus bas (generationBalanceAdjustment() et alentours) et regles-gestion.md RG-034 pour le détail.
//
// Technique : parcourt chaque semaine cible en modifiant TEMPORAIREMENT state.weekOffset (jamais
// rendu à l'écran -- aucun render() n'est appelé avant la toute fin), ce qui permet de réutiliser TEL
// QUEL tout le code existant qui raisonne "semaine affichée" (cellKey(), effectiveAssignedIds(),
// ensureMaterializedAssignments(), isPersonAbsentOnSlot(), hasActivityExclusivityConflict(),
// resolveCompositionRule(), effectiveVacationSpecialite(), isWeekLocked()...) plutôt que de dupliquer
// des variantes "ForWeek" pour chacune (comme l'a déjà fait la vue Stats en mode Période, mais ici
// tout le monde en a besoin, pas seulement 2-3 fonctions) -- state.weekOffset est restauré à sa valeur
// d'origine avant le seul et unique render() final.

// L'astreinte n'entre jamais dans le calcul d'équité (ni charge ni disponibilité), même convention
// que la vue Stats (§6.16 CLAUDE.md, "l'astreinte n'entre jamais dans ce calcul") -- elle est quand
// même comblée normalement si une règle la couvre (RG-012), juste pas comptée pour départager qui a
// "le moins" travaillé.
const GENERATION_CRENEAUX_EQUITE = ["matin", "apres-midi"];

// Les seules activités que ce générateur touche : celles qui ont au moins une règle de composition.
function generationActivityIds() {
  return [...new Set(state.rules.map((r) => r.activityId))];
}

// ⚠️ PROVISOIRE (11/08/2026, demande de Samir : "pour l'instant et pour les tests... tant que c'est
// pas stable on va faire ça") : `true` fait repartir CHAQUE génération entièrement de la trame plutôt
// que de ne combler que les trous -- contredit volontairement le principe normal "ne touche jamais une
// case déjà matérialisée" (voir le commentaire d'en-tête du fichier), le temps que les règles de
// composition finissent de bouger. Repasser à `false` une fois stabilisé pour retrouver le
// comportement définitif (respecte les affectations déjà posées, générateur ou main). Le texte de
// confirmation du bouton (tout en bas du fichier) s'adapte automatiquement à ce flag.
const GENERATION_RESET_TO_TRAME_FIRST = true;

// Vide state.assignments pour toutes les cases gérées par ce générateur (voir generationActivityIds())
// sur la plage ciblée -- chaque case retombe sur sa trame (RG-017/RG-023), comme si elle n'avait
// jamais été touchée, avant que runGeneration() ne recommence un remplissage complet. Ne touche à rien
// en dehors du périmètre du générateur (Bureau/Off/Hors-sisu/fermetures intacts) ; une semaine
// verrouillée n'est jamais vidée, comme partout ailleurs.
function clearGenerationManagedRange(weekOffsets) {
  const activityIds = generationActivityIds();
  weekOffsets.forEach((offset) => {
    const wk = weekKey(getMonday(offset));
    if (isWeekLocked(wk)) return;
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        activityIds.forEach((activityId) => {
          if (!isCreneauApplicable(activityId, creneau.id)) return;
          delete state.assignments[`${wk}|${activityId}|${day}|${creneau.id}`];
        });
      });
    });
  });
}

// Convertit une weekKey (lundi, "YYYY-MM-DD") en offset relatif à la semaine réelle actuelle --
// l'inverse de weekKey(getMonday(offset)), nécessaire pour piloter la simulation de state.weekOffset
// décrite plus haut à partir d'une date de départ choisie par Samir.
function weekOffsetForWeekKey(wk) {
  const diffMs = mondayFromWeekKey(wk) - getMonday(0);
  return Math.round(diffMs / (7 * 24 * 3600 * 1000));
}

// Une personne est-elle éligible EN PRINCIPE (indépendamment de la case précise visée) sur ce
// jour+créneau ? Hors Sisu jamais posé par le générateur (RG-016 : ce sont des personnes suivies,
// jamais des vacations réelles) ; absence/Temps Partiel toujours des exclusions dures ici (contrairement
// au reste de l'appli qui ne fait que signaler -- un générateur qui choisit sciemment quelqu'un
// d'absent n'aurait aucun sens).
function isGenerationCandidateEligible(person, day, creneauId) {
  return !person.horsSisu && !isPersonAbsentOnSlot(person.id, day, creneauId) && !isPersonTPOnSlot(person.id, day, creneauId);
}

// RG-027 (astreinte/Scan U/Echo U le même jour) EN MODE "Obligatoire" uniquement : traité comme une
// exclusion dure au même titre que RG-028 juste en dessous -- trouvé en testant (11/08/2026, fichier
// anonymisé) : sans ce garde-fou, le générateur créait de vraies violations RG-027 "Obligatoire" en
// ignorant superbement le réglage de sévérité que Samir avait lui-même choisi. Les créneaux sont
// remplis dans l'ordre matin -> astreinte -> après-midi (voir CRENEAUX), donc au moment de choisir
// l'astreinte, le matin est déjà fixé pour la journée ; au moment de choisir l'après-midi, l'astreinte
// l'est aussi -- les deux sens sont donc couverts sans avoir besoin de refaire un passage après coup.
// Mode "Facultative" (recommandation) volontairement PAS traité comme une exclusion dure ici (portée
// limitée pour cette 1re itération, voir le commentaire d'en-tête du fichier) -- seul "Obligatoire"
// (jamais toléré ailleurs dans l'appli non plus) bloque un candidat.
function violatesAstreinteExclusivityHard(personId, activityId, day, creneauId) {
  const rule = resolveCompositionRule("scan-u", day, "astreinte");
  if (!rule || rule.astreinteExclusivityMode !== "violation") return false;
  if (activityId === "scan-u" && creneauId === "astreinte") {
    return ["scan-u", "echo-u"].some((aid) =>
      ["matin", "apres-midi"].some((cid) => effectiveAssignedIds(cellKey(aid, day, cid)).includes(personId))
    );
  }
  if ((activityId === "scan-u" || activityId === "echo-u") && creneauId !== "astreinte") {
    return effectiveAssignedIds(cellKey("scan-u", day, "astreinte")).includes(personId);
  }
  return false;
}

// Exclusions "dures" propres à ce générateur (en plus de isGenerationCandidateEligible()) : une règle
// globale "Interdire de poster" réglée en "Obligatoire" (RG-028) est une contradiction que Samir a
// explicitement choisi de traiter comme une vraie violation -- le générateur ne doit jamais en créer
// une sciemment, même si le reste de l'appli ne fait que la signaler après coup (jamais bloquant côté
// UI manuelle, voir §6.54 CLAUDE.md -- mais un GÉNÉRATEUR qui choisit activement où poser quelqu'un
// n'a pas cette excuse). Une règle "Facultative" reste tolérée (portée limitée, voir le commentaire
// d'en-tête du fichier).
function isGenerationCandidateHardBlocked(person, activityId, day, creneauId) {
  return isPostingExcludedAsViolation(person, activityId, day, creneauId) || violatesAstreinteExclusivityHard(person.id, activityId, day, creneauId);
}

// Ce candidat respecte-t-il la spécialité/compétence attendue par cette case ? RG-001 "cheat code"
// (compétence) et les passe-droits (RG-026, ignore/downgrade) sont tous acceptés au même titre que la
// vraie spécialité -- Samir n'a jamais dit vouloir privilégier une vraie spécialité à un passe-droit
// qu'il a lui-même posé exprès ("j'autorise Victoria à faire de l'Uro"). `vacSpec` falsy (aucune
// spécialité propriétaire attendue POUR CE CANDIDAT -- voir fillGenerationCell(), qui décide selon le
// grade) : toujours vrai.
// ⚠️ CORRECTION 11/08/2026 (retour de Samir : "pour les séniors, il faut absolument respecter la
// spé/compétence") : jusque-là cette fonction renvoyait un simple RANG (0 = bon, 1 = mismatch) que
// pickGenerationCandidate() ne faisait que DÉPRIORISER -- un sénior sans la bonne spécialité restait
// choisissable s'il était le seul disponible, malgré le commentaire d'origine qui prétendait le
// contraire (bug réel, pas juste une préférence à durcir). Renvoie maintenant un booléen dur : jamais
// de compromis, pour aucun grade -- un trou visible vaut mieux qu'une composition qui a l'air bonne
// sans respecter la spécialité.
function generationCandidateMatchesSpecialite(person, activityId, day, creneauId, vacSpec) {
  if (!vacSpec) return true;
  if (personSatisfiesSpecialite(person, vacSpec, activityId)) return true;
  const override = specialiteOverrideForPerson(person, activityId, day, creneauId);
  return override === "ignore" || override === "downgrade";
}

// ---------- RG-034 : répartition 1/3 urgence / spé1 / spé2 pour les internes double-spécialisés ----------
// Demande de Samir (11/08/2026, capture d'écran de la vue Stats à l'appui) : pour un interne double-
// spécialisé (2 spécialités, jamais les mono-spé/socle -- confirmé explicitement), viser un TIERS de son
// temps de présence en urgence (Scan U + Echo U, réparti 50/50 entre les deux), un tiers dans sa 1re
// spécialité, un tiers dans sa 2e -- chaque tiers "spécialité" réparti à son tour entre les familles de
// modalités (Scan/IRM/ECN/Mammo) où cette spécialité est réellement propriétaire quelque part dans le
// planning (ex. Uro présent seulement en Scan+IRM -> 50/50 ; une spécialité aussi présente en Mammo/ECN
// -> répartie sur davantage de familles). Voir regles-gestion.md RG-034 pour le détail complet.
//
// Best-effort UNIQUEMENT (mots de Samir : "tu essayes au mieux") -- PAS une RG de validation, ne bloque
// rien, n'apparaît dans aucune violation/recommandation. Un simple ajustement de score, additionné au
// ratio charge/disponibilité déjà utilisé pour départager les candidats (voir pickGenerationCandidate()/
// tryStealForGeneration()) -- jamais un remplacement de l'équité générale, qui continue de s'appliquer à
// tout le monde (séniors compris) exactement comme avant.

// Familles de modalités "spécialisables" -- Scan U/Echo U (urgence) volontairement absentes d'ici,
// elles sont gérées à part (bucket "urgence", jamais une "famille" au sens d'une spécialité).
const GENERATION_MODALITY_FAMILIES = {
  scan: ["scan-a", "scan-b"],
  irm: ["irm-15t", "irm-3t"],
  ecn: ["ecn-1", "ecn-2"],
  mammo: ["mammo"],
};
const GENERATION_FAMILY_BY_ACTIVITY = Object.fromEntries(
  Object.entries(GENERATION_MODALITY_FAMILIES).flatMap(([family, ids]) => ids.map((id) => [id, family]))
);

// Quelles familles de modalités une spécialité couvre-t-elle RÉELLEMENT quelque part dans le planning ?
// Calculé UNE FOIS par génération depuis `state.vacationSpecialites` (structurel -- une définition
// stable pour toute la plage générée, pas les exceptions de semaine RG-024). Ex. si aucune case Mammo
// n'est jamais taguée "digestif", "digestif" n'aura jamais "mammo" dans son tableau de familles.
function computeSpecialiteModalityFamilies() {
  const bySpec = {};
  SPECIALITE_ORDER.forEach((spec) => { bySpec[spec] = new Set(); });
  Object.entries(GENERATION_MODALITY_FAMILIES).forEach(([family, activityIds]) => {
    activityIds.forEach((activityId) => {
      DAYS.forEach((day) => {
        CRENEAUX.forEach((creneau) => {
          if (!isCreneauApplicable(activityId, creneau.id)) return;
          const spec = state.vacationSpecialites[vacationSpecKey(activityId, day, creneau.id)];
          if (spec && bySpec[spec]) bySpec[spec].add(family);
        });
      });
    });
  });
  const result = {};
  Object.entries(bySpec).forEach(([spec, set]) => { result[spec] = [...set]; });
  return result;
}

// Structure de suivi vide pour UN interne double-spécialisé -- 3 compartiments (urgence/spe1/spe2),
// chacun un compteur par sous-catégorie (scan-u/echo-u pour urgence, famille de modalité pour une spé).
// `internBalance` (staffId -> cette forme) n'est JAMAIS peuplée pour qui que ce soit d'autre --
// generationBalanceAdjustment()/recordGenerationBucket() court-circuitent avant d'y toucher.
function createInternBalanceEntry() {
  return { urgence: {}, spe1: {}, spe2: {} };
}

function bucketTotal(entryBucket) {
  return Object.values(entryBucket).reduce((sum, n) => sum + n, 0);
}

// À quel compartiment (bucket) + sous-catégorie (sub) cette case appartient-elle POUR CETTE personne ?
// `null` si elle n'entre dans aucun des 3 -- une case dont la spécialité ne correspond à AUCUNE des 2
// spécialités de la personne (ex. Thorax pour un Digestif+Uro) n'affecte jamais son équilibrage, comme
// n'importe quelle activité hors périmètre de cette règle (ECN/Mammo sans spécialité correspondante,
// etc.). Astreinte toujours exclue (hors sujet, comme pour l'équité générale -- voir
// GENERATION_CRENEAUX_EQUITE) même si `activityId` vaut "scan-u".
function generationInternBucketForCell(person, activityId, creneauId, vacSpec, specialiteFamilies) {
  if (creneauId === "astreinte") return null;
  if (activityId === "scan-u" || activityId === "echo-u") {
    return { bucket: "urgence", sub: activityId, subCount: 2 };
  }
  const family = GENERATION_FAMILY_BY_ACTIVITY[activityId];
  if (!family || !vacSpec) return null;
  const specs = orderedSpecialites(person); // toujours 2 ici, vérifié par l'appelant
  const families = specialiteFamilies[vacSpec] || [];
  const subCount = Math.max(1, families.length);
  if (vacSpec === specs[0]) return { bucket: "spe1", sub: family, subCount };
  if (vacSpec === specs[1]) return { bucket: "spe2", sub: family, subCount };
  return null;
}

// Ajustement de score : NÉGATIF = bonus (rend le candidat plus attractif), POSITIF = pénalité. `0` pour
// tout le monde hors périmètre (pas interne, pas double-spécialisé, ou case hors des 3 compartiments) --
// comportement strictement inchangé pour eux. Poids (0.4 pour l'équilibre urgence/spé1/spé2, 0.2 pour
// l'équilibre plus fin à l'intérieur d'un compartiment) choisis pour peser sensiblement sans jamais
// dominer totalement un écart d'équité générale déjà important -- valeurs de départ, à ajuster avec
// Samir selon les résultats réels ("tu essayes au mieux", pas une garantie exacte).
const GENERATION_BUCKET_WEIGHT = 0.4;
const GENERATION_SUB_WEIGHT = 0.2;
function generationBalanceAdjustment(person, activityId, creneauId, vacSpec, internBalance, specialiteFamilies) {
  if (person.grade !== "interne" || orderedSpecialites(person).length !== 2) return 0;
  const info = generationInternBucketForCell(person, activityId, creneauId, vacSpec, specialiteFamilies);
  if (!info) return 0;
  const entry = internBalance[person.id] || createInternBalanceEntry();

  const bucketCount = bucketTotal(entry[info.bucket]);
  const grandTotal = bucketTotal(entry.urgence) + bucketTotal(entry.spe1) + bucketTotal(entry.spe2);
  const bucketShare = grandTotal === 0 ? 0 : bucketCount / grandTotal;
  const bucketDeficit = 1 / 3 - bucketShare; // positif = sous-représenté

  const subCount = entry[info.bucket][info.sub] || 0;
  const subShare = bucketCount === 0 ? 0 : subCount / bucketCount;
  const subDeficit = 1 / info.subCount - subShare;

  return -(bucketDeficit * GENERATION_BUCKET_WEIGHT + subDeficit * GENERATION_SUB_WEIGHT);
}

// Enregistre une affectation dans `internBalance` (ajout, `sign: 1`) ou son retrait (vol, `sign: -1`) --
// même paire de compartiment/sous-catégorie que generationBalanceAdjustment() ci-dessus, pour ne jamais
// désynchroniser le calcul du score et sa mise à jour. No-op pour qui est hors périmètre.
function recordGenerationBucket(person, activityId, creneauId, vacSpec, internBalance, specialiteFamilies, sign) {
  if (person.grade !== "interne" || orderedSpecialites(person).length !== 2) return;
  const info = generationInternBucketForCell(person, activityId, creneauId, vacSpec, specialiteFamilies);
  if (!info) return;
  if (!internBalance[person.id]) internBalance[person.id] = createInternBalanceEntry();
  const entry = internBalance[person.id];
  entry[info.bucket][info.sub] = (entry[info.bucket][info.sub] || 0) + sign;
}

// Meilleur candidat DISPONIBLE (pas déjà posté ailleurs ce créneau) pour ce trou précis -- équité
// (ratio charge/disponibilité le plus bas) parmi ceux qui respectent la spécialité/compétence
// attendue (voir generationCandidateMatchesSpecialite() et fillGenerationCell() pour QUAND `vacSpec`
// est renseigné selon le grade). `null` si personne n'est éligible du tout.
function pickGenerationCandidate({ activityId, day, creneau, wantGrade, vacSpec, bucketVacSpec, excludeIds, load, capacity, internBalance, specialiteFamilies }) {
  let best = null;
  let bestScore = Infinity;
  state.staff.forEach((person) => {
    if (person.grade !== wantGrade) return;
    if (excludeIds.includes(person.id)) return;
    if (!isGenerationCandidateEligible(person, day, creneau.id)) return;
    if (hasActivityExclusivityConflict(person.id, day, creneau.id, activityId)) return;
    if (isGenerationCandidateHardBlocked(person, activityId, day, creneau.id)) return;
    if (!generationCandidateMatchesSpecialite(person, activityId, day, creneau.id, vacSpec)) return;
    const ratio = (load[person.id] || 0) / (capacity[person.id] || 1);
    // RG-034 : ajustement d'équilibrage urgence/spé1/spé2 pour un interne double-spécialisé -- `0`
    // pour tout le monde d'autre, voir generationBalanceAdjustment().
    const score = ratio + generationBalanceAdjustment(person, activityId, creneau.id, bucketVacSpec, internBalance, specialiteFamilies);
    if (score < bestScore) {
      best = person;
      bestScore = score;
    }
  });
  return best;
}

// Dernier recours : "voler" une personne déjà posée (via la trame) sur une AUTRE activité du même
// jour+créneau -- seulement si sa case source garde son propre minimum une fois cette personne
// retirée (jamais un simple déplacement du trou d'une case à l'autre). Limité au même jour+créneau
// (pas de réorganisation d'un autre créneau/jour) -- portée volontairement restreinte pour cette 1re
// itération, voir le commentaire d'en-tête du fichier. Enregistre le déplacement dans `deviations`
// pour le résumé affiché à Samir (le repère orange sur le planning, lui, est purement dérivé -- voir
// trameDeviationMissingIds()).
function tryStealForGeneration({ activityId, day, creneau, wantGrade, vacSpec, bucketVacSpec, excludeIds, load, capacity, deviations, internBalance, specialiteFamilies }) {
  let best = null;
  let bestOtherKey = null;
  let bestOtherActivityId = null;
  let bestScore = Infinity;

  generationActivityIds().forEach((otherActivityId) => {
    if (otherActivityId === activityId) return;
    if (!isCreneauApplicable(otherActivityId, creneau.id)) return;
    const otherRule = resolveCompositionRule(otherActivityId, day, creneau.id);
    if (!otherRule) return;
    const otherKey = cellKey(otherActivityId, day, creneau.id);
    if (state.fermetures[otherKey]) return;
    const otherActivity = state.activities.find((a) => a.id === otherActivityId);
    if (!otherActivity || isVacationCellOs(otherActivity, day, creneau)) return;
    const otherList = state.assignments[otherKey];
    if (!otherList) return;

    otherList.forEach((candidateId) => {
      if (excludeIds.includes(candidateId)) return;
      const person = staffById(candidateId);
      if (!person || person.grade !== wantGrade) return;
      if (isGenerationCandidateHardBlocked(person, activityId, day, creneau.id)) return;
      if (!generationCandidateMatchesSpecialite(person, activityId, day, creneau.id, vacSpec)) return; // jamais voler pour dégrader la spécialité
      const remaining = otherList.filter((id) => id !== candidateId).map(staffById).filter(Boolean);
      const remainingSeniors = remaining.filter((p) => p.grade === "senior").length;
      const remainingInternes = remaining.filter((p) => p.grade !== "senior").length;
      if (remainingSeniors < otherRule.seniorMin) return;
      if (otherRule.interneMin !== null && remainingInternes < otherRule.interneMin) return;

      const ratio = (load[candidateId] || 0) / (capacity[candidateId] || 1);
      // RG-034 : même ajustement que pickGenerationCandidate(), évalué pour la case CIBLE (celle
      // qu'on cherche à combler) -- préfère voler quelqu'un pour qui cette case cible comble
      // justement un manque dans son équilibrage urgence/spé1/spé2, pas l'inverse.
      const score = ratio + generationBalanceAdjustment(person, activityId, creneau.id, bucketVacSpec, internBalance, specialiteFamilies);
      if (score < bestScore) {
        best = person;
        bestOtherKey = otherKey;
        bestOtherActivityId = otherActivityId;
        bestScore = score;
      }
    });
  });

  if (!best) return null;
  state.assignments[bestOtherKey] = state.assignments[bestOtherKey].filter((id) => id !== best.id);
  // RG-034 : retire l'affectation volée de son ancien compartiment AVANT que fillGenerationCell()
  // n'enregistre la nouvelle -- sinon le suivi resterait désynchronisé de la réalité (la personne
  // semblerait présente aux DEUX endroits à la fois pour le calcul d'équilibrage).
  const otherVacSpec = effectiveVacationSpecialite(bestOtherActivityId, day, creneau.id);
  recordGenerationBucket(best, bestOtherActivityId, creneau.id, otherVacSpec, internBalance, specialiteFamilies, -1);
  deviations.push({ key: bestOtherKey, staffId: best.id, movedToActivityId: activityId });
  return best;
}

// Comble UNE case jusqu'à son minimum (séniors + internes), en tentant candidat libre puis vol en
// dernier recours -- s'arrête et note le trou dans `unresolved` si ni l'un ni l'autre n'aboutit.
// `guard` : filet de sécurité, une case ne devrait jamais avoir besoin de plus de quelques tours.
function fillGenerationCell({ key, activityId, day, creneau, rule, load, capacity, deviations, unresolved, internBalance, specialiteFamilies }) {
  const list = state.assignments[key];
  // Spécialité propriétaire de la case, indépendamment du réglage requireSpecialite de la règle (qui
  // ne pilote que le signal de violation affiché à l'écran, pas ce que le générateur a le droit de
  // choisir -- voir le commentaire ci-dessous). RG-034 (11/08/2026) : c'est AUSSI la valeur utilisée
  // pour l'équilibrage urgence/spé1/spé2 d'un interne double-spécialisé, indépendamment de
  // `requireSpecialite` -- une case Scan B taguée "uro" reste une case "Uro Scan" pour ce calcul même
  // si la spécialité n'y est pas activement exigée.
  const cellVacSpec = effectiveVacationSpecialite(activityId, day, creneau.id);

  let guard = 0;
  while (guard++ < 12) {
    const people = list.map(staffById).filter(Boolean);
    const nbSeniors = people.filter((p) => p.grade === "senior").length;
    const nbInternes = people.filter((p) => p.grade !== "senior").length;
    const needSenior = nbSeniors < rule.seniorMin;
    const needInterne = rule.interneMin !== null && nbInternes < rule.interneMin;
    if (!needSenior && !needInterne) break;
    const wantGrade = needSenior ? "senior" : "interne";
    // ⚠️ 11/08/2026 (retour de Samir) : un SÉNIOR respecte TOUJOURS la spécialité/compétence de la
    // case si elle est renseignée -- c'est un professionnel d'UNE spécialité, jamais une préférence
    // discutable comme `requireSpecialite` (qui reste, lui, le seul réglage pour un INTERNE -- en
    // rotation, il peut légitimement être posté hors de sa spécialité si Samir n'a pas coché la case).
    const vacSpec = wantGrade === "senior" ? cellVacSpec : rule.requireSpecialite ? cellVacSpec : null;

    let candidate = pickGenerationCandidate({ activityId, day, creneau, wantGrade, vacSpec, bucketVacSpec: cellVacSpec, excludeIds: list, load, capacity, internBalance, specialiteFamilies });
    if (!candidate) {
      candidate = tryStealForGeneration({ activityId, day, creneau, wantGrade, vacSpec, bucketVacSpec: cellVacSpec, excludeIds: list, load, capacity, deviations, internBalance, specialiteFamilies });
    }
    if (!candidate) {
      const specText = vacSpec ? ` avec la spécialité ${SPECIALITES[vacSpec].label}` : "";
      unresolved.push({
        key,
        message: `${rule.labelPrefix}, ${day} ${creneau.label} : pas assez de ${wantGrade === "senior" ? "séniors" : "internes"} disponibles${specText}.`,
      });
      break;
    }
    list.push(candidate.id);
    load[candidate.id] = (load[candidate.id] || 0) + 1;
    recordGenerationBucket(candidate, activityId, creneau.id, cellVacSpec, internBalance, specialiteFamilies, 1); // RG-034
  }
}

// Disponibilité de chaque personne sur toute la plage générée (matin+après-midi uniquement, semaines
// verrouillées exclues) -- dénominateur de l'équité, calculé une seule fois avant de commencer à
// remplir quoi que ce soit.
function computeGenerationCapacity(weekOffsets) {
  const capacity = {};
  const originalOffset = state.weekOffset;
  weekOffsets.forEach((offset) => {
    state.weekOffset = offset;
    if (isWeekLocked(weekKey(getMonday(offset)))) return;
    DAYS.forEach((day) => {
      GENERATION_CRENEAUX_EQUITE.forEach((creneauId) => {
        state.staff.forEach((person) => {
          if (person.horsSisu || !person.grade) return;
          if (isGenerationCandidateEligible(person, day, creneauId)) {
            capacity[person.id] = (capacity[person.id] || 0) + 1;
          }
        });
      });
    });
  });
  state.weekOffset = originalOffset;
  return capacity;
}

// Matérialise TOUTES les cases concernées (baseline trame, RG-017/RG-023) pour toute la plage AVANT
// de combler quoi que ce soit, et compte la charge de départ que ça représente déjà pour chacun --
// l'équité doit tenir compte de ce que la trame donne déjà, pas seulement de ce que le générateur
// ajoute lui-même. Nécessaire aussi pour que tryStealForGeneration() puisse trouver des cases
// "source" déjà matérialisées dès le premier trou rencontré, quel que soit l'ordre de la boucle
// principale.
function computeGenerationBaselineLoad(weekOffsets, internBalance, specialiteFamilies) {
  const load = {};
  const originalOffset = state.weekOffset;
  const activityIds = generationActivityIds();
  weekOffsets.forEach((offset) => {
    state.weekOffset = offset;
    if (isWeekLocked(weekKey(getMonday(offset)))) return;
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        activityIds.forEach((activityId) => {
          if (!isCreneauApplicable(activityId, creneau.id)) return;
          const rule = resolveCompositionRule(activityId, day, creneau.id);
          if (!rule) return;
          const key = cellKey(activityId, day, creneau.id);
          if (state.fermetures[key]) return;
          const activity = state.activities.find((a) => a.id === activityId);
          if (isVacationCellOs(activity, day, creneau)) return;
          const vacSpec = effectiveVacationSpecialite(activityId, day, creneau.id); // RG-034
          const list = ensureMaterializedAssignments(key);
          list.forEach((id) => {
            load[id] = (load[id] || 0) + 1;
            const person = staffById(id);
            if (person) recordGenerationBucket(person, activityId, creneau.id, vacSpec, internBalance, specialiteFamilies, 1); // RG-034
          });
        });
      });
    });
  });
  state.weekOffset = originalOffset;
  return load;
}

// Point d'entrée : génère de `startWeekKeyPart` (lundi) sur `numWeeks` semaines. Ne fait qu'UN seul
// render()/saveState() à la toute fin (voir le commentaire d'en-tête du fichier sur la simulation de
// state.weekOffset).
function runGeneration(startWeekKeyPart, numWeeks) {
  const originalOffset = state.weekOffset;
  const startOffset = weekOffsetForWeekKey(startWeekKeyPart);
  const weekOffsets = Array.from({ length: numWeeks }, (_, i) => startOffset + i);
  const activityIds = generationActivityIds();

  if (GENERATION_RESET_TO_TRAME_FIRST) {
    clearGenerationManagedRange(weekOffsets);
  }

  const capacity = computeGenerationCapacity(weekOffsets);
  // RG-034 : suivi urgence/spé1/spé2 par interne double-spécialisé, calculé une fois pour toute la
  // plage (`specialiteFamilies`, stable) puis mis à jour au fil du remplissage (`internBalance`, muté
  // par recordGenerationBucket() dans computeGenerationBaselineLoad()/fillGenerationCell()/
  // tryStealForGeneration()).
  const specialiteFamilies = computeSpecialiteModalityFamilies();
  const internBalance = {};
  const load = computeGenerationBaselineLoad(weekOffsets, internBalance, specialiteFamilies);

  const deviations = [];
  const unresolved = [];
  let lockedWeeksSkipped = 0;

  weekOffsets.forEach((offset) => {
    state.weekOffset = offset;
    const wk = weekKey(getMonday(offset));
    if (isWeekLocked(wk)) {
      lockedWeeksSkipped++;
      return;
    }

    // Jour puis créneau puis activité (comme validateActivityExclusivity()) -- pour que deux
    // activités différentes du même jour+créneau se voient correctement l'une l'autre (exclusivité
    // RG-021) au fil du remplissage, pas seulement une fois tout fini.
    //
    // ⚠️ 11/08/2026 (retour de Samir sur un cas réel) : à l'intérieur d'un même jour+créneau, les
    // activités À SPÉCIALITÉ EXIGÉE (`requireSpecialite: true`, ex. Scan B) sont désormais traitées
    // AVANT celles qui n'en ont pas (ex. Scan U) -- avant ce correctif, l'ordre était juste celui de
    // state.rules (Scan U toujours en premier), ce qui pouvait "dépenser" un sénior d'une spécialité
    // rare (ex. Sarah Montagne, Uro) sur Scan U (n'importe quel sénior convient) alors que Scan B,
    // traité ensuite, en avait justement besoin et ne trouvait plus personne -- observé en vrai :
    // Montagne posée sur Scan U pendant que Scan B restait à 1 sénior au lieu de 2, alors qu'Amine
    // Ayed (Digestif, dispo, sans contrainte de spécialité pour Scan U) aurait très bien pu couvrir
    // Scan U à sa place. Réserver d'abord les cases qui EXIGENT une spécialité précise, avant de
    // "dépenser" qui que ce soit sur une case qui accepte tout le monde, résout ce cas précis sans
    // avoir besoin de modéliser une vraie notion de "rareté" par spécialité (portée limitée, comme le
    // reste de cette 1re itération -- deux activités à spécialité exigée en concurrence pour le même
    // profil restent départagées par leur ordre dans state.rules, pas encore par leur propre rareté).
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        const cellsToFill = activityIds
          .filter((activityId) => isCreneauApplicable(activityId, creneau.id))
          .map((activityId) => ({ activityId, rule: resolveCompositionRule(activityId, day, creneau.id) }))
          .filter(({ rule }) => rule)
          .sort((a, b) => (b.rule.requireSpecialite === true ? 1 : 0) - (a.rule.requireSpecialite === true ? 1 : 0));

        cellsToFill.forEach(({ activityId, rule }) => {
          const key = cellKey(activityId, day, creneau.id);
          if (state.fermetures[key]) return;
          const activity = state.activities.find((a) => a.id === activityId);
          if (isVacationCellOs(activity, day, creneau)) return;
          fillGenerationCell({ key, activityId, day, creneau, rule, load, capacity, deviations, unresolved, internBalance, specialiteFamilies });
        });
      });
    });
  });

  state.weekOffset = originalOffset;
  saveState();
  render();
  return { deviations, unresolved, weeksGenerated: weekOffsets.length - lockedWeeksSkipped, lockedWeeksSkipped };
}

document.getElementById("btnGenerate").addEventListener("click", () => {
  document.getElementById("moreMenu").classList.add("hidden");
  const input = prompt("Générer le planning sur combien de semaines, à partir de la semaine actuelle ?", "4");
  if (input === null) return;
  const numWeeks = parseInt(input, 10);
  if (!Number.isInteger(numWeeks) || numWeeks < 1 || numWeeks > 26) {
    alert("Nombre de semaines invalide (entre 1 et 26).");
    return;
  }
  const weekWord = numWeeks > 1 ? "semaines" : "semaine";
  const behaviorText = GENERATION_RESET_TO_TRAME_FIRST
    ? "MODE TEST : les affectations déjà posées sur ces semaines (générées ou à la main), pour les vacations gérées par le générateur, seront d'abord effacées puis entièrement refaites depuis la trame."
    : "Les cases déjà remplies à la main ne sont pas touchées, seuls les trous sont comblés.";
  if (
    !confirm(
      `Générer automatiquement ${numWeeks} ${weekWord} à partir de la semaine actuelle ?\n\n${behaviorText} Les semaines verrouillées sont ignorées.`
    )
  )
    return;

  const startWeekKeyPart = weekKey(getMonday(0));
  const { deviations, unresolved, weeksGenerated, lockedWeeksSkipped } = runGeneration(startWeekKeyPart, numWeeks);

  const lines = [`${weeksGenerated} ${weeksGenerated > 1 ? "semaines traitées" : "semaine traitée"}.`];
  if (lockedWeeksSkipped > 0) {
    lines.push(`${lockedWeeksSkipped} ${lockedWeeksSkipped > 1 ? "semaines verrouillées ignorées" : "semaine verrouillée ignorée"}.`);
  }
  if (deviations.length > 0) {
    lines.push(
      `${deviations.length} ${deviations.length > 1 ? "personnes déplacées" : "personne déplacée"} de sa trame de base pour compléter une autre case (repère orange sur le planning).`
    );
  }
  if (unresolved.length > 0) {
    lines.push(`${unresolved.length} ${unresolved.length > 1 ? "cases restées incomplètes" : "case restée incomplète"} faute de personnel disponible (voir aussi les violations sous le planning) :`);
    unresolved.slice(0, 10).forEach((u) => lines.push(`- ${u.message}`));
    if (unresolved.length > 10) lines.push(`... et ${unresolved.length - 10} de plus.`);
  } else {
    lines.push("Tout a pu être complété selon les règles définies.");
  }
  alert(lines.join("\n"));
});
