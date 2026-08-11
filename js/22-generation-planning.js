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
  if (personSatisfiesSpecialite(person, vacSpec)) return true;
  const override = specialiteOverrideForPerson(person, activityId, day, creneauId);
  return override === "ignore" || override === "downgrade";
}

// Meilleur candidat DISPONIBLE (pas déjà posté ailleurs ce créneau) pour ce trou précis -- équité
// (ratio charge/disponibilité le plus bas) parmi ceux qui respectent la spécialité/compétence
// attendue (voir generationCandidateMatchesSpecialite() et fillGenerationCell() pour QUAND `vacSpec`
// est renseigné selon le grade). `null` si personne n'est éligible du tout.
function pickGenerationCandidate({ activityId, day, creneau, wantGrade, vacSpec, excludeIds, load, capacity }) {
  let best = null;
  let bestRatio = Infinity;
  state.staff.forEach((person) => {
    if (person.grade !== wantGrade) return;
    if (excludeIds.includes(person.id)) return;
    if (!isGenerationCandidateEligible(person, day, creneau.id)) return;
    if (hasActivityExclusivityConflict(person.id, day, creneau.id, activityId)) return;
    if (isGenerationCandidateHardBlocked(person, activityId, day, creneau.id)) return;
    if (!generationCandidateMatchesSpecialite(person, activityId, day, creneau.id, vacSpec)) return;
    const ratio = (load[person.id] || 0) / (capacity[person.id] || 1);
    if (ratio < bestRatio) {
      best = person;
      bestRatio = ratio;
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
function tryStealForGeneration({ activityId, day, creneau, wantGrade, vacSpec, excludeIds, load, capacity, deviations }) {
  let best = null;
  let bestOtherKey = null;
  let bestRatio = Infinity;

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
      if (ratio < bestRatio) {
        best = person;
        bestOtherKey = otherKey;
        bestRatio = ratio;
      }
    });
  });

  if (!best) return null;
  state.assignments[bestOtherKey] = state.assignments[bestOtherKey].filter((id) => id !== best.id);
  deviations.push({ key: bestOtherKey, staffId: best.id, movedToActivityId: activityId });
  return best;
}

// Comble UNE case jusqu'à son minimum (séniors + internes), en tentant candidat libre puis vol en
// dernier recours -- s'arrête et note le trou dans `unresolved` si ni l'un ni l'autre n'aboutit.
// `guard` : filet de sécurité, une case ne devrait jamais avoir besoin de plus de quelques tours.
function fillGenerationCell({ key, activityId, day, creneau, rule, load, capacity, deviations, unresolved }) {
  const list = state.assignments[key];
  // Spécialité propriétaire de la case, indépendamment du réglage requireSpecialite de la règle (qui
  // ne pilote que le signal de violation affiché à l'écran, pas ce que le générateur a le droit de
  // choisir -- voir le commentaire ci-dessous).
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

    let candidate = pickGenerationCandidate({ activityId, day, creneau, wantGrade, vacSpec, excludeIds: list, load, capacity });
    if (!candidate) {
      candidate = tryStealForGeneration({ activityId, day, creneau, wantGrade, vacSpec, excludeIds: list, load, capacity, deviations });
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
function computeGenerationBaselineLoad(weekOffsets) {
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
          const list = ensureMaterializedAssignments(key);
          list.forEach((id) => {
            load[id] = (load[id] || 0) + 1;
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
  const load = computeGenerationBaselineLoad(weekOffsets);

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
          fillGenerationCell({ key, activityId, day, creneau, rule, load, capacity, deviations, unresolved });
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
