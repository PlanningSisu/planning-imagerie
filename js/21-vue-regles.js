// ---------- Vue Règles (moteur de règles paramétrable, 09/08/2026) ----------
// Écran de paramétrage des règles de composition (state.rules) -- remplace l'ancien codage en dur de
// RG-002/003/007/009/012. Même mise en page que Gestion Personnel (liste groupée + formulaire inline
// d'ajout/modification), plein écran comme Trame/Congés/Stats. Voir moteur-regles-brouillon.md pour
// la conception complète et js/07-validation-rg.js pour l'interpréteur (validateCompositionRules()).

function generateRuleId() {
  return "rule" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Plier/déplier les blocs de modalité (10/08/2026, demande de Samir : "aider à la visibilité") --
// transitoire, jamais persisté (repart tout déplié à chaque rechargement, comme staffModalSearchQuery
// et les autres petits états de vue de ce genre) : un Set d'`activityId` actuellement PLIÉS, vide par
// défaut = tout déplié (comportement d'origine, inchangé si Samir n'a jamais cliqué un en-tête).
const collapsedRuleGroups = new Set();

// Même logique de construction de texte que checkComposition() (js/07-validation-rg.js) pour la
// partie "attendu" d'un message -- dupliquée volontairement plutôt que d'exposer un helper partagé :
// ici c'est un simple texte d'aperçu/résumé, pas la validation elle-même (aucun risque à ce que les
// deux légèrement divergent si l'une évolue sans l'autre).
function describeRuleComposition(rule) {
  const mentionSenior = rule.mentionSeniorInText !== false;
  const seniorPart = mentionSenior ? plural(rule.seniorMin, "sénior") : null;
  let internePart = null;
  if (rule.interneMin !== null) {
    internePart =
      rule.interneMax !== null && rule.interneMax !== rule.interneMin
        ? `${rule.interneMin} à ${plural(rule.interneMax, "interne")}`
        : plural(rule.interneMin, "interne");
  }
  if (seniorPart && internePart) return `${seniorPart} + ${internePart}`;
  return seniorPart || internePart || "aucune composition minimale";
}

function renderRulesView() {
  const container = document.getElementById("rulesView");
  container.innerHTML = `
    <div class="global-rules-section">
      <div class="rules-header global-rules-header">
        <h3>Règles globales</h3>
        <button type="button" id="btnAddGlobalRule" class="btn-primary btn-outline">+ Ajouter une règle globale</button>
      </div>
      <div id="globalRuleFormContainer"></div>
      <div id="globalRulesList" class="rules-list"></div>
    </div>
    <div class="global-rules-section" id="gardeRuleSection"></div>
    <div class="rules-header">
      <h3>Règle des Vacations</h3>
      <button type="button" id="btnAddRule" class="btn-primary">+ Ajouter une règle</button>
    </div>
    <div id="ruleFormContainer"></div>
    <div id="rulesList" class="rules-list"></div>
  `;
  document.getElementById("btnAddRule").addEventListener("click", () => {
    document.getElementById("btnAddRule").blur();
    renderRuleForm(document.getElementById("ruleFormContainer"), null);
  });
  document.getElementById("btnAddGlobalRule").addEventListener("click", () => {
    document.getElementById("btnAddGlobalRule").blur();
    renderGlobalRuleForm(document.getElementById("globalRuleFormContainer"), null);
  });
  renderGlobalRulesList(document.getElementById("globalRulesList"));
  renderGardeRuleSection(document.getElementById("gardeRuleSection"));
  renderRulesList(document.getElementById("rulesList"));
}

function renderRulesList(container) {
  container.innerHTML = "";
  let anyRule = false;

  // Ordre des BLOCS par modalité (09/08/2026, demande de Samir : "je voulais aussi et surtout dire,
  // le bloc 'Scan A' etc") -- state.rulesGroupOrder plutôt que l'ordre naturel de state.activities,
  // réordonnable par glisser-déposer du <h3> (voir plus bas). Distinct du glisser-déposer déjà
  // existant sur chaque `.rules-row` (réordonne les règles À L'INTÉRIEUR d'un même bloc).
  const orderedActivities = state.rulesGroupOrder
    .map((id) => state.activities.find((a) => a.id === id))
    .filter(Boolean);

  orderedActivities.forEach((activity) => {
    const rulesForActivity = state.rules.filter((r) => r.activityId === activity.id);
    if (rulesForActivity.length === 0) return;
    anyRule = true;

    const isCollapsed = collapsedRuleGroups.has(activity.id);
    const section = document.createElement("div");
    section.className = "rules-activity-group" + (isCollapsed ? " collapsed" : "");
    const h3 = document.createElement("h3");
    h3.innerHTML = `<span class="rules-group-chevron">▾</span> ${activity.nom} <span class="rules-group-count">${plural(rulesForActivity.length, "règle")}</span>`;
    h3.title = "Cliquer pour plier/déplier -- glisser pour réordonner ce bloc";
    // Plier/déplier (10/08/2026) : un simple clic (mousedown+mouseup sans déplacement) ne déclenche
    // jamais dragstart -- les deux gestes cohabitent sans conflit, testé en vrai. Ne touche qu'à
    // `collapsedRuleGroups` (transitoire) + re-render de la liste, jamais state.rules ni saveState().
    h3.addEventListener("click", () => {
      if (isCollapsed) collapsedRuleGroups.delete(activity.id);
      else collapsedRuleGroups.add(activity.id);
      renderRulesList(container);
    });
    // Glisser-déposer du BLOC entier (pas juste ses règles) -- réordonne state.rulesGroupOrder.
    // `dataset.activityId` identifie le bloc ; le drop insère le bloc déplacé juste avant/après le
    // bloc cible selon le sens du glissé, même logique que le réordonnancement des `.rules-row`
    // au-dessus et des colonnes Stats (§6.24).
    h3.draggable = true;
    h3.dataset.activityId = activity.id;
    h3.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-rules-group", activity.id);
      e.dataTransfer.effectAllowed = "move";
      h3.classList.add("dragging");
    });
    h3.addEventListener("dragend", () => h3.classList.remove("dragging"));
    h3.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-rules-group")) return;
      e.preventDefault();
      h3.classList.add("drag-over");
    });
    h3.addEventListener("dragleave", () => h3.classList.remove("drag-over"));
    h3.addEventListener("drop", (e) => {
      if (!e.dataTransfer.types.includes("text/x-rules-group")) return;
      e.preventDefault();
      h3.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/x-rules-group");
      if (!draggedId || draggedId === activity.id) return;
      const order = state.rulesGroupOrder.slice();
      const fromIdx = order.indexOf(draggedId);
      const targetIdxBefore = order.indexOf(activity.id);
      if (fromIdx === -1 || targetIdxBefore === -1) return;
      order.splice(fromIdx, 1);
      let insertAt = order.indexOf(activity.id);
      if (fromIdx < targetIdxBefore) insertAt += 1;
      order.splice(insertAt, 0, draggedId);
      state.rulesGroupOrder = order;
      saveState();
      render();
    });
    section.appendChild(h3);

    rulesForActivity.forEach((rule) => {
      const daysText = rule.days.length === DAYS.length ? "Tous les jours" : rule.days.join(", ");
      const creneauxText = rule.creneaux.map(creneauLabel).join(" + ");

      const row = document.createElement("div");
      row.className = "rules-row";
      // Réordonnable par glisser-déposer (09/08/2026, demande de Samir : "important pour la suite
      // pour leur donner une priorité") -- même patron que les colonnes Stats (§6.24) : `dataset.ruleId`
      // identifie la ligne, le drop déplace la règle dans `state.rules` (l'ordre du tableau EST
      // l'ordre affiché/persisté, pas de champ séparé). Limité en pratique aux règles de la MÊME
      // modalité (chaque groupe est un conteneur DOM à part, impossible de glisser d'un groupe à
      // l'autre à la souris) -- resolveCompositionRule() n'utilise pas encore cet ordre pour
      // départager un chevauchement (toujours "le moins de jours gagne", voir sa déclaration) ; cet
      // ordre est pour l'instant purement une préférence d'affichage de Samir, la vraie priorité
      // viendra plus tard.
      row.draggable = true;
      row.dataset.ruleId = rule.id;
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", rule.id);
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === rule.id) return;
        const draggedRule = state.rules.find((r) => r.id === draggedId);
        if (!draggedRule || draggedRule.activityId !== rule.activityId) return; // pas de glissé entre modalités différentes
        const fromIdx = state.rules.indexOf(draggedRule);
        const targetIdxBefore = state.rules.indexOf(rule); // avant retrait, pour connaître le sens du glissé
        state.rules.splice(fromIdx, 1);
        let insertAt = state.rules.indexOf(rule); // position de la cible après retrait (a pu décaler de 1)
        if (fromIdx < targetIdxBefore) insertAt += 1; // glissé vers l'avant -> insertion APRÈS la cible
        state.rules.splice(insertAt, 0, draggedRule);
        saveState();
        render();
      });

      const desc = document.createElement("div");
      desc.className = "rules-row-desc";
      desc.innerHTML =
        `<strong>${daysText}</strong> — ${creneauxText}<br>` +
        `${describeRuleComposition(rule)} attendu(s)` +
        (rule.requireSpecialite ? ' <span class="rules-badge-spec">Spécialité exigée</span>' : "");
      row.appendChild(desc);

      const actions = document.createElement("div");
      actions.className = "rules-row-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "staff-modal-edit";
      editBtn.textContent = "Modifier";
      editBtn.addEventListener("click", () => renderRuleForm(document.getElementById("ruleFormContainer"), rule));
      // Copier (09/08/2026, demande de Samir) : ouvre le formulaire d'AJOUT (pas de modification --
      // `existingRule` reste null, donc la sauvegarde crée une nouvelle règle) mais pré-rempli avec
      // toutes les valeurs de la règle source via le 3e paramètre `prefillFrom`, pour ne devoir
      // changer que ce qui diffère (modalité, jours...) plutôt que ressaisir toute la composition.
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "staff-modal-edit";
      copyBtn.textContent = "Copier";
      copyBtn.addEventListener("click", () => renderRuleForm(document.getElementById("ruleFormContainer"), null, rule));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "staff-modal-delete";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => {
        if (!confirm(`Supprimer cette règle (${activity.nom}, ${daysText}, ${creneauxText}) ?`)) return;
        state.rules = state.rules.filter((r) => r.id !== rule.id);
        saveState();
        render();
      });
      actions.append(editBtn, copyBtn, delBtn);
      row.appendChild(actions);

      section.appendChild(row);
    });

    container.appendChild(section);
  });

  if (!anyRule) {
    container.innerHTML = '<div class="staff-modal-empty">Aucune règle définie -- aucune composition n\'est vérifiée tant qu\'aucune règle n\'existe pour une modalité.</div>';
  }
}

// ---------- Règles globales (10/08/2026) ----------
// Zone tout en haut de l'écran, transverse à toutes les modalités -- distincte de state.rules
// (composition PAR modalité, ci-dessus). 1er type : "ignoreSpecialite" (RG-001 desactivée pour des
// personnes/statuts ciblés, sur des modalités choisies -- voir isSpecialiteIgnoredForPerson() et
// GLOBAL_RULE_STATUS_OPTIONS, js/07-validation-rg.js). Conçu pour accueillir d'autres types plus
// tard : GLOBAL_RULE_TYPE_LABELS/le <select> Type ci-dessous sont déjà génériques même si un seul
// type existe aujourd'hui.
const GLOBAL_RULE_TYPE_LABELS = { ignoreSpecialite: "Ignorer la spécialité (RG-001)" };

function generateGlobalRuleId() {
  return "grule" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Texte résumé affiché dans la liste -- réutilisé aussi comme aperçu en direct dans le formulaire.
// `allActivities`/`allStatuses` (10/08/2026) court-circuitent leur partie du texte respective --
// "tout le monde" masque staffIds/statuses (redondants dès que allStatuses est coché).
function describeGlobalRule(rule) {
  let targetsText;
  if (rule.allStatuses) {
    targetsText = "tout le monde";
  } else {
    const staffNames = (rule.staffIds || [])
      .map((id) => staffById(id))
      .filter(Boolean)
      .sort(compareStaffOrder)
      .map((p) => `${p.prenom} ${p.nom}`);
    const statusLabels = (rule.statuses || [])
      .map((id) => GLOBAL_RULE_STATUS_OPTIONS.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => o.label);
    const targets = [...staffNames, ...statusLabels];
    targetsText = targets.length > 0 ? targets.join(", ") : "personne (aucune cible choisie)";
  }
  let activitiesText;
  if (rule.allActivities) {
    activitiesText = "toutes les modalités";
  } else {
    const activityNames = (rule.activityIds || [])
      .map((id) => state.activities.find((a) => a.id === id))
      .filter(Boolean)
      .map((a) => a.nom);
    activitiesText = activityNames.length > 0 ? activityNames.join(", ") : "aucune modalité choisie";
  }
  return `${GLOBAL_RULE_TYPE_LABELS[rule.type] || rule.type} pour ${targetsText} — sur ${activitiesText}`;
}

function renderGlobalRulesList(container) {
  container.innerHTML = "";
  if (state.globalRules.length === 0) {
    container.innerHTML = '<div class="staff-modal-empty">Aucune règle globale -- toutes les vérifications s\'appliquent normalement à tout le monde.</div>';
    return;
  }
  state.globalRules.forEach((rule) => {
    const row = document.createElement("div");
    row.className = "rules-row";
    const desc = document.createElement("div");
    desc.className = "rules-row-desc";
    desc.textContent = describeGlobalRule(rule);
    row.appendChild(desc);

    const actions = document.createElement("div");
    actions.className = "rules-row-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "staff-modal-edit";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => renderGlobalRuleForm(document.getElementById("globalRuleFormContainer"), rule));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "staff-modal-delete";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", () => {
      if (!confirm(`Supprimer cette règle globale (${describeGlobalRule(rule)}) ?`)) return;
      state.globalRules = state.globalRules.filter((r) => r.id !== rule.id);
      saveState();
      render();
    });
    actions.append(editBtn, delBtn);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

function renderGlobalRuleForm(container, existingRule) {
  const staffCheckboxesHtml = (people) => people.map((p) => `
    <label class="staff-modal-row global-rule-staff-row">
      <input type="checkbox" class="globalRuleStaff" value="${p.id}">
      <span>${p.prenom} ${p.nom}</span>
    </label>
  `).join("");
  const normalStaff = state.staff.filter((p) => !p.horsSisu);
  const seniors = normalStaff.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
  const internes = normalStaff.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);

  container.innerHTML = `
    <div class="staff-form rule-form">
      <h3>${existingRule ? "Modifier une règle globale" : "Ajouter une règle globale"}</h3>
      <div class="form-row">
        <label for="globalRuleType">Type</label>
        <select id="globalRuleType">
          <option value="ignoreSpecialite">${GLOBAL_RULE_TYPE_LABELS.ignoreSpecialite}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Modalité(s) concernée(s)</label>
        <div class="rule-checkbox-group">
          <label class="rule-checkbox-all"><input type="checkbox" id="globalRuleAllActivities"> <strong>Toutes les modalités</strong></label>
          ${state.activities.map((a) => `<label><input type="checkbox" class="globalRuleActivity" value="${a.id}"> ${a.nom}</label>`).join("")}
        </div>
      </div>
      <div class="form-row">
        <label>Statut(s) concerné(s)</label>
        <div class="rule-checkbox-group">
          <label class="rule-checkbox-all"><input type="checkbox" id="globalRuleAllStatuses"> <strong>Tous les statuts</strong></label>
          ${GLOBAL_RULE_STATUS_OPTIONS.map((o) => `<label><input type="checkbox" class="globalRuleStatus" value="${o.id}"> ${o.label}</label>`).join("")}
        </div>
      </div>
      <div class="form-row">
        <label>Personne(s) concernée(s)</label>
        <div class="global-rule-staff-picker">
          <div class="staff-modal-section">Séniors</div>
          ${staffCheckboxesHtml(seniors)}
          <div class="staff-modal-section">Internes</div>
          ${staffCheckboxesHtml(internes)}
        </div>
      </div>
      <div class="rule-preview" id="globalRulePreview"></div>
      <div class="form-actions">
        <button type="button" id="globalRuleFormSubmit">${existingRule ? "Enregistrer" : "Ajouter"}</button>
        <button type="button" id="globalRuleFormCancel">Annuler</button>
      </div>
      <div class="form-error" id="globalRuleFormError"></div>
    </div>
  `;

  const allActivitiesCheckbox = document.getElementById("globalRuleAllActivities");
  const allStatusesCheckbox = document.getElementById("globalRuleAllStatuses");
  const activityCheckboxes = [...container.querySelectorAll(".globalRuleActivity")];
  const statusCheckboxes = [...container.querySelectorAll(".globalRuleStatus")];
  const staffCheckboxes = [...container.querySelectorAll(".globalRuleStaff")];

  if (existingRule) {
    activityCheckboxes.forEach((cb) => { cb.checked = (existingRule.activityIds || []).includes(cb.value); });
    statusCheckboxes.forEach((cb) => { cb.checked = (existingRule.statuses || []).includes(cb.value); });
    staffCheckboxes.forEach((cb) => { cb.checked = (existingRule.staffIds || []).includes(cb.value); });
    allActivitiesCheckbox.checked = !!existingRule.allActivities;
    allStatusesCheckbox.checked = !!existingRule.allStatuses;
  }

  // "Toutes les modalités"/"Tous les statuts" (10/08/2026) : désactive (et décoche) les cases
  // individuelles de leur groupe pendant que la case globale est cochée -- évite de laisser croire
  // qu'une sélection individuelle compte encore une fois qu'elle est redondante. "Tous les statuts"
  // désactive aussi le sélecteur de personnes, déjà redondant (tout le monde est ciblé de toute
  // façon) -- pas de couplage symétrique côté "Toutes les modalités", qui n'a pas d'équivalent.
  const updateActivityCheckboxesDisabled = () => {
    activityCheckboxes.forEach((cb) => {
      cb.disabled = allActivitiesCheckbox.checked;
      if (allActivitiesCheckbox.checked) cb.checked = false;
    });
  };
  const updateStatusCheckboxesDisabled = () => {
    [...statusCheckboxes, ...staffCheckboxes].forEach((cb) => {
      cb.disabled = allStatusesCheckbox.checked;
      if (allStatusesCheckbox.checked) cb.checked = false;
    });
  };
  updateActivityCheckboxesDisabled();
  updateStatusCheckboxesDisabled();

  const updatePreview = () => {
    const preview = document.getElementById("globalRulePreview");
    const draft = {
      type: "ignoreSpecialite",
      allActivities: allActivitiesCheckbox.checked,
      activityIds: activityCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      allStatuses: allStatusesCheckbox.checked,
      statuses: statusCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      staffIds: staffCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
    };
    preview.textContent = `Aperçu : ${describeGlobalRule(draft)}.`;
  };
  allActivitiesCheckbox.addEventListener("change", () => { updateActivityCheckboxesDisabled(); updatePreview(); });
  allStatusesCheckbox.addEventListener("change", () => { updateStatusCheckboxesDisabled(); updatePreview(); });
  [...activityCheckboxes, ...statusCheckboxes, ...staffCheckboxes].forEach((cb) => cb.addEventListener("change", updatePreview));
  updatePreview();

  document.getElementById("globalRuleFormCancel").addEventListener("click", () => { container.innerHTML = ""; });

  document.getElementById("globalRuleFormSubmit").addEventListener("click", () => {
    const errorEl = document.getElementById("globalRuleFormError");
    errorEl.textContent = "";

    const allActivities = allActivitiesCheckbox.checked;
    const activityIds = allActivities ? [] : activityCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const allStatuses = allStatusesCheckbox.checked;
    const statuses = allStatuses ? [] : statusCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const staffIds = allStatuses ? [] : staffCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);

    if (!allActivities && activityIds.length === 0) { errorEl.textContent = "Choisis au moins une modalité, ou coche \"Toutes les modalités\"."; return; }
    if (!allStatuses && statuses.length === 0 && staffIds.length === 0) { errorEl.textContent = "Choisis au moins une personne ou un statut, ou coche \"Tous les statuts\"."; return; }

    const payload = { type: "ignoreSpecialite", allActivities, activityIds, allStatuses, statuses, staffIds };

    if (existingRule) {
      Object.assign(existingRule, payload);
    } else {
      state.globalRules.push({ id: generateGlobalRuleId(), ...payload });
    }
    saveState();
    container.innerHTML = "";
    render();
  });
}

// ---------- Règle de garde (10/08/2026) ----------
// Composition de la garde (RG-015), éditable depuis un unique bloc -- distinct de state.rules
// (liste, une entrée par modalité) ET de state.globalRules (liste, transverse à toutes les
// modalités) : la garde n'a ni modalité ni créneau ni jour variable, une SEULE composition suffit.
// Voir DEFAULT_GARDE_RULE (js/03-state.js) et validateGardes() (js/07-validation-rg.js).

function renderGardeRuleSection(container) {
  container.innerHTML = `
    <div class="rules-header">
      <h3>Règle de garde</h3>
    </div>
    <div id="gardeRuleFormContainer"></div>
    <div id="gardeRuleSummary" class="rules-list"></div>
  `;
  renderGardeRuleSummary(document.getElementById("gardeRuleSummary"));
}

function renderGardeRuleSummary(container) {
  container.innerHTML = "";
  const row = document.createElement("div");
  row.className = "rules-row";

  const desc = document.createElement("div");
  desc.className = "rules-row-desc";
  desc.textContent = `${describeRuleComposition(state.gardeRule)} attendu(s), chaque jour calendaire.`;
  row.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "rules-row-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "staff-modal-edit";
  editBtn.textContent = "Modifier";
  editBtn.addEventListener("click", () => renderGardeRuleForm(document.getElementById("gardeRuleFormContainer")));
  actions.appendChild(editBtn);
  row.appendChild(actions);

  container.appendChild(row);
}

// Mêmes champs de composition que renderRuleForm() (séniors min/max, internes réglementés ou non
// min/max, substitution, "encourager la cible") -- volontairement SANS modalité/créneau(x)/jours/
// spécialité, qui n'ont pas de sens pour la garde. Toujours en mode "modifier" (jamais "ajouter" --
// une seule règle de garde existe, jamais créée/supprimée) : la sauvegarde remplace directement
// `state.gardeRule`, aucun garde-fou anti-doublon nécessaire.
function renderGardeRuleForm(container) {
  const rule = state.gardeRule;
  container.innerHTML = `
    <div class="staff-form rule-form">
      <h3>Modifier la règle de garde</h3>
      <div class="form-row">
        <label for="gardeRuleSeniorMin">Séniors minimum</label>
        <input type="number" id="gardeRuleSeniorMin" min="0" value="${rule.seniorMin}">
      </div>
      <div class="form-row">
        <label for="gardeRuleSeniorMax">Séniors -- au-delà, signalé "en trop" (vide = même valeur que le minimum)</label>
        <input type="number" id="gardeRuleSeniorMax" min="0" value="${rule.seniorMax !== rule.seniorMin ? rule.seniorMax : ""}">
      </div>
      <div class="form-row form-row-checkbox">
        <label><input type="checkbox" id="gardeRuleInterneRegulated" ${rule.interneMin !== null ? "checked" : ""}> Réglementer les internes sur cette règle</label>
      </div>
      <div id="gardeRuleInterneFields">
        <div class="form-row">
          <label for="gardeRuleInterneMin">Internes minimum</label>
          <input type="number" id="gardeRuleInterneMin" min="0" value="${rule.interneMin !== null ? rule.interneMin : 0}">
        </div>
        <div class="form-row">
          <label for="gardeRuleInterneMax">Internes -- cible/max recommandé (vide = même valeur que le minimum)</label>
          <input type="number" id="gardeRuleInterneMax" min="0" value="${rule.interneMax !== null && rule.interneMax !== rule.interneMin ? rule.interneMax : ""}">
        </div>
        <div class="form-row form-row-checkbox">
          <label><input type="checkbox" id="gardeRuleEncourageGrowth" ${rule.encourageInterneGrowth ? "checked" : ""}> Encourager (sans l'exiger) à atteindre la cible</label>
        </div>
      </div>
      <div class="form-row form-row-checkbox">
        <label><input type="checkbox" id="gardeRuleSubstitution" ${rule.allowSubstitution !== false ? "checked" : ""}> Un sénior en trop peut couvrir un manque d'interne</label>
      </div>
      <div class="rule-preview" id="gardeRulePreview"></div>
      <div class="form-actions">
        <button type="button" id="gardeRuleFormSubmit">Enregistrer</button>
        <button type="button" id="gardeRuleFormCancel">Annuler</button>
      </div>
    </div>
  `;

  const seniorMinInput = document.getElementById("gardeRuleSeniorMin");
  const seniorMaxInput = document.getElementById("gardeRuleSeniorMax");
  const interneRegulatedCheckbox = document.getElementById("gardeRuleInterneRegulated");
  const interneMinInput = document.getElementById("gardeRuleInterneMin");
  const interneMaxInput = document.getElementById("gardeRuleInterneMax");
  const encourageGrowthCheckbox = document.getElementById("gardeRuleEncourageGrowth");
  const substitutionCheckbox = document.getElementById("gardeRuleSubstitution");

  const updateInterneFieldsVisibility = () => {
    document.getElementById("gardeRuleInterneFields").style.display = interneRegulatedCheckbox.checked ? "block" : "none";
  };
  const updatePreview = () => {
    const preview = document.getElementById("gardeRulePreview");
    const seniorMin = Math.max(0, parseInt(seniorMinInput.value, 10) || 0);
    const interneRegulated = interneRegulatedCheckbox.checked;
    const interneMin = interneRegulated ? Math.max(0, parseInt(interneMinInput.value, 10) || 0) : null;
    const composition = describeRuleComposition({ seniorMin, interneMin, interneMax: interneMin, mentionSeniorInText: true });
    preview.textContent = `Aperçu : ${composition} attendu(s), chaque jour calendaire.`;
  };

  interneRegulatedCheckbox.addEventListener("change", () => { updateInterneFieldsVisibility(); updatePreview(); });
  [seniorMinInput, seniorMaxInput, interneMinInput, interneMaxInput].forEach((el) => el.addEventListener("input", updatePreview));

  updateInterneFieldsVisibility();
  updatePreview();

  document.getElementById("gardeRuleFormCancel").addEventListener("click", () => { container.innerHTML = ""; });

  document.getElementById("gardeRuleFormSubmit").addEventListener("click", () => {
    const seniorMin = Math.max(0, parseInt(seniorMinInput.value, 10) || 0);
    const seniorMaxRaw = parseInt(seniorMaxInput.value, 10);
    const seniorMax = Number.isFinite(seniorMaxRaw) ? Math.max(seniorMin, seniorMaxRaw) : seniorMin;

    const interneRegulated = interneRegulatedCheckbox.checked;
    let interneMin = null;
    let interneMax = null;
    if (interneRegulated) {
      interneMin = Math.max(0, parseInt(interneMinInput.value, 10) || 0);
      const interneMaxRaw = parseInt(interneMaxInput.value, 10);
      interneMax = Number.isFinite(interneMaxRaw) ? Math.max(interneMin, interneMaxRaw) : interneMin;
    }

    state.gardeRule = {
      seniorMin, seniorMax, interneMin, interneMax,
      encourageInterneGrowth: encourageGrowthCheckbox.checked,
      allowSubstitution: substitutionCheckbox.checked,
    };
    saveState();
    container.innerHTML = "";
    render();
  });
}

// `prefillFrom` (09/08/2026, "Copier") : ignoré si `existingRule` est fourni (une modification a
// toujours la priorité) -- ne sert que pour l'ajout, pré-remplit les champs depuis une AUTRE règle
// sans jamais la modifier elle-même (la sauvegarde crée toujours une règle neuve dans ce cas,
// `existingRule` reste null jusqu'au bout).
function renderRuleForm(container, existingRule, prefillFrom) {
  const source = existingRule || prefillFrom || null;
  const activityOptions = state.activities.map((a) => `<option value="${a.id}">${a.nom}</option>`).join("");
  container.innerHTML = `
    <div class="staff-form rule-form">
      <h3>${existingRule ? "Modifier une règle" : prefillFrom ? "Copier une règle" : "Ajouter une règle"}</h3>
      <div class="form-row">
        <label for="ruleActivity">Modalité</label>
        <select id="ruleActivity">${activityOptions}</select>
      </div>
      <div class="form-row">
        <label>Créneau(x)</label>
        <div class="rule-checkbox-group">
          <label><input type="checkbox" class="ruleCreneau" value="matin"> Matin</label>
          <label id="ruleCreneauAstreinteLabel"><input type="checkbox" class="ruleCreneau" value="astreinte" id="ruleCreneauAstreinte"> Astreinte</label>
          <label><input type="checkbox" class="ruleCreneau" value="apres-midi"> Après-midi</label>
        </div>
      </div>
      <div class="form-row">
        <label>Jours <button type="button" id="ruleAllDays" class="rule-link-btn">(tous les jours)</button></label>
        <div class="rule-checkbox-group">
          ${DAYS.map((d) => `<label><input type="checkbox" class="ruleDay" value="${d}"> ${d}</label>`).join("")}
        </div>
      </div>
      <div class="form-row">
        <label for="ruleSeniorMin">Séniors minimum</label>
        <input type="number" id="ruleSeniorMin" min="0" value="0">
      </div>
      <div class="form-row">
        <label for="ruleSeniorMax">Séniors -- au-delà, signalé "en trop" (vide = même valeur que le minimum)</label>
        <input type="number" id="ruleSeniorMax" min="0">
      </div>
      <div class="form-row form-row-checkbox">
        <label><input type="checkbox" id="ruleInterneRegulated" checked> Réglementer les internes sur cette règle</label>
      </div>
      <div id="ruleInterneFields">
        <div class="form-row">
          <label for="ruleInterneMin">Internes minimum</label>
          <input type="number" id="ruleInterneMin" min="0" value="0">
        </div>
        <div class="form-row">
          <label for="ruleInterneMax">Internes -- cible/max recommandé (vide = même valeur que le minimum)</label>
          <input type="number" id="ruleInterneMax" min="0">
        </div>
        <div class="form-row form-row-checkbox">
          <label><input type="checkbox" id="ruleEncourageGrowth"> Encourager (sans l'exiger) à atteindre la cible</label>
        </div>
      </div>
      <div class="form-row form-row-checkbox">
        <label><input type="checkbox" id="ruleSubstitution" checked> Un sénior en trop peut couvrir un manque d'interne</label>
      </div>
      <div class="form-row form-row-checkbox">
        <label><input type="checkbox" id="ruleRequireSpecialite"> Respecter la spécialité de la vacation</label>
        <span class="form-hint">Chaque personne assignée devra avoir la spécialité propriétaire de la case parmi les siennes -- sans effet si la case n'a pas de spécialité renseignée.</span>
      </div>
      <div class="form-row" id="ruleAstreinteExclusivityRow">
        <label for="ruleAstreinteExclusivityMode">Éviter Scan U / Echo U le même jour</label>
        <select id="ruleAstreinteExclusivityMode">
          <option value="off">Désactivée</option>
          <option value="recommendation">Facultative (recommandation)</option>
          <option value="violation">Obligatoire (violation)</option>
        </select>
        <span class="form-hint">Signale (sans jamais bloquer) une personne postée en astreinte ET sur Scan U/Echo U le matin ou l'après-midi, ce même jour.</span>
      </div>
      <div class="rule-preview" id="rulePreview"></div>
      <div class="form-actions">
        <button type="button" id="ruleFormSubmit">${existingRule ? "Enregistrer" : "Ajouter"}</button>
        <button type="button" id="ruleFormCancel">Annuler</button>
      </div>
      <div class="form-error" id="ruleFormError"></div>
    </div>
  `;

  const activitySelect = document.getElementById("ruleActivity");
  const creneauCheckboxes = [...container.querySelectorAll(".ruleCreneau")];
  const dayCheckboxes = [...container.querySelectorAll(".ruleDay")];
  const seniorMinInput = document.getElementById("ruleSeniorMin");
  const seniorMaxInput = document.getElementById("ruleSeniorMax");
  const interneRegulatedCheckbox = document.getElementById("ruleInterneRegulated");
  const interneMinInput = document.getElementById("ruleInterneMin");
  const interneMaxInput = document.getElementById("ruleInterneMax");
  const encourageGrowthCheckbox = document.getElementById("ruleEncourageGrowth");
  const substitutionCheckbox = document.getElementById("ruleSubstitution");
  const requireSpecialiteCheckbox = document.getElementById("ruleRequireSpecialite");
  const astreinteExclusivitySelect = document.getElementById("ruleAstreinteExclusivityMode");

  if (source) {
    activitySelect.value = source.activityId;
    creneauCheckboxes.forEach((cb) => { cb.checked = source.creneaux.includes(cb.value); });
    dayCheckboxes.forEach((cb) => { cb.checked = source.days.includes(cb.value); });
    seniorMinInput.value = source.seniorMin;
    seniorMaxInput.value = source.seniorMax !== source.seniorMin ? source.seniorMax : "";
    const interneRegulated = source.interneMin !== null;
    interneRegulatedCheckbox.checked = interneRegulated;
    if (interneRegulated) {
      interneMinInput.value = source.interneMin;
      interneMaxInput.value = source.interneMax !== source.interneMin ? source.interneMax : "";
    }
    encourageGrowthCheckbox.checked = !!source.encourageInterneGrowth;
    substitutionCheckbox.checked = source.allowSubstitution !== false;
    requireSpecialiteCheckbox.checked = !!source.requireSpecialite;
    astreinteExclusivitySelect.value = source.astreinteExclusivityMode || "off";
  }

  // Astreinte : réservée à Scan U (RG-012/isCreneauApplicable) -- masquée pour toute autre modalité,
  // même patron que les popovers d'assignation existants.
  const updateAstreinteVisibility = () => {
    const isScanU = activitySelect.value === "scan-u";
    document.getElementById("ruleCreneauAstreinteLabel").style.display = isScanU ? "inline-flex" : "none";
    if (!isScanU) document.getElementById("ruleCreneauAstreinte").checked = false;
    updateAstreinteExclusivityVisibility();
  };
  // RG-027 (10/08/2026) : le réglage "Éviter Scan U/Echo U le même jour" n'a de sens QUE pour la
  // règle qui couvre le créneau astreinte lui-même -- masqué sinon (même logique que le créneau
  // Astreinte, réservée à Scan U). Revérifié à chaque changement de modalité (via updateAstreinteVisibility()
  // ci-dessus) ET à chaque coche/décoche du créneau Astreinte directement.
  const updateAstreinteExclusivityVisibility = () => {
    document.getElementById("ruleAstreinteExclusivityRow").style.display =
      document.getElementById("ruleCreneauAstreinte").checked ? "block" : "none";
  };
  document.getElementById("ruleCreneauAstreinte").addEventListener("change", updateAstreinteExclusivityVisibility);
  const updateInterneFieldsVisibility = () => {
    document.getElementById("ruleInterneFields").style.display = interneRegulatedCheckbox.checked ? "block" : "none";
  };
  const updatePreview = () => {
    const preview = document.getElementById("rulePreview");
    const days = dayCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const creneaux = creneauCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const daysText = days.length === DAYS.length ? "tous les jours" : days.join(", ") || "aucun jour sélectionné";
    const creneauxText = creneaux.map(creneauLabel).join(" + ") || "aucun créneau sélectionné";
    const seniorMin = Math.max(0, parseInt(seniorMinInput.value, 10) || 0);
    const interneRegulated = interneRegulatedCheckbox.checked;
    const interneMin = interneRegulated ? Math.max(0, parseInt(interneMinInput.value, 10) || 0) : null;
    const composition = describeRuleComposition({ seniorMin, interneMin, interneMax: interneMin, mentionSeniorInText: true });
    preview.textContent = `Aperçu : ${creneauxText}, ${daysText} — ${composition} attendu(s).`;
  };

  activitySelect.addEventListener("change", () => { updateAstreinteVisibility(); updatePreview(); });
  interneRegulatedCheckbox.addEventListener("change", () => { updateInterneFieldsVisibility(); updatePreview(); });
  [...creneauCheckboxes, ...dayCheckboxes, seniorMinInput, seniorMaxInput, interneMinInput, interneMaxInput].forEach((el) => {
    el.addEventListener("input", updatePreview);
    el.addEventListener("change", updatePreview);
  });
  document.getElementById("ruleAllDays").addEventListener("click", () => {
    dayCheckboxes.forEach((cb) => { cb.checked = true; });
    updatePreview();
  });

  updateAstreinteVisibility();
  updateInterneFieldsVisibility();
  updatePreview();

  document.getElementById("ruleFormCancel").addEventListener("click", () => { container.innerHTML = ""; });

  document.getElementById("ruleFormSubmit").addEventListener("click", () => {
    const errorEl = document.getElementById("ruleFormError");
    errorEl.textContent = "";

    const activityId = activitySelect.value;
    const activity = state.activities.find((a) => a.id === activityId);
    const creneaux = creneauCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const days = dayCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    if (creneaux.length === 0) { errorEl.textContent = "Choisis au moins un créneau."; return; }
    if (days.length === 0) { errorEl.textContent = "Choisis au moins un jour."; return; }

    const seniorMin = Math.max(0, parseInt(seniorMinInput.value, 10) || 0);
    const seniorMaxRaw = parseInt(seniorMaxInput.value, 10);
    const seniorMax = Number.isFinite(seniorMaxRaw) ? Math.max(seniorMin, seniorMaxRaw) : seniorMin;

    const interneRegulated = interneRegulatedCheckbox.checked;
    let interneMin = null;
    let interneMax = null;
    if (interneRegulated) {
      interneMin = Math.max(0, parseInt(interneMinInput.value, 10) || 0);
      const interneMaxRaw = parseInt(interneMaxInput.value, 10);
      interneMax = Number.isFinite(interneMaxRaw) ? Math.max(interneMin, interneMaxRaw) : interneMin;
    }

    // Garde-fou anti-doublon (moteur-regles-brouillon.md §5) : même modalité + mêmes créneaux + mêmes
    // jours qu'une autre règle déjà existante -- comparaison en ensembles, pas en ordre.
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const duplicate = state.rules.find((r) =>
      r.id !== (existingRule && existingRule.id) &&
      r.activityId === activityId && sameSet(r.creneaux, creneaux) && sameSet(r.days, days)
    );
    if (duplicate) {
      errorEl.textContent = `Une règle existe déjà pour ${activity.nom} sur ce même périmètre (${duplicate.rg}) -- modifie-la plutôt que d'en créer une seconde.`;
      return;
    }

    const payload = {
      activityId, creneaux, days, seniorMin, seniorMax, interneMin, interneMax,
      encourageInterneGrowth: encourageGrowthCheckbox.checked,
      allowSubstitution: substitutionCheckbox.checked,
      requireSpecialite: requireSpecialiteCheckbox.checked,
      astreinteExclusivityMode: astreinteExclusivitySelect.value,
    };

    if (existingRule) {
      // Object.assign sur l'existant (pas un nouvel objet) : préserve les champs internes non
      // exposés dans ce formulaire (mentionSeniorInText/seniorExcessMessage/
      // socleReinforcementIfSingleInterne -- seule RG-012 en a aujourd'hui) plutôt que de les perdre
      // silencieusement en modifiant cette règle depuis l'écran.
      Object.assign(existingRule, payload);
    } else {
      state.rules.push({ id: generateRuleId(), rg: activity.nom, labelPrefix: activity.nom, ...payload });
    }
    saveState();
    container.innerHTML = "";
    render();
  });
}
