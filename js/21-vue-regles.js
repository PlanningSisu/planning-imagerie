// ---------- Vue Règles (moteur de règles paramétrable, 09/08/2026) ----------
// Écran de paramétrage des règles de composition (state.rules) -- remplace l'ancien codage en dur de
// RG-002/003/007/009/012. Même mise en page que Gestion Personnel (liste groupée + formulaire inline
// d'ajout/modification), plein écran comme Trame/Congés/Stats. Voir moteur-regles-brouillon.md pour
// la conception complète et js/07-validation-rg.js pour l'interpréteur (validateCompositionRules()).

function generateRuleId() {
  return "rule" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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
    <div class="rules-header">
      <h2>Règles de composition</h2>
      <button type="button" id="btnAddRule" class="btn-primary">+ Ajouter une règle</button>
    </div>
    <div id="ruleFormContainer"></div>
    <div id="rulesList" class="rules-list"></div>
  `;
  document.getElementById("btnAddRule").addEventListener("click", () => {
    document.getElementById("btnAddRule").blur();
    renderRuleForm(document.getElementById("ruleFormContainer"), null);
  });
  renderRulesList(document.getElementById("rulesList"));
}

function renderRulesList(container) {
  container.innerHTML = "";
  let anyRule = false;

  state.activities.forEach((activity) => {
    const rulesForActivity = state.rules.filter((r) => r.activityId === activity.id);
    if (rulesForActivity.length === 0) return;
    anyRule = true;

    const section = document.createElement("div");
    section.className = "rules-activity-group";
    const h3 = document.createElement("h3");
    h3.textContent = activity.nom;
    section.appendChild(h3);

    rulesForActivity.forEach((rule) => {
      const daysText = rule.days.length === DAYS.length ? "Tous les jours" : rule.days.join(", ");
      const creneauxText = rule.creneaux.map(creneauLabel).join(" + ");

      const row = document.createElement("div");
      row.className = "rules-row";

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
      actions.append(editBtn, delBtn);
      row.appendChild(actions);

      section.appendChild(row);
    });

    container.appendChild(section);
  });

  if (!anyRule) {
    container.innerHTML = '<div class="staff-modal-empty">Aucune règle définie -- aucune composition n\'est vérifiée tant qu\'aucune règle n\'existe pour une modalité.</div>';
  }
}

function renderRuleForm(container, existingRule) {
  const activityOptions = state.activities.map((a) => `<option value="${a.id}">${a.nom}</option>`).join("");
  container.innerHTML = `
    <div class="staff-form rule-form">
      <h3>${existingRule ? "Modifier une règle" : "Ajouter une règle"}</h3>
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

  if (existingRule) {
    activitySelect.value = existingRule.activityId;
    creneauCheckboxes.forEach((cb) => { cb.checked = existingRule.creneaux.includes(cb.value); });
    dayCheckboxes.forEach((cb) => { cb.checked = existingRule.days.includes(cb.value); });
    seniorMinInput.value = existingRule.seniorMin;
    seniorMaxInput.value = existingRule.seniorMax !== existingRule.seniorMin ? existingRule.seniorMax : "";
    const interneRegulated = existingRule.interneMin !== null;
    interneRegulatedCheckbox.checked = interneRegulated;
    if (interneRegulated) {
      interneMinInput.value = existingRule.interneMin;
      interneMaxInput.value = existingRule.interneMax !== existingRule.interneMin ? existingRule.interneMax : "";
    }
    encourageGrowthCheckbox.checked = !!existingRule.encourageInterneGrowth;
    substitutionCheckbox.checked = existingRule.allowSubstitution !== false;
    requireSpecialiteCheckbox.checked = !!existingRule.requireSpecialite;
  }

  // Astreinte : réservée à Scan U (RG-012/isCreneauApplicable) -- masquée pour toute autre modalité,
  // même patron que les popovers d'assignation existants.
  const updateAstreinteVisibility = () => {
    const isScanU = activitySelect.value === "scan-u";
    document.getElementById("ruleCreneauAstreinteLabel").style.display = isScanU ? "inline-flex" : "none";
    if (!isScanU) document.getElementById("ruleCreneauAstreinte").checked = false;
  };
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
