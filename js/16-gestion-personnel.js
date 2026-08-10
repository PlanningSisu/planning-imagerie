// ---------- Gestion Personnel ----------

function generateStaffId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function specialiteOptionsHtml() {
  return Object.entries(SPECIALITES)
    .map(([key, spec]) => `<option value="${key}">${spec.label}</option>`)
    .join("");
}

function openStaffModal() {
  staffModalSearchQuery = "";
  document.getElementById("staffModal").classList.remove("hidden");
  renderStaffModal();
}

function closeStaffModal() {
  document.getElementById("staffModal").classList.add("hidden");
}

function renderStaffModal() {
  const body = document.getElementById("staffModalBody");
  body.innerHTML = `
    <div class="staff-modal-actions">
      <button type="button" id="btnOpenStaffForm" class="btn-primary">+ Ajouter un membre</button>
      <button type="button" id="btnOpenBulkImport" class="btn-primary btn-outline">Importer en masse</button>
    </div>
    <input type="text" id="staffSearchInput" class="staff-search-input" placeholder="Rechercher un nom ou prénom...">
    <div id="staffFormContainer"></div>
    <div id="bulkImportContainer"></div>
    <div id="staffModalList"></div>
  `;
  document.getElementById("btnOpenStaffForm").addEventListener("click", () => {
    document.getElementById("bulkImportContainer").innerHTML = "";
    renderStaffAddForm(document.getElementById("staffFormContainer"));
  });
  document.getElementById("btnOpenBulkImport").addEventListener("click", () => {
    document.getElementById("staffFormContainer").innerHTML = "";
    renderBulkImportForm(document.getElementById("bulkImportContainer"));
  });
  const searchInput = document.getElementById("staffSearchInput");
  searchInput.value = staffModalSearchQuery;
  searchInput.addEventListener("input", () => {
    staffModalSearchQuery = searchInput.value;
    renderStaffModalList(document.getElementById("staffModalList"));
  });
  renderStaffModalList(document.getElementById("staffModalList"));
}

// Insensible aux accents/casse (normalizeToken(), déjà utilisée pour l'import ARI/en masse) --
// cherche le texte tapé comme sous-chaîne dans "prénom nom", donc "dubois" ou "maeva" (sans tréma)
// matchent aussi bien que "Dubois"/"Maëva".
function personMatchesSearch(person, query) {
  if (!query.trim()) return true;
  const haystack = normalizeToken(`${person.prenom} ${person.nom}`);
  return haystack.includes(normalizeToken(query));
}

function renderStaffModalList(container) {
  container.innerHTML = "";
  const searched = state.staff.filter((p) => personMatchesSearch(p, staffModalSearchQuery));
  const normal = searched.filter((p) => !p.horsSisu);
  const seniors = normal.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
  const internes = normal.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);
  // RG-016 (23/07/2026) : à part, jamais mélangées aux séniors/internes -- pas forcément de grade,
  // triées alphabétiquement (voir regles-gestion.md).
  const horsSisu = searched.filter((p) => p.horsSisu).sort(compareNomPrenom);

  const addSection = (label, people) => {
    if (people.length === 0) return;
    const h = document.createElement("div");
    h.className = "staff-modal-section";
    h.textContent = `${label} (${people.length})`;
    container.appendChild(h);

    people.forEach((person) => {
      const row = document.createElement("div");
      row.className = "staff-modal-row";

      const chip = document.createElement("span");
      applyChipVisual(chip, person);
      chip.textContent = `${person.prenom} ${person.nom}`;
      row.appendChild(chip);

      const specs = orderedSpecialites(person);
      const specLabel = specs.length
        ? specs.map((s) => SPECIALITES[s].label).join(" + ")
        : person.horsSisu ? "" : person.grade === "senior" ? "" : "Socle";
      const specSpan = document.createElement("span");
      specSpan.className = "staff-modal-spec";
      specSpan.textContent = specLabel;
      row.appendChild(specSpan);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "staff-modal-edit";
      editBtn.textContent = "Modifier";
      editBtn.addEventListener("click", () => {
        document.getElementById("bulkImportContainer").innerHTML = "";
        const formContainer = document.getElementById("staffFormContainer");
        renderStaffAddForm(formContainer, person);
        formContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      row.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "staff-modal-delete";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => deleteStaffMember(person.id));
      row.appendChild(delBtn);

      container.appendChild(row);
    });
  };

  addSection("Séniors", seniors);
  addSection("Internes", internes);
  addSection("Hors Sisu", horsSisu);

  if (state.staff.length === 0) {
    const empty = document.createElement("div");
    empty.className = "staff-modal-empty";
    empty.textContent = "Aucun membre pour l'instant.";
    container.appendChild(empty);
  } else if (searched.length === 0) {
    const empty = document.createElement("div");
    empty.className = "staff-modal-empty";
    empty.textContent = "Aucun membre ne correspond à cette recherche.";
    container.appendChild(empty);
  }
}

function deleteStaffMember(personId) {
  const person = staffById(personId);
  if (!person) return;
  if (!confirm(`Retirer ${person.prenom} ${person.nom} du personnel ? Ses éventuelles assignations existantes seront simplement masquées, pas supprimées.`)) return;
  state.staff = state.staff.filter((p) => p.id !== personId);
  saveState();
  render();
  renderStaffModalList(document.getElementById("staffModalList"));
}

// Comme specialiteOptionsHtml(), avec une option vide en tête -- réservé au formulaire Hors Sisu
// (23/07/2026, RG-016), où une spécialité n'est jamais obligatoire. Fonction à part plutôt que de
// modifier specialiteOptionsHtml() elle-même, qui reste utilisée ici pour le cas normal (senior/
// interne) où le premier vrai choix doit rester présélectionné par défaut.
function specialiteOptionsHtmlWithNone() {
  return `<option value="">Aucune</option>${specialiteOptionsHtml()}`;
}

// existingPerson non fourni -> mode "ajouter". Fourni -> mode "modifier" (formulaire pré-rempli,
// mise à jour en place au lieu d'un push).
function renderStaffAddForm(container, existingPerson = null) {
  const specs = existingPerson ? orderedSpecialites(existingPerson) : [];
  const initialHorsSisu = existingPerson ? !!existingPerson.horsSisu : false;
  const initialGrade = existingPerson ? existingPerson.grade || "" : "senior";
  const initialType = specs.length === 2 ? "specialise" : specs.length === 1 ? "mono" : "socle";

  container.innerHTML = `
    <div class="staff-form">
      <h3>${existingPerson ? "Modifier un membre" : "Ajouter un membre"}</h3>
      <div class="form-row">
        <label for="formPrenom">Prénom</label>
        <input type="text" id="formPrenom" autocomplete="off">
      </div>
      <div class="form-row">
        <label for="formNom">Nom</label>
        <input type="text" id="formNom" autocomplete="off">
      </div>
      <div class="form-row form-row-checkbox">
        <label for="formHorsSisu"><input type="checkbox" id="formHorsSisu"> Hors Sisu</label>
        <span class="form-hint">Personne à suivre (congés, gardes...) mais jamais postée sur une vacation -- grade et spécialité(s) deviennent optionnels.</span>
      </div>
      <div class="form-row" id="formGradeRow">
        <label for="formGrade">Grade</label>
        <select id="formGrade">
          <option value="">Non renseigné</option>
          <option value="senior">Sénior</option>
          <option value="interne">Interne</option>
        </select>
      </div>
      <div class="form-row form-row-checkbox" id="formCCARow">
        <label for="formCCA"><input type="checkbox" id="formCCA"> CCA</label>
        <span class="form-hint">Un type de sénior -- filtrable à part dans le panneau Personnel.</span>
      </div>
      <div class="form-row form-row-checkbox">
        <label for="formTempsPlein"><input type="checkbox" id="formTempsPlein"> Temps Plein</label>
        <span class="form-hint">Sénior ou interne -- filtrable à part ("TP") dans le panneau Personnel.</span>
      </div>
      <div class="form-row" id="formInterneTypeRow">
        <label for="formInterneType">Statut</label>
        <select id="formInterneType">
          <option value="socle">Socle (pas encore de spécialité)</option>
          <option value="mono">Mono-spécialisé (1 spécialité)</option>
          <option value="specialise">Spécialisé (2 spécialités)</option>
        </select>
      </div>
      <div class="form-row" id="formSpec1Row">
        <label id="formSpec1Label" for="formSpec1">Spécialité</label>
        <select id="formSpec1">${specialiteOptionsHtml()}</select>
      </div>
      <div class="form-row" id="formSpec2Row">
        <label id="formSpec2Label" for="formSpec2">2e spécialité</label>
        <select id="formSpec2">${specialiteOptionsHtml()}</select>
      </div>
      <div class="form-row form-row-competences">
        <label>Compétences</label>
        <div class="form-competences-list">
          ${COMPETENCE_ORDER.map((k) => `<label class="form-competence-option"><input type="checkbox" class="formCompetence" value="${k}"> ${competenceLabel(k)}</label>`).join("")}
        </div>
        <span class="form-hint">Indépendant de la spécialité ci-dessus -- une compétence compte aussi comme la spécialité correspondante pour le moteur de règles (RG-001), en plus de la spécialité "officielle" -- affiché seulement au survol (jamais de couleur).</span>
      </div>
      <div class="form-actions">
        <button type="button" id="formSubmit">${existingPerson ? "Enregistrer" : "Ajouter"}</button>
        <button type="button" id="formCancel">Annuler</button>
      </div>
      <div class="form-error" id="formError"></div>
    </div>
  `;

  const horsSisuCheckbox = document.getElementById("formHorsSisu");
  const gradeSelect = document.getElementById("formGrade");
  const ccaCheckbox = document.getElementById("formCCA");
  const tempsPleinCheckbox = document.getElementById("formTempsPlein");
  const typeSelect = document.getElementById("formInterneType");
  const spec1Select = document.getElementById("formSpec1");
  const spec2Select = document.getElementById("formSpec2");

  horsSisuCheckbox.checked = initialHorsSisu;
  ccaCheckbox.checked = existingPerson ? !!existingPerson.cca : false;
  tempsPleinCheckbox.checked = existingPerson ? !!existingPerson.tempsPlein : false;

  const competenceCheckboxes = [...container.querySelectorAll(".formCompetence")];
  if (existingPerson) {
    const initialCompetences = new Set(existingPerson.competences || []);
    competenceCheckboxes.forEach((cb) => { cb.checked = initialCompetences.has(cb.value); });
  }

  if (existingPerson) {
    document.getElementById("formPrenom").value = existingPerson.prenom;
    document.getElementById("formNom").value = existingPerson.nom;
    gradeSelect.value = initialGrade;
    typeSelect.value = initialType;
    if (initialHorsSisu) {
      // Formulaire Hors Sisu : les 2 selects deviennent "Aucune"/spécialité 1/spécialité 2 sans
      // contrainte -- reconstruits avec l'option vide avant d'y remettre les valeurs existantes.
      spec1Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec2Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec1Select.value = specs[0] || "";
      spec2Select.value = specs[1] || "";
    } else {
      if (specs[0]) spec1Select.value = specs[0];
      spec2Select.value = specs[1] || (specs[0] === "uro" ? "digestif" : "uro");
    }
  } else {
    gradeSelect.value = "senior";
    spec2Select.selectedIndex = 1; // évite spé1 = spé2 par défaut
  }

  const updateVisibility = () => {
    const horsSisu = horsSisuCheckbox.checked;
    document.getElementById("formGradeRow").style.display = "flex"; // toujours visible (juste plus obligatoire si Hors Sisu)

    // CCA n'a de sens que pour un sénior (grade === "senior") -- masqué et décoché sinon, pour ne
    // jamais enregistrer un CCA fantôme sur un interne ou une personne sans grade renseigné.
    const isSenior = gradeSelect.value === "senior";
    document.getElementById("formCCARow").style.display = isSenior ? "flex" : "none";
    if (!isSenior) ccaCheckbox.checked = false;

    if (horsSisu) {
      // Pas de notion de "socle"/"spécialisé" pour Hors Sisu -- les 2 spécialités sont montrées
      // directement, chacune optionnelle (option "Aucune" en tête, voir specialiteOptionsHtmlWithNone()).
      document.getElementById("formInterneTypeRow").style.display = "none";
      document.getElementById("formSpec1Row").style.display = "flex";
      document.getElementById("formSpec2Row").style.display = "flex";
      document.getElementById("formSpec1Label").textContent = "Spécialité (optionnel)";
      document.getElementById("formSpec2Label").textContent = "2e spécialité (optionnel)";
      return;
    }

    const isInterne = gradeSelect.value === "interne";
    document.getElementById("formInterneTypeRow").style.display = isInterne ? "flex" : "none";
    // Interne "socle" (0 spé) -> aucun select visible. "mono" (1 spé, 09/08/2026) -> spec1 seul.
    // "specialise" (2 spé) -> les deux. Sénior/hors grade -> toujours spec1 seul (déjà géré au-dessus).
    const hasAnySpec = !isInterne || typeSelect.value !== "socle";
    document.getElementById("formSpec1Row").style.display = hasAnySpec ? "flex" : "none";
    document.getElementById("formSpec2Row").style.display = (isInterne && typeSelect.value === "specialise") ? "flex" : "none";
    document.getElementById("formSpec1Label").textContent = isInterne ? "1ère spécialité" : "Spécialité";
    document.getElementById("formSpec2Label").textContent = "2e spécialité";
  };
  gradeSelect.addEventListener("change", updateVisibility);
  typeSelect.addEventListener("change", updateVisibility);
  horsSisuCheckbox.addEventListener("change", () => {
    // Bascule vers les selects "avec option vide" (ou l'inverse) -- reconstruit les <option> plutôt
    // que de juste changer la visibilité, pour que "Aucune" existe seulement quand pertinent.
    if (horsSisuCheckbox.checked) {
      spec1Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec2Select.innerHTML = specialiteOptionsHtmlWithNone();
      spec1Select.value = "";
      spec2Select.value = "";
      gradeSelect.value = "";
    } else {
      spec1Select.innerHTML = specialiteOptionsHtml();
      spec2Select.innerHTML = specialiteOptionsHtml();
      spec2Select.selectedIndex = 1;
      gradeSelect.value = "senior";
    }
    updateVisibility();
  });
  updateVisibility();

  document.getElementById("formCancel").addEventListener("click", () => {
    container.innerHTML = "";
  });

  document.getElementById("formSubmit").addEventListener("click", () => {
    const prenom = document.getElementById("formPrenom").value.trim();
    const nom = document.getElementById("formNom").value.trim();
    const horsSisu = horsSisuCheckbox.checked;
    const errorEl = document.getElementById("formError");
    errorEl.textContent = "";

    if (!prenom || !nom) {
      errorEl.textContent = "Le prénom et le nom sont obligatoires.";
      return;
    }

    let grade;
    let specialites = [];

    if (horsSisu) {
      // RG-016 : tout devient optionnel -- grade libre (y compris non renseigné), 0 à 2 spécialités
      // sans contrainte de correspondance avec le grade.
      grade = gradeSelect.value || null;
      const s1 = spec1Select.value || null;
      const s2 = spec2Select.value || null;
      if (s1 && s2 && s1 === s2) {
        errorEl.textContent = "Les deux spécialités doivent être différentes.";
        return;
      }
      specialites = [s1, s2].filter(Boolean);
    } else {
      grade = gradeSelect.value;
      if (!grade) {
        errorEl.textContent = "Le grade est obligatoire (sauf pour une personne \"Hors Sisu\").";
        return;
      }
      const isInterne = grade === "interne";
      if (!isInterne) {
        specialites = [spec1Select.value];
      } else if (typeSelect.value === "specialise") {
        const s1 = spec1Select.value;
        const s2 = spec2Select.value;
        if (s1 === s2) {
          errorEl.textContent = "Les deux spécialités doivent être différentes.";
          return;
        }
        specialites = [s1, s2];
      } else if (typeSelect.value === "mono") {
        specialites = [spec1Select.value];
      }
    }

    // Compétences : indépendantes du grade/de la spécialité, aucune contrainte de nombre.
    const competences = competenceCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    // CCA : un type de sénior -- jamais vrai si le grade final n'est pas "senior" (la case est de
    // toute façon masquée/décochée par updateVisibility() dans ce cas, ce garde-fou est redondant
    // mais évite tout risque si le DOM était dans un état inattendu).
    const cca = grade === "senior" && ccaCheckbox.checked;
    const tempsPlein = tempsPleinCheckbox.checked; // 05/08/2026 -- sénior ou interne, pas restreint comme CCA

    if (existingPerson) {
      existingPerson.prenom = prenom;
      existingPerson.nom = nom;
      existingPerson.horsSisu = horsSisu;
      existingPerson.grade = grade;
      existingPerson.specialites = specialites;
      existingPerson.competences = competences;
      existingPerson.cca = cca;
      existingPerson.tempsPlein = tempsPlein;
    } else {
      state.staff.push({ id: generateStaffId(), prenom, nom, horsSisu, grade, specialites, competences, cca, tempsPlein });
    }
    saveState();
    render();
    renderStaffModalList(document.getElementById("staffModalList"));
    container.innerHTML = "";
  });
}

function renderBulkImportForm(container) {
  container.innerHTML = `
    <div class="staff-form">
      <h3>Import en masse</h3>
      <p class="bulk-hint">Colle un texte structuré : un en-tête de grade ("Seniors" / "Internes"), puis des en-têtes de spécialité ("Dig", "Uro"...), puis une personne par ligne. Le reste (statut, remarques entre parenthèses...) est ignoré automatiquement.</p>
      <textarea id="bulkText" rows="10" placeholder="Seniors&#10;&#10;Dig&#10;Prénom Nom (...)"></textarea>
      <div class="form-actions">
        <button type="button" id="bulkAnalyze">Analyser</button>
        <button type="button" id="bulkCancel">Annuler</button>
      </div>
      <div id="bulkPreview"></div>
    </div>
  `;

  document.getElementById("bulkCancel").addEventListener("click", () => {
    container.innerHTML = "";
  });
  document.getElementById("bulkAnalyze").addEventListener("click", () => {
    const parseResult = parseBulkStaffText(document.getElementById("bulkText").value);
    renderBulkPreview(document.getElementById("bulkPreview"), parseResult);
  });
}

function renderBulkPreview(container, parseResult) {
  const { results, ignored } = parseResult;
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML = '<p class="bulk-hint">Aucune personne détectée dans ce texte.</p>';
    return;
  }

  const list = document.createElement("div");
  list.className = "bulk-preview-list";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn-primary";

  const updateConfirmLabel = () => {
    const n = results.filter((r) => r.include).length;
    confirmBtn.textContent = `Confirmer l'import (${n})`;
    confirmBtn.disabled = n === 0;
  };

  results.forEach((r) => {
    const row = document.createElement("label");
    row.className = "bulk-preview-row" + (r.duplicate ? " bulk-preview-duplicate" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = r.include;
    cb.addEventListener("change", () => {
      r.include = cb.checked;
      updateConfirmLabel();
    });
    row.appendChild(cb);

    const chip = document.createElement("span");
    applyChipVisual(chip, { grade: r.grade, specialites: r.specialites });
    chip.textContent = `${r.prenom} ${r.nom}`;
    row.appendChild(chip);

    // RG-016 : un grade absent (personne Hors Sisu sans grade renseigné) n'est ni "Sénior" ni
    // "Interne" -- éviter de retomber sur "Interne" par défaut (trompeur, voir même piège déjà
    // corrigé dans renderStaffPerson()).
    const gradeLabel = r.grade === "senior" ? "Sénior" : r.grade === "interne" ? "Interne" : "Hors Sisu";
    const specLabel = r.specialites.length
      ? r.specialites.map((s) => SPECIALITES[s].label).join(" + ")
      : r.grade === "interne"
      ? "Socle"
      : r.grade === "senior"
      ? "spécialité non détectée"
      : "";
    const horsSisuSuffix = r.horsSisu && r.grade ? " · Hors Sisu" : ""; // grade absent -> déjà dit par gradeLabel, pas de doublon
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = `${gradeLabel}${specLabel ? " — " + specLabel : ""}${horsSisuSuffix}${r.duplicate ? " · déjà existant" : ""}`;
    row.appendChild(info);

    list.appendChild(row);
  });

  container.appendChild(list);

  if (ignored.length > 0) {
    const details = document.createElement("details");
    details.className = "bulk-ignored";
    const summary = document.createElement("summary");
    summary.textContent = `${plural(ignored.length, "ligne")} non reconnue${ignored.length > 1 ? "s" : ""}`;
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = ignored.join("\n");
    details.appendChild(pre);
    container.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    results
      .filter((r) => r.include)
      .forEach((r) => {
        state.staff.push({ id: generateStaffId(), prenom: r.prenom, nom: r.nom, grade: r.grade, specialites: r.specialites, horsSisu: !!r.horsSisu });
      });
    saveState();
    render();
    renderStaffModalList(document.getElementById("staffModalList"));
    document.getElementById("bulkImportContainer").innerHTML = "";
  });
  container.appendChild(confirmBtn);
}

document.getElementById("btnManageStaff").addEventListener("click", openStaffModal);
document.getElementById("staffModalClose").addEventListener("click", closeStaffModal);
document.getElementById("staffModal").addEventListener("click", (e) => {
  if (e.target.id === "staffModal") closeStaffModal();
});

// Les trois modes plein-écran (Trame / Congés / Stats) remplacent tous le contenu principal (voir
// render()) : mutuellement exclusifs, activer l'un désactive les deux autres.
// resetFullScreenModeButtons() factorise la remise à zéro du texte/état des boutons non concernés
// (ajouté le 24/07/2026 avec Stats -- avant, dupliqué à la main dans chaque handler pour 2 boutons).
function resetFullScreenModeButtons(exceptId) {
  [
    { id: "btnTrame", label: "Trame" },
    { id: "btnConges", label: "Congés" },
    { id: "btnStats", label: "Stats" },
    { id: "btnRules", label: "Règles" },
  ].forEach(({ id, label }) => {
    if (id === exceptId) return;
    const btn = document.getElementById(id);
    btn.textContent = label;
    btn.classList.remove("btn-active");
  });
}

// RG-017 (24/07/2026) : "Trame" remplace l'ancien bouton isolé "Spécialités Vacations", déplacé à
// côté d'"Aujourd'hui" -- regroupe désormais 2 sous-vues (voir trameView, sous-onglets #trameSubNav
// dans index.html). Chaque OUVERTURE du mode retombe sur "Trame Personnel" par défaut (demande de
// Samir le 24/07/2026) -- pas de mémorisation du dernier onglet utilisé, contrairement au 1er jet.
document.getElementById("btnTrame").addEventListener("click", () => {
  editingTrame = !editingTrame;
  if (editingTrame) { editingConges = false; editingStats = false; editingRules = false; trameView = "personnel"; }
  const btn = document.getElementById("btnTrame");
  btn.textContent = editingTrame ? "← Retour au planning" : "Trame";
  btn.classList.toggle("btn-active", editingTrame);
  resetFullScreenModeButtons("btnTrame");
  render();
});

document.querySelectorAll(".trame-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    trameView = tabBtn.dataset.trameView;
    render();
  });
});

document.getElementById("btnConges").addEventListener("click", () => {
  editingConges = !editingConges;
  if (editingConges) { editingTrame = false; editingStats = false; editingRules = false; }
  const btn = document.getElementById("btnConges");
  btn.textContent = editingConges ? "← Retour au planning" : "Congés";
  btn.classList.toggle("btn-active", editingConges);
  resetFullScreenModeButtons("btnConges");
  render();
});

document.getElementById("btnStats").addEventListener("click", () => {
  editingStats = !editingStats;
  if (editingStats) { editingTrame = false; editingConges = false; editingRules = false; }
  const btn = document.getElementById("btnStats");
  btn.textContent = editingStats ? "← Retour au planning" : "Stats";
  btn.classList.toggle("btn-active", editingStats);
  resetFullScreenModeButtons("btnStats");
  render();
});

// Moteur de règles paramétrable (09/08/2026) : 4e mode plein-écran, même patron que Trame/Congés/Stats.
document.getElementById("btnRules").addEventListener("click", () => {
  editingRules = !editingRules;
  if (editingRules) { editingTrame = false; editingConges = false; editingStats = false; }
  const btn = document.getElementById("btnRules");
  btn.textContent = editingRules ? "← Retour au planning" : "Règles";
  btn.classList.toggle("btn-active", editingRules);
  resetFullScreenModeButtons("btnRules");
  render();
});

