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

