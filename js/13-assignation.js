// ---------- Assignation ----------

function removeAssignment(key, staffId) {
  // RG-017 : part de effectiveAssignedIds() (pas state.assignments[key] || []) pour retirer
  // correctement une personne venue de la trame -- l'écriture juste après matérialise la case
  // (tableau explicite, potentiellement plus petit) pour cette semaine précise. Verrouillage
  // (29/07/2026) : voir removeFromAssignments(), sans effet si la semaine est verrouillée.
  removeFromAssignments(key, staffId);
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
  // RG-010 (29/07/2026) : une activité fermée ce créneau-là n'est plus proposée non plus -- fermait
  // déjà le "contournement par la vue Personnel" documenté depuis le 21/07/2026 (assignable ici alors
  // qu'impossible en vue Modalité).
  const available = state.activities.filter((a) =>
    !assignedIds.has(a.id) && isCreneauApplicable(a.id, creneau.id) && !state.fermetures[cellKey(a.id, day, creneau.id)]
  );

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
  // Menu contextuel de la pilule Congé (clic droit, 05/08/2026) -- se ferme au clic extérieur, même
  // patron que les autres menus/popovers de l'appli.
  const congeMenu = document.getElementById("congeHalfDayMenu");
  if (congeMenu && !congeMenu.classList.contains("hidden") && !e.target.closest("#congeHalfDayMenu")) {
    congeMenu.classList.add("hidden");
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

