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

// Corrigé le 09/08/2026 (piège de fuseau horaire déjà documenté en CLAUDE.md §2, jamais réparé à la
// source) : utilisait `.toISOString()`, qui convertit la date LOCALE en UTC avant de tronquer --
// pour un fuseau en avance sur UTC (France : CET UTC+1 ou CEST UTC+2, toujours en avance, jamais en
// retard), soustraire n'importe quelle heure positive à minuit local retombe TOUJOURS sur la veille
// en UTC, donc `weekKey()` renvoyait systématiquement la date de la veille du vrai lundi (ex. "le
// lundi 5 octobre" stocké sous "2026-10-04"). Toutes les clés écrites avant ce correctif ont donc ce
// décalage -- voir STATE_MIGRATIONS[11] (js/03-state.js) qui les réaligne une seule fois. Recalcul en
// LOCAL direct (mêmes composants Y/M/D que toISODateLocal(), dupliqué ici plutôt qu'appelé -- ce
// fichier charge avant js/06-conges-model.js qui la définit, voir CLAUDE.md §2 point 4) : plus aucune
// conversion UTC, donc plus aucun décalage possible quel que soit le fuseau.
function weekKey(monday) {
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// RG-023 (05/08/2026) : reconstruit le lundi (Date locale) correspondant à un `weekKeyPart` --
// nécessaire pour comparer un `weekKeyPart` de state.assignments/state.trame à des dates de congé
// (state.conges, en heure locale, voir toISODateLocal()), un besoin qui n'existait pas avant (le
// reste du code ne fait que comparer des weekKeyPart entre eux en chaînes, jamais les reconvertir
// en Date). Teste le candidat naïf et son lendemain, retient celui dont weekKey() reproduit
// exactement la chaîne d'origine.
// ⚠️ Écrite à l'origine (05/08/2026) pour contourner le piège de fuseau horaire de weekKey() (celui-ci
// convertissait en UTC avant de tronquer, décalant la chaîne d'un jour) -- ce piège est corrigé à la
// SOURCE depuis le 09/08/2026 (voir weekKey() juste au-dessus), donc la branche "lendemain" ci-dessous
// ne se déclenche plus jamais en pratique (le candidat naïf correspond toujours désormais). Laissée
// telle quelle par prudence (fonction toujours correcte, coût négligeable) plutôt que simplifiée --
// aucune urgence à la retirer.
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
// ---------- Historique des trames (24/10/2026) ----------
// Règle de Samir : "quand je modifie une trame (Trame Vacation OU Trame Personnel), elle s'applique à
// partir de la semaine sélectionnée et pour les semaines à venir -- ne touche plus jamais aux
// semaines passées". "Semaine sélectionnée" = la semaine AFFICHÉE (flèches ←/→), jamais avant la
// semaine réelle en cours -- voir trameEffectiveFromWeek() (tranché avec Samir : permet de préparer
// un changement "à partir du 15/11"). state.trame/state.vacationSpecialites = la DERNIÈRE valeur
// saisie ; state.trameHistory garde ce qui est en vigueur semaine par semaine :
//   { since: weekKey, baseTrame, baseSpecs, trame: { trameKey: [{ from, value }] }, specs: {...} }
// - `since` = semaine réelle où l'historique a démarré ; `baseTrame`/`baseSpecs` = les trames telles
//   qu'elles étaient à ce moment-là (valables de `since` jusqu'au 1er changement enregistré).
// - Chaque changement est enregistré AUTOMATIQUEMENT par recordTrameHistory() (appelée par saveState())
//   en comparant les trames actuelles à la dernière valeur connue -- aucune des nombreuses façons de
//   modifier une trame (popover, glisser-déposer, Temps Partiel, import, départ programmé...) n'a
//   besoin de le faire elle-même. Une nouvelle modif à partir de la semaine E remplace toute modif
//   déjà programmée APRÈS E pour la même case (la dernière saisie gagne à partir de E).
// - Lecture pour une semaine W >= since : valeur en vigueur en W (trameIdsForWeek()/
//   vacationSpecForWeekFromHistory()) ; W < since : comportement d'avant (voir ces fonctions).
// Pas de bump de STATE_SCHEMA_VERSION : objet absent -> {} via applyPersistedState(), initialisé
// paresseusement par ensureTrameHistoryInitialized() (appelée en tête de render(), donc juste après
// tout chargement et avant toute modification).
function ensureTrameHistoryInitialized() {
  const h = state.trameHistory;
  if (h && h.since) return h;
  state.trameHistory = {
    since: weekKey(getMonday(0)),
    baseTrame: JSON.parse(JSON.stringify(state.trame || {})),
    baseSpecs: { ...(state.vacationSpecialites || {}) },
    trame: {},
    specs: {},
  };
  return state.trameHistory;
}

// Semaine à partir de laquelle une modification de trame s'applique : la semaine affichée, jamais
// avant la semaine réelle en cours.
function trameEffectiveFromWeek() {
  const displayed = weekKey(getMonday(state.weekOffset));
  const current = weekKey(getMonday(0));
  return displayed > current ? displayed : current;
}

// Même borne que trameEffectiveFromWeek() ci-dessus, mais pour une date ISO ARBITRAIRE plutôt que
// state.weekOffset -- 24/10/2026, mutualisée depuis scheduleStaffDepartureFrom()/replacePersonFrom()
// (js/16-gestion-personnel.js, RG-040/RG-041), qui dataient jusque-là un changement de trame en
// simulant state.weekOffset puis en appelant saveState() (même technique que le générateur
// automatique, §6.57) -- devenu inutile depuis que recordTrameHistory() accepte un `fromOverride`
// direct (voir plus bas, ajouté le même jour pour purgeStaffIdFromCurrentAndFuture()). Jamais
// rétroactif : une date passée retombe sur la semaine réelle en cours, comme trameEffectiveFromWeek().
function trameEffectiveFromDate(iso) {
  const wk = weekKey(mondayOfDate(new Date(`${iso}T00:00:00`)));
  const current = weekKey(getMonday(0));
  return wk > current ? wk : current;
}

function trameHistoryValueAt(list, base, key, wk) {
  let value = base[key];
  (list[key] || []).forEach((entry) => { if (entry.from <= wk) value = entry.value; });
  return value;
}

function sameTrameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return [...(a || [])].sort().join("|") === [...(b || [])].sort().join("|");
  }
  return (a || null) === (b || null);
}

function recordTrameHistoryFor(current, list, base, from, clone) {
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(base), ...Object.keys(list)]);
  keys.forEach((key) => {
    const entries = list[key] || [];
    const latest = entries.length ? entries[entries.length - 1].value : base[key];
    const cur = current[key];
    if (sameTrameValue(latest, cur)) return;
    // La dernière saisie gagne à partir de `from` : on oublie tout changement programmé plus tard.
    const kept = entries.filter((e) => e.from < from);
    const before = kept.length ? kept[kept.length - 1].value : base[key];
    if (!sameTrameValue(before, cur)) kept.push({ from, value: clone(cur) });
    if (kept.length) list[key] = kept; else delete list[key];
  });
}

function recordTrameHistory(fromOverride) {
  const h = ensureTrameHistoryInitialized();
  const from = fromOverride || trameEffectiveFromWeek();
  recordTrameHistoryFor(state.trame || {}, h.trame, h.baseTrame, from, (v) => (v ? [...v] : []));
  recordTrameHistoryFor(state.vacationSpecialites || {}, h.specs, h.baseSpecs, from, (v) => v || null);
}

// Trame Personnel en vigueur pour la case `tKey` la semaine `wk`. `null` = rien (semaine passée
// antérieure au démarrage de l'historique : comportement d'avant, la trame ne s'appliquait pas au passé).
function trameIdsForWeek(tKey, wk) {
  const h = state.trameHistory;
  const current = weekKey(getMonday(0));
  if (!h || !h.since || wk < h.since) return wk >= current ? (state.trame[tKey] || []) : null;
  return trameHistoryValueAt(h.trame, h.baseTrame, tKey, wk) || [];
}

// Trame Vacation : `undefined` = pas d'historique applicable (semaine antérieure au démarrage de
// l'historique) -> l'appelant retombe sur la valeur actuelle comme avant.
function vacationSpecForWeekFromHistory(baseKey, wk) {
  const h = state.trameHistory;
  if (!h || !h.since || wk < h.since) return undefined;
  return trameHistoryValueAt(h.specs, h.baseSpecs, baseKey, wk) || null;
}

// ---------- Personne supprimée : nettoyage du présent et du futur (24/10/2026) ----------
// Demande de Samir ("on s'en fiche qu'elle existe encore dans le futur, on te laisse gérer l'aspect
// technique"), après avoir trouvé l'id d'une personne supprimée encore présent dans 290 cases et 10
// cases de trame : une personne qui n'existe plus dans state.staff est retirée de tout ce qui
// concerne la semaine EN COURS et les suivantes -- affectations (sauf semaine verrouillée, RG-022),
// trame (historisée à partir de la semaine en cours, jamais de la semaine affichée), Temps Partiel,
// congés/gardes à venir, règles globales et remises à zéro qui la nommaient. Le PASSÉ n'est jamais
// touché (règle "ne touche plus jamais aux semaines passées") -- il est de toute façon déjà ignoré
// partout à l'affichage (staffById() renvoie null). Renvoie true si quelque chose a changé.
function purgeStaffIdFromCurrentAndFuture(staffId) {
  const currentWeek = weekKey(getMonday(0));
  const todayIso = toISODateLocal(new Date());
  let changed = false;
  Object.keys(state.assignments).forEach((key) => {
    const wk = key.split("|")[0];
    if (wk < currentWeek || isWeekLocked(wk)) return;
    const list = state.assignments[key];
    if (!list.includes(staffId)) return;
    state.assignments[key] = list.filter((id) => id !== staffId);
    if (state.trameSourced[key]) state.trameSourced[key] = state.trameSourced[key].filter((id) => id !== staffId);
    changed = true;
  });
  let trameChanged = false;
  Object.keys(state.trame).forEach((key) => {
    if (!(state.trame[key] || []).includes(staffId)) return;
    state.trame[key] = state.trame[key].filter((id) => id !== staffId);
    trameChanged = true;
  });
  if (trameChanged) { recordTrameHistory(currentWeek); changed = true; }
  Object.keys(state.tempsPartiel).forEach((key) => {
    if (key.startsWith(`${staffId}|`)) { delete state.tempsPartiel[key]; changed = true; }
  });
  const congesBefore = state.conges.length;
  state.conges = state.conges.filter((c) => c.staffId !== staffId || c.dateFin < todayIso);
  const gardesBefore = state.gardes.length;
  state.gardes = state.gardes.filter((g) => g.staffId !== staffId || g.date < todayIso);
  if (state.conges.length !== congesBefore || state.gardes.length !== gardesBefore) changed = true;
  [...(state.globalRules || []), ...(state.statsResets || [])].forEach((r) => {
    if ((r.staffIds || []).includes(staffId)) { r.staffIds = r.staffIds.filter((id) => id !== staffId); changed = true; }
  });
  return changed;
}

// Rattrapage des personnes DÉJÀ supprimées avant ce nettoyage (appelé en tête de render()) : tout id
// référencé par la trame ou une affectation présente/future qui n'existe plus dans state.staff.
// Garde-fou : jamais si le personnel n'est pas chargé (repli sur DEMO_STAFF) ou si les "inconnus"
// sont trop nombreux (> 3 ids différents, ou plus d'un quart des ids référencés) -- signe d'une
// liste du personnel incomplète/corrompue plutôt que de quelques suppressions, où purger effacerait
// à tort une bonne partie du planning.
function purgeOrphanStaffIds() {
  if (state.staff === DEMO_STAFF || state.staff.length === 0) return false;
  const known = new Set(state.staff.map((p) => p.id));
  const currentWeek = weekKey(getMonday(0));
  const referenced = new Set();
  Object.values(state.trame).forEach((ids) => (ids || []).forEach((id) => referenced.add(id)));
  Object.entries(state.assignments).forEach(([key, ids]) => {
    if (key.split("|")[0] >= currentWeek) (ids || []).forEach((id) => referenced.add(id));
  });
  const orphans = [...referenced].filter((id) => !known.has(id));
  if (orphans.length === 0 || orphans.length > 3 || orphans.length > referenced.size / 4) return false;
  let changed = false;
  orphans.forEach((id) => { if (purgeStaffIdFromCurrentAndFuture(id)) changed = true; });
  return changed;
}

// ---------- Origine des affectations : trame vs manuel (24/10/2026) ----------
// Demande de Samir : distinguer les affectations mises AUTOMATIQUEMENT par la trame de celles ajoutées
// à la main, pour qu'un retrait dans la Trame Personnel nettoie les premières sans toucher aux
// secondes ("si je me trompe dans la trame de quelqu'un, ça me met plein d'affectations que je dois
// enlever à la main"). state.trameSourced[cellKey] = ids de la case qui viennent de la trame :
// renseigné quand une case est matérialisée à partir de la trame (ensureMaterializedAssignments()/
// ...ForWeek()) et quand un ajout de trame est propagé (propagateTrameAdditionToTouchedWeeks()) ;
// tout autre id de la case (popover, glisser-déposer, générateur automatique) est "manuel". Un id
// retiré à la main (removeFromAssignments()) sort aussi de la liste. Une case SANS entrée (matérialisée
// avant cette fonctionnalité) est traitée comme venant de la trame pour une personne qui est retirée
// de la trame -- c'est précisément le cas à nettoyer.
function markTrameSourced(key, ids) {
  state.trameSourced[key] = [...ids];
}

function propagateTrameRemovalFromWeeks(activityId, day, creneauId, staffId) {
  const fromWeek = trameEffectiveFromWeek();
  const suffix = `${activityId}|${day}|${creneauId}`;
  let removed = 0;
  Object.keys(state.assignments).forEach((assignKey) => {
    const parts = assignKey.split("|");
    if (parts.length !== 4 || `${parts[1]}|${parts[2]}|${parts[3]}` !== suffix) return;
    if (parts[0] < fromWeek || isWeekLocked(parts[0])) return;
    const list = state.assignments[assignKey];
    if (!list.includes(staffId)) return;
    const record = state.trameSourced[assignKey];
    if (record && !record.includes(staffId)) return; // ajouté à la main -> on n'y touche pas
    state.assignments[assignKey] = list.filter((id) => id !== staffId);
    if (record) state.trameSourced[assignKey] = record.filter((id) => id !== staffId);
    removed++;
  });
  return removed;
}

function effectiveVacationSpecialiteForWeek(activityId, day, creneauId, weekKeyPart) {
  const baseKey = vacationSpecKey(activityId, day, creneauId);
  const weeklyKey = `${weekKeyPart}|${baseKey}`;
  if (Object.prototype.hasOwnProperty.call(state.vacationSpecialitesWeekly, weeklyKey)) {
    return state.vacationSpecialitesWeekly[weeklyKey];
  }
  const fromHistory = vacationSpecForWeekFromHistory(baseKey, weekKeyPart); // trame datée (24/10/2026)
  if (fromHistory !== undefined) return fromHistory || undefined;
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
  // Trame datée (24/10/2026) : semaine en cours/future -> trame actuelle ; semaine passée -> la trame
  // telle qu'elle était CETTE semaine-là (trameIdsForWeek()), ou rien si antérieure à l'historique.
  const ids = trameIdsForWeek(trameKeyFromCellKey(key), key.split("|")[0]);
  if (ids) {
    const [, day, creneauId] = trameKeyFromCellKey(key).split("|");
    const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
    return filterAbsentFromTrame(ids, iso, creneauId);
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
    markTrameSourced(key, state.assignments[key]); // origine trame (24/10/2026)
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
  if (state.trameSourced[key]) state.trameSourced[key] = state.trameSourced[key].filter((id) => id !== staffId);
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
    state.trameSourced[key] = [];
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
  // Depuis le 24/10/2026 : à partir de la semaine affichée (jamais avant la semaine réelle en cours),
  // même règle que l'historique des trames -- voir trameEffectiveFromWeek().
  const currentWeekKey = trameEffectiveFromWeek();
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
      if (state.trameSourced[assignKey]) state.trameSourced[assignKey].push(staffId); // origine trame
      addedCount++;
    }
  });
  return addedCount;
}

// Repère visuel "cette case ne suit plus sa trame cette semaine" (11/08/2026, générateur de planning
// automatique -- voir js/22-generation-planning.js) : purement DÉRIVÉ, aucun nouvel état persisté --
// compare ce que la trame aurait posé ici (filtré des absences, comme effectiveAssignedIds()) à ce
// qui y est réellement pour la semaine affichée. Ne dit rien de QUI a fait le changement (le
// générateur ou une main humaine) ni POURQUOI -- juste "ça diverge du gabarit", ce qui reste vrai
// même après un rechargement/une resynchro GitHub, sans jamais pouvoir devenir périmé. Vide si la
// case n'a jamais été touchée (elle EST alors la trame, par définition d'effectiveAssignedIds()).
function trameDeviationMissingIds(key) {
  if (!Object.prototype.hasOwnProperty.call(state.assignments, key)) return [];
  const [, day, creneauId] = trameKeyFromCellKey(key).split("|");
  const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
  const baseline = filterAbsentFromTrame(state.trame[trameKeyFromCellKey(key)] || [], iso, creneauId);
  const actual = state.assignments[key];
  return baseline.filter((id) => !actual.includes(id));
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

