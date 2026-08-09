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

// Un enregistrement de congé couvre-t-il un jour+créneau PRÉCIS ? (05/08/2026, congé demi-journée)
// Une "journée entière" (pas de demiJournee) couvre matin+astreinte+après-midi, comme avant ; un
// enregistrement "matin"/"apres-midi" ne couvre QUE ce créneau -- jamais l'astreinte (créneau à
// part, RG-012), même principe que Off/Temps Partiel (voir isPersonUnavailableAllDay()).
function congeCoversSlot(staffId, iso, creneauId) {
  return state.conges.some((c) => {
    if (!congeCoversDay(c, staffId, iso)) return false;
    if (!c.demiJournee) return true;
    return creneauId !== "astreinte" && c.demiJournee === creneauId;
  });
}

// Suffixe " (matin)"/" (après-midi)" pour un jour couvert par UN SEUL congé demi-journée (05/08/2026)
// -- vide si le jour est couvert en journée entière (un enregistrement complet, ou deux demi-
// journées qui se complètent matin+après-midi). Utilisée par buildAbsenceBar() pour que Samir voie
// d'un coup d'œil qu'une case "Lundi" n'est en réalité qu'une demi-absence.
function congeHalfDaySuffixForDay(staffId, iso) {
  const records = state.conges.filter((c) => congeCoversDay(c, staffId, iso));
  if (records.length === 0 || records.some((c) => !c.demiJournee)) return "";
  const halves = new Set(records.map((c) => c.demiJournee));
  if (halves.size === 1) return halves.has("matin") ? " (matin)" : " (après-midi)";
  return ""; // matin + après-midi séparés -> couvre toute la journée, pas de suffixe
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
  depostAssignmentsForDay(staffId, iso); // RG-014, voir depostAssignmentsForDay().
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

// Définit l'état de congé d'un jour précis via le menu contextuel (clic droit sur la pilule Congé,
// 05/08/2026, congé demi-journée) : remplace TOUJOURS ce qui existait déjà ce jour-là (jamais deux
// enregistrements empilés sur le même jour, `removeCongeDay()` gère la découpe si ce jour faisait
// partie d'une plage plus large) -- `demiJournee` vaut "matin"/"apres-midi" pour une demi-journée,
// null/undefined pour une journée entière, ou la sentinelle "clear" pour retirer complètement. Le
// clic gauche standard (bascule journée entière) continue de passer par addCongeDay()/
// removeCongeDay(), inchangés -- demande explicite de Samir de ne pas changer ce geste existant.
function setCongeHalfDay(staffId, iso, demiJournee) {
  removeCongeDay(staffId, iso);
  if (demiJournee === "clear") return;
  state.conges.push({ id: generateId(), staffId, dateDebut: iso, dateFin: iso, demiJournee: demiJournee || undefined });
  if (demiJournee) depostAssignmentsForSlot(staffId, iso, demiJournee); // ne vide QUE ce créneau
  else depostAssignmentsForDay(staffId, iso); // journée entière, comportement inchangé
}

// Gardes : toujours un seul jour (pas de plage), donc pas besoin de la logique de découpe
// ci-dessus -- ajout/retrait d'un enregistrement unique par jour.
function isOnGardeDay(staffId, iso) {
  return state.gardes.some((g) => g.staffId === staffId && g.date === iso);
}

function toggleGardeDay(staffId, iso) {
  const idx = state.gardes.findIndex((g) => g.staffId === staffId && g.date === iso);
  if (idx >= 0) {
    state.gardes.splice(idx, 1);
  } else {
    state.gardes.push({ id: generateId(), staffId, date: iso });
    depostAssignmentsForReposGardeDay(staffId, iso); // RG-013/014, voir sa déclaration.
  }
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

// RG-013/014 (29/07/2026, demande de Samir : "si je t'annonce une garde dans les absences, tu dois
// faire sauter toutes les affectations sur le repos de garde qui en découle") : déclarer une garde
// (popover à la main OU import ARI, les deux passent par ici) déposte immédiatement la personne de
// TOUTES ses affectations sur le jour de repos de garde qui en découle (lendemain, RG-013) --
// granularité JOURNÉE ENTIÈRE (matin+astreinte+après-midi, toutes activités), comme RG-014 partout
// ailleurs. Même principe qu'une fermeture de vacation (RG-010) : un dépostage PONCTUEL au moment de
// l'action, jamais un blocage permanent -- si Samir la réassigne ensuite à la main sur ce même jour,
// rien ne l'empêche, seule la violation RG-014 (contour rouge) signale la contradiction comme pour
// n'importe quelle absence ajoutée après coup ("si je rajoute après à la main, tu les affiches comme
// d'hab en conflit"). Ne fait rien si le repos tombe un jour hors grille (samedi -- garde le vendredi,
// cas limite déjà documenté pour isOnReposGardeDay()) : aucune case n'existe pour ce jour-là de toute
// façon. Retirer une garde (toggleGardeDay(), branche suppression) ne restaure JAMAIS les affectations
// dépostées -- même asymétrie que rouvrir une case fermée (RG-010), délibérée.
// Cœur partagé du dépostage RG-013/RG-014 (29/07/2026) : vide TOUTES les affectations de `staffId`
// pour le jour ISO donné (matin+astreinte+après-midi, toutes activités), quelle que soit la semaine
// à laquelle ce jour appartient. Ne fait rien si `iso` tombe hors grille (samedi/dimanche -- DAYS
// s'arrête au vendredi). Réutilisé pour un jour de repos de garde (le lendemain d'une garde) ET pour
// un jour de congé déclaré directement (voir depostAssignmentsForReposGardeDay()/addCongeDay()).
function depostAssignmentsForDay(staffId, iso) {
  CRENEAUX.forEach((creneau) => depostAssignmentsForSlot(staffId, iso, creneau.id));
}

// Variante par créneau (05/08/2026, congé demi-journée) : vide uniquement le créneau `creneauId`
// (matin ou après-midi -- jamais l'astreinte, non concernée par un congé demi-journée) de `staffId`,
// toutes activités confondues, pour le jour ISO donné. Cœur partagé, `depostAssignmentsForDay()`
// n'est plus qu'une boucle dessus sur les 3 créneaux.
function depostAssignmentsForSlot(staffId, iso, creneauId) {
  const date = new Date(`${iso}T00:00:00`);
  const dow = date.getDay(); // 0 = dimanche ... 6 = samedi
  if (dow < 1 || dow > 5) return;
  const dayName = DAYS[dow - 1];
  const weekKeyPart = weekKey(mondayOfDate(date));

  state.activities.forEach((activity) => {
    if (!isCreneauApplicable(activity.id, creneauId)) return;
    const key = `${weekKeyPart}|${activity.id}|${dayName}|${creneauId}`;
    const list = ensureMaterializedAssignmentsForWeek(key, weekKeyPart);
    const idx = list.indexOf(staffId);
    if (idx !== -1) list.splice(idx, 1);
  });
}

function depostAssignmentsForReposGardeDay(staffId, gardeIso) {
  depostAssignmentsForDay(staffId, isoAddDays(gardeIso, 1));
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
  // Suffixe " (matin)"/" (après-midi)" (05/08/2026, congé demi-journée) : uniquement hors "Semaine"
  // entière -- ce cas reste un raccourci textuel grossier, pas la peine de le détailler par demi-
  // journée. Un jour de repos de garde (toujours journée entière) n'a jamais de congé associé ce
  // jour-là, congeHalfDaySuffixForDay() renvoie donc naturellement "" pour lui.
  const isoDates = weekIsoDates(monday);
  const labels = isFullWeek
    ? ["Semaine"]
    : absentIdx.map((i) => DAYS[i] + congeHalfDaySuffixForDay(person.id, isoDates[i]));
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

