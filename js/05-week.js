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

// RG-023 (05/08/2026) : reconstruit le lundi (Date locale) correspondant à un `weekKeyPart` --
// weekKey() convertit en UTC avant de tronquer (§2 CLAUDE.md, piège de fuseau horaire déjà connu),
// ce qui peut décaler la chaîne d'un jour selon le fuseau. Un simple `new Date(weekKeyPart)` ne
// suffit donc pas à retrouver le VRAI lundi local -- nécessaire ici pour comparer un `weekKeyPart`
// de state.assignments/state.trame à des dates de congé (state.conges, en heure locale, voir
// toISODateLocal()), un besoin qui n'existait pas avant (le reste du code ne fait que comparer des
// weekKeyPart entre eux en chaînes, jamais les reconvertir en Date). Teste le candidat naïf et son
// lendemain, retient celui dont weekKey() reproduit exactement la chaîne d'origine -- robuste au
// décalage quel que soit son sens/son ampleur (toujours ≤ 1 jour).
function mondayFromWeekKey(weekKeyPart) {
  const candidate = new Date(`${weekKeyPart}T00:00:00`);
  if (weekKey(candidate) === weekKeyPart) return candidate;
  const nextDay = new Date(candidate);
  nextDay.setDate(candidate.getDate() + 1);
  return nextDay;
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

// Verrouillage des semaines (29/07/2026, demande de Samir : "des modifications ont été reversées
// sur des semaines qu'on avait faites, sans savoir comment"). RÈGLE : `state.weekLocks[weekKeyStr]`
// gagne TOUJOURS quand il est présent (true OU false) -- c'est le SEUL moyen de déverrouiller une
// semaine passée, et le seul moyen de verrouiller une semaine actuelle/future à la main. En son
// absence, une semaine STRICTEMENT passée (avant la semaine réelle actuelle, jamais la semaine en
// cours elle-même) est verrouillée automatiquement ; une semaine actuelle/future est déverrouillée
// par défaut. `weekKeyStr` doit toujours être la weekKey brute (ex. weekKey(getMonday(offset))),
// jamais recalculée différemment ailleurs, pour rester comparable à weekKey(getMonday(0)).
function isWeekLocked(weekKeyStr) {
  if (Object.prototype.hasOwnProperty.call(state.weekLocks, weekKeyStr)) {
    return state.weekLocks[weekKeyStr];
  }
  return weekKeyStr < weekKey(getMonday(0));
}

// Bascule le verrouillage de LA SEMAINE ACTUELLEMENT AFFICHÉE (state.weekOffset) -- c'est la seule
// action manuelle qui existe pour verrouiller/déverrouiller (icône cadenas de la topbar, voir
// renderLockButton()). Écrit toujours un booléen explicite dans state.weekLocks (jamais retiré),
// pour que ce choix manuel gagne définitivement sur le calcul automatique, y compris s'il redevient
// "faux par défaut" plus tard (ex. déverrouiller une semaine qui était verrouillée automatiquement
// parce que passée -- il faut que ça reste déverrouillé, pas que ça reverrouille tout seul).
function toggleCurrentWeekLock() {
  const wk = weekKey(getMonday(state.weekOffset));
  state.weekLocks[wk] = !isWeekLocked(wk);
  saveState();
  render();
}

// Pas de weekKey ici : une spécialité de vacation est structurelle, la même toutes les semaines
// PAR DÉFAUT -- voir vacationSpecialitesWeekly juste en dessous pour l'exception par semaine (RG-024).
function vacationSpecKey(activityId, day, creneauId) {
  return `${activityId}|${day}|${creneauId}`;
}

// RG-024 (08/08/2026, demande de Samir : une vacation qui change de spécialité chaque semaine --
// ex. Scan B mardi : Thorax une semaine, Gynéco la suivante -- faussait les stats des semaines
// passées, puisque vacationSpecialites n'a qu'une seule valeur, écrasée à chaque changement). Même
// principe de repli qu'effectiveAssignedIds()/state.trame (RG-017) : une exception posée pour LA
// semaine `weekKeyPart` prime si elle existe, sinon on retombe sur la valeur structurelle. Contrairement
// à la trame, AUCUNE notion de "case touchée qui se découple" -- une exception, une fois posée, reste
// simplement une exception pour cette semaine, pour toujours (jamais réécrite par un changement
// structurel ultérieur), pas besoin de matérialisation.
function effectiveVacationSpecialiteForWeek(activityId, day, creneauId, weekKeyPart) {
  const baseKey = vacationSpecKey(activityId, day, creneauId);
  const weeklyKey = `${weekKeyPart}|${baseKey}`;
  if (Object.prototype.hasOwnProperty.call(state.vacationSpecialitesWeekly, weeklyKey)) {
    return state.vacationSpecialitesWeekly[weeklyKey];
  }
  return state.vacationSpecialites[baseKey];
}

// Variante pour la semaine ACTUELLEMENT AFFICHÉE (state.weekOffset) -- la majorité des lectures
// (teinte de fond, popover clic gauche/droit, fermeture en masse, vue Modalité/Personnel) portent
// sur cette semaine-là précisément.
function effectiveVacationSpecialite(activityId, day, creneauId) {
  return effectiveVacationSpecialiteForWeek(activityId, day, creneauId, weekKey(getMonday(state.weekOffset)));
}

// La case affichée montre-t-elle une exception de semaine plutôt que la valeur structurelle ? Utilisé
// pour le repère visuel (.vacation-spec-weekly-override) et pour savoir si le bouton "×" d'une
// étiquette doit retirer l'exception ou la valeur structurelle (voir buildVacationSpecTag()).
function isVacationSpecialiteWeeklyOverride(activityId, day, creneauId) {
  const wk = weekKey(getMonday(state.weekOffset));
  const weeklyKey = `${wk}|${vacationSpecKey(activityId, day, creneauId)}`;
  return Object.prototype.hasOwnProperty.call(state.vacationSpecialitesWeekly, weeklyKey);
}

// Pose/retire une exception de spécialité pour LA SEMAINE AFFICHÉE uniquement -- `specialiteKey`
// vaut une clé de SPECIALITES, ou la sentinelle "clear" pour retirer l'exception (revient à la
// valeur structurelle). Jamais appelée pour une modification structurelle -- voir
// renderVacationSpecPopoverContent() (clic gauche, structurel) vs openVacationSpecWeekMenu() (clic
// droit, cette fonction).
function setVacationSpecialiteForCurrentWeek(specKey, specialiteKey) {
  const wk = weekKey(getMonday(state.weekOffset));
  const weeklyKey = `${wk}|${specKey}`;
  if (specialiteKey === "clear") {
    delete state.vacationSpecialitesWeekly[weeklyKey];
  } else {
    state.vacationSpecialitesWeekly[weeklyKey] = specialiteKey;
  }
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
//
// RG-023 (05/08/2026, 1re automatisation basée sur les RG) : le repli trame ne poste JAMAIS quelqu'un
// d'absent (congé -- jour entier ou demi-journée -- ou repos de garde, RG-014) sur une case jamais
// touchée -- "solutionne directement" le conflit plutôt que de le laisser remonter en violation.
// Ne s'applique QU'au repli : une case déjà matérialisée (state.assignments explicite, y compris si
// Samir y a laissé/rajouté la personne à la main) n'est jamais filtrée ici, et continue de remonter
// la violation RG-014 habituelle -- voir filterAbsentFromTrame() juste en dessous.
function effectiveAssignedIds(key) {
  if (Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    return state.assignments[key];
  }
  if (state.weekOffset >= 0) {
    const [, day, creneauId] = trameKeyFromCellKey(key).split("|");
    const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
    return filterAbsentFromTrame(state.trame[trameKeyFromCellKey(key)] || [], iso, creneauId);
  }
  return [];
}

// RG-023 : retire du tableau `staffIds` (issu de state.trame) toute personne absente (congé/repos
// de garde, isPersonAbsentOnIsoSlot()) sur le jour+créneau ISO donné -- coeur partagé par
// effectiveAssignedIds() (semaine affichée) et effectiveAssignedIdsForWeek() (semaine arbitraire,
// voir plus bas), pour ne jamais désynchroniser les deux.
function filterAbsentFromTrame(staffIds, iso, creneauId) {
  return staffIds.filter((staffId) => !isPersonAbsentOnIsoSlot(staffId, iso, creneauId));
}

// RG-017 : avant toute mutation d'une case pour la semaine affichée (ajout/retrait), on s'assure
// qu'elle a une entrée EXPLICITE dans state.assignments -- copiée depuis effectiveAssignedIds()
// (donc depuis la trame si c'est de là que venait le contenu affiché jusque-là) si elle n'en avait
// pas encore. C'est ce qui "découple" une case précise d'une semaine précise de la trame dès qu'on
// y touche : les autres semaines/cases continuent de suivre la trame normalement. Renvoie le
// tableau (la référence dans state.assignments, pas une copie) pour que l'appelant puisse le
// modifier en place (push/filter puis réassigner).
// Verrouillage (29/07/2026) : point d'entrée UNIQUE pour toute addition, donc endroit naturel pour
// bloquer une semaine verrouillée -- si verrouillée, renvoie un tableau JETABLE (jamais stocké dans
// state.assignments) : tout push de l'appelant dessus reste sans le moindre effet réel.
function ensureMaterializedAssignments(key) {
  if (isWeekLocked(key.split("|")[0])) return [];
  if (!Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    state.assignments[key] = effectiveAssignedIds(key).slice();
  }
  return state.assignments[key];
}

// Retire `staffId` de la case `key` -- point d'entrée UNIQUE pour tout retrait direct (par
// opposition à ensureMaterializedAssignments(), pour les ajouts), remplace toute écriture directe
// équivalente (state.assignments[key] = effectiveAssignedIds(key).filter(...)). Utilisée par
// removeAssignment() (bouton ×), et par la case SOURCE d'un glisser-déposer (handleAssignmentDrop()/
// handleModaliteDrop()). Verrouillage (29/07/2026) : aucun effet si la semaine est verrouillée --
// mêmes garanties que ensureMaterializedAssignments() côté ajout.
function removeFromAssignments(key, staffId) {
  if (isWeekLocked(key.split("|")[0])) return;
  state.assignments[key] = effectiveAssignedIds(key).filter((id) => id !== staffId);
}

// RG-010 : ferme/rouvre la case `key` -- point d'entrée UNIQUE pour toute écriture dans
// state.fermetures (popover case par case, fermeture en masse). Fermer matérialise aussi la case à
// vide (voir le commentaire d'origine sur ce comportement dans regles-gestion.md RG-010).
// Verrouillage (29/07/2026) : aucun effet si la semaine est verrouillée, ni pour fermer ni pour
// rouvrir -- une fermeture change l'état de la semaine tout autant qu'une assignation.
function setFermeture(key, closed) {
  if (isWeekLocked(key.split("|")[0])) return;
  if (closed) {
    state.fermetures[key] = true;
    state.assignments[key] = [];
  } else {
    delete state.fermetures[key];
  }
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
//
// RG-023 (05/08/2026) : ne propage JAMAIS vers un créneau où la personne est absente (congé/repos de
// garde) cette semaine-là -- sans ce garde-fou, un cas réel restait ouvert : une personne déjà en
// congé sur une semaine future (donc déjà matérialisée-vidée par le dépostage RG-013/014 au moment
// de la déclaration, voir depostAssignmentsForDay()) qu'on ajoute ENSUITE à sa trame se retrouvait
// quand même repostée ici, cette fonction ne vérifiant jusque-là jamais l'absence avant de pousser.
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
    if (isWeekLocked(assignWeekKey)) return; // verrouillage (29/07/2026) : bypass tout le reste, y compris la propagation de trame.
    const iso = weekIsoDates(mondayFromWeekKey(assignWeekKey))[DAYS.indexOf(day)];
    if (isPersonAbsentOnIsoSlot(staffId, iso, creneauId)) return; // RG-023 : jamais vers un créneau où la personne est absente.
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

