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
  return effectiveVacationSpecialite(activity.id, day, creneau.id) === "os"; // RG-024
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
    setFermeture(cellKey(activity.id, day, creneau.id), closed);
  });
}

function setWeekClosedForActivity(activity, closed) {
  fermableCellsForWeek(activity).forEach(({ day, creneau }) => {
    setFermeture(cellKey(activity.id, day, creneau.id), closed);
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
// RG-010 (29/07/2026, bug remonté par Samir : "sur le planning perso des gens, on les voit encore
// postés" sur une vacation fermée) : contrairement à buildModaliteCell() côté vue Modalité (qui
// masque entièrement le contenu d'une case fermée, croix noire à la place des pastilles quelle que
// soit la donnée sous-jacente), cette fonction ne vérifiait jamais state.fermetures -- une case
// fermée AVANT le correctif du 24/07/2026 qui matérialise state.assignments à vide (jamais touchée
// depuis) continuait donc de "peupler" la vue Personnel via le repli trame, fantôme invisible côté
// vue Modalité mais bien visible ici. Fix : une case fermée ne compte plus jamais comme une
// affectation, quelle que soit la donnée en dessous (matérialisée ou pas) -- aligné sur le
// comportement de buildModaliteCell().
function activitiesForPersonSlot(personId, day, creneauId) {
  return state.activities.filter((activity) => {
    const key = cellKey(activity.id, day, creneauId);
    if (state.fermetures[key]) return false;
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
  // Verrouillage (29/07/2026) : une seule semaine affichée pour tout ce rendu, calculé une fois.
  const weekLocked = isWeekLocked(weekKey(monday));

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
      // Congé ou repos de garde (RG-013) rend la personne indisponible sur les créneaux concernés --
      // granularité PAR CRÉNEAU depuis le 05/08/2026 (congé demi-journée) : un congé "matin" ne
      // bloque plus que la case matin, l'après-midi reste normalement postable (avant cette date,
      // congé/repos étaient toujours journée entière -- même statut sur les deux moitiés). Congé
      // prioritaire sur repos de garde si (rare) les deux coïncident sur le même créneau. La garde
      // elle-même ne bloque rien : elle signifie que la personne travaille ce jour-là.
      const absenceForSlot = (creneauId) => {
        if (congeCoversSlot(person.id, iso, creneauId)) return { label: "Congés", cls: "cell-absence-conge" };
        if (isOnReposGardeDay(person.id, iso)) return { label: "Repos de garde", cls: "cell-absence-repos" };
        return null;
      };
      const morningAbsence = absenceForSlot("matin");
      const afternoonAbsence = absenceForSlot("apres-midi");

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
          hint.textContent = weekLocked ? "Verrouillée" : "+ ajouter";
          td.appendChild(hint);
        } else {
          activitiesHere.forEach((activity) => {
            const key = cellKey(activity.id, day, creneau.id);
            td.appendChild(buildModaliteTag(activity, key, person.id, { draggable: true }));
          });
        }

        if (isOff) td.classList.add("cell-off-marked");

        // Verrouillage (29/07/2026) : "rien d'actif" -- aucun écouteur posé sur une semaine
        // verrouillée, tooltip explicite au survol (voir isWeekLocked()/buildModaliteCell() pour le
        // même patron côté vue Modalité).
        if (weekLocked) {
          td.classList.add("cell-week-locked");
          td.title = "Semaine verrouillée -- aucune modification possible.";
        } else {
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
        }

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

      // RG-014/018/020 (25/07/2026, demande de Samir ; revu le 05/08/2026 pour le congé demi-
      // journée) : fusionner matin/astreinte/après-midi en une seule case (au lieu de 3 identiques)
      // si les 2 moitiés sont indisponibles POUR LA MÊME RAISON (même label/classe -- avant le congé
      // demi-journée, congé/repos étaient toujours journée entière donc les 2 moitiés partageaient
      // forcément le même statut, cette condition était donc implicitement toujours vraie dès que les
      // 2 étaient indisponibles) ; fusionner seulement astreinte+après-midi si seule l'après-midi est
      // indisponible. Si matin et après-midi sont indisponibles pour des raisons DIFFÉRENTES (ex.
      // congé le matin, Temps Partiel l'après-midi -- rare), les 2 restent des cases séparées plutôt
      // que d'afficher un label qui ne vaudrait que pour une moitié.
      const morningUnavailable = !!morningAbsence || isPersonTPOnSlot(person.id, day, "matin");
      const afternoonUnavailable = !!afternoonAbsence || isPersonTPOnSlot(person.id, day, "apres-midi");
      const morningLabel = morningAbsence ? morningAbsence.label : "Temps Partiel";
      const morningClass = morningAbsence ? morningAbsence.cls : "cell-absence-tp";
      const afternoonLabel = afternoonAbsence ? afternoonAbsence.label : "Temps Partiel";
      const afternoonClass = afternoonAbsence ? afternoonAbsence.cls : "cell-absence-tp";

      // .day-start (25/07/2026) : séparateur de jour plus visible, voir §6.28/style.css -- posé sur
      // la 1re case du jour, qu'elle soit fusionnée (colSpan 3) ou non (matin seul).
      if (morningUnavailable && afternoonUnavailable && morningLabel === afternoonLabel && morningClass === afternoonClass) {
        const cell = buildBlockedCell(morningLabel, morningClass, 3);
        cell.classList.add("day-start");
        tr.appendChild(cell);
      } else {
        const morningCell = morningUnavailable ? buildBlockedCell(morningLabel, morningClass, 1) : buildNormalCell(CRENEAUX[0]);
        morningCell.classList.add("day-start");
        tr.appendChild(morningCell);
        if (afternoonUnavailable) {
          tr.appendChild(buildBlockedCell(afternoonLabel, afternoonClass, 2));
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
  const tagWeekKeyPart = key.split("|")[0];
  const vacSpec = effectiveVacationSpecialiteForWeek(activity.id, tagDay, tagCreneauId, tagWeekKeyPart); // RG-024
  const locked = isWeekLocked(tagWeekKeyPart); // verrouillage (29/07/2026), voir isWeekLocked().
  // RG-014/RG-020/RG-021 : même logique de contour rouge que buildAssignedChip() côté vue
  // Modalité -- peut désormais arriver aussi bien via le popover que via le glisser-déposer (plus
  // aucun des deux n'est bloqué depuis le 25/07/2026, voir handleModaliteDrop()) : ce contour rouge
  // est le seul signal de la contradiction, pas un filet de sécurité pour un cas résiduel. RG-021
  // (29/07/2026) généralise l'ancienne RG-018/RG-019 -- Off n'est plus un cas particulier.
  // Verrouillage : prime sur toute violation, aucun conflit n'a de sens à signaler case gelée.
  const isAbsenceViolation = !locked && activity.id !== "off" && isPersonAbsentOnSlot(staffId, tagDay, tagCreneauId);
  const isTPViolation = !locked && !isAbsenceViolation && isPersonTPOnSlot(staffId, tagDay, tagCreneauId);
  const isExclusivityViolation = !locked && !isAbsenceViolation && !isTPViolation && hasActivityExclusivityConflict(staffId, tagDay, tagCreneauId, activity.id);
  const isViolation = isAbsenceViolation || isTPViolation || isExclusivityViolation;
  tag.className = "chip modalite-tag" +
    (activity.urgence ? " urgence-tag" : "") +
    (vacSpec ? ` spec-${vacSpec}` : "") +
    (isViolation ? " chip-absence-violation" : "") +
    (locked ? " chip-week-locked" : "");
  if (locked) {
    tag.title = "Semaine verrouillée";
  } else if (isViolation) {
    const person = staffById(staffId);
    if (person) {
      tag.title = isAbsenceViolation
        ? `${person.prenom} ${person.nom} est absent(e) ce créneau-là`
        : isTPViolation
          ? `${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là`
          : `${person.prenom} ${person.nom} est déjà posté(e) ailleurs ce créneau-là`;
    }
  }
  tag.textContent = activity.nom;
  if (locked) return tag; // ni glisser, ni bouton de retrait -- "rien d'actif" sur une semaine verrouillée.
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
    removeFromAssignments(sourceKey, draggedStaffId);
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

