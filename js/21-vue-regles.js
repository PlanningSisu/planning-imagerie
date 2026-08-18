// ---------- Vue Règles (moteur de règles paramétrable, 09/08/2026) ----------
// Écran de paramétrage des règles de composition (state.rules) -- remplace l'ancien codage en dur de
// RG-002/003/007/009/012. Même mise en page que Gestion Personnel (liste groupée + formulaire inline
// d'ajout/modification), plein écran comme Trame/Congés/Stats. Voir moteur-regles-brouillon.md pour
// la conception complète et js/07-validation-rg.js pour l'interpréteur (validateCompositionRules()).

function generateRuleId() {
  return "rule" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Segment (18/08/2026, RG-036) : jeu jour(s)/créneau(x)/composition à l'intérieur d'une règle (une
// règle = une modalité, plusieurs segments possibles) -- id distinct de generateRuleId() (qui
// identifie la règle/modalité elle-même), même format sinon.
function generateSegmentId() {
  return "seg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// "Toutes les vraies vacations" (RG-038, 18/08/2026, demande de Samir : "un bloc qui s'applique à
// toutes les vraies vacations... je peux lui rajouter des segments comme d'hab") -- PAS une entrée de
// state.activities (ALL_REAL_VACATIONS_ID, js/02-bulk-import-parsing.js), donc une pseudo-activité
// locale {id, nom} pour que ce bloc se rende, s'édite et se réordonne EXACTEMENT comme un bloc de
// modalité réelle, sans dupliquer renderRulesList()/renderRuleForm(). resolveRuleActivity() est le
// point d'entrée unique partout où ce fichier aurait fait `state.activities.find(a => a.id === x)`.
const ALL_REAL_VACATIONS_PSEUDO_ACTIVITY = { id: ALL_REAL_VACATIONS_ID, nom: "Toutes les vraies vacations" };
function resolveRuleActivity(activityId) {
  if (activityId === ALL_REAL_VACATIONS_ID) return ALL_REAL_VACATIONS_PSEUDO_ACTIVITY;
  return state.activities.find((a) => a.id === activityId) || null;
}

// Plier/déplier les blocs de modalité (10/08/2026, demande de Samir : "aider à la visibilité") --
// transitoire, jamais persisté (repart tout déplié à chaque rechargement, comme staffModalSearchQuery
// et les autres petits états de vue de ce genre) : un Set d'`activityId` actuellement PLIÉS, vide par
// défaut = tout déplié (comportement d'origine, inchangé si Samir n'a jamais cliqué un en-tête).
const collapsedRuleGroups = new Set();

// Index de toutes les RG (10/08/2026, "il sera bien de lister toutes les RG... pour qu'on les
// retrouve facilement") -- catalogue de référence purement documentaire, PAS une source de vérité
// (une RG codée en dur ou paramétrable existe indépendamment de sa présence ici). À tenir à jour à
// chaque nouvelle RG numérotée, en miroir de regles-gestion.md (non chargé au runtime -- gitignored
// côté dépôt public, voir CLAUDE.md §3 -- donc dupliqué ici sous forme condensée exprès).
const RG_REFERENCE = [
  { code: "RG-001", label: "Compétences liées au grade et à la spécialité" },
  { code: "RG-002", label: "Composition Scan U, matin" },
  { code: "RG-003", label: "Composition Scan U, après-midi" },
  { code: "RG-004", label: "Interne socle non isolé en Echo U l'après-midi" },
  { code: "RG-005", label: "Répartition des vacations d'urgence" },
  { code: "RG-006", label: "Double-positionnement selon l'activité (tranchée par RG-021)" },
  { code: "RG-007", label: "Exception Scan U, jeudi matin" },
  { code: "RG-008", label: "Substitution sénior → interne (règle transverse)" },
  { code: "RG-009", label: "Composition Scan A" },
  { code: "RG-010", label: "Fermeture d'une vacation" },
  { code: "RG-011", label: `Vacation de spécialité "Os" : jamais staffée` },
  { code: "RG-012", label: "Composition de l'Astreinte (Scan U uniquement)" },
  { code: "RG-013", label: "Repos de garde automatique après une garde" },
  { code: "RG-014", label: "Une personne absente ne peut pas être postée" },
  { code: "RG-015", label: "Composition de la garde" },
  { code: "RG-016", label: `Personnel "Hors Sisu"` },
  { code: "RG-017", label: "Trame Personnel : planning de base récurrent" },
  { code: "RG-018", label: `"Jour Off" (fusionnée dans RG-021)` },
  { code: "RG-019", label: "Exclusivité Scan U / Echo U (fusionnée dans RG-021)" },
  { code: "RG-020", label: "Temps Partiel" },
  { code: "RG-021", label: "Exclusivité entre toutes les modalités" },
  { code: "RG-022", label: "Verrouillage manuel des semaines" },
  { code: "RG-023", label: "La trame ne poste jamais quelqu'un d'absent" },
  { code: "RG-024", label: "Exception de spécialité de vacation par semaine" },
  { code: "RG-025", label: "Moteur de règles paramétrable (composition de vacation)" },
  { code: "RG-026", label: "Règles globales : Passe-droit de spécialité" },
  { code: "RG-027", label: "Éviter astreinte + Scan U/Echo U le même jour" },
  { code: "RG-028", label: "Règles globales : Interdire de poster" },
  { code: "RG-029", label: FIXED_RULE_FAMILIES["RG-029"].label },
  { code: "RG-030", label: FIXED_RULE_FAMILIES["RG-030"].label },
  { code: "RG-031", label: FIXED_RULE_FAMILIES["RG-031"].label },
  { code: "RG-032", label: FIXED_RULE_FAMILIES["RG-032"].label },
  { code: "RG-033", label: FIXED_RULE_FAMILIES["RG-033"].label },
  { code: "RG-034", label: "Répartition 1/3 urgence-spé1-spé2 (internes double-spé, générateur uniquement)" },
  { code: "RG-035", label: RG_035_LABEL },
  { code: "RG-036", label: "Une règle = une modalité, plusieurs segments jour/créneau/composition" },
  { code: "RG-037", label: "Conflit entre segments à égale spécificité : le plus bas dans la liste gagne" },
  { code: "RG-038", label: "Règle de repli \"Toutes les vraies vacations\" (hors Bureau/Off/Hors SISU)" },
];

// Repliée par défaut (34 entrées -- trop long pour rester ouvert en permanence) -- transitoire,
// jamais persisté, même patron que `collapsedRuleGroups` ci-dessus.
let rgIndexExpanded = false;

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

// Index de toutes les RG (voir RG_REFERENCE ci-dessus) -- repliable, juste pour retrouver un numéro
// rapidement sans ouvrir regles-gestion.md. Aucune interaction au-delà du plier/déplier.
function renderRgIndexSection(container) {
  container.innerHTML = `
    <div class="rules-header">
      <h3>Index des RG <span class="rules-group-count">${plural(RG_REFERENCE.length, "règle")}</span></h3>
      <button type="button" id="btnToggleRgIndex" class="btn-primary btn-outline">${rgIndexExpanded ? "Masquer" : "Afficher"}</button>
    </div>
    <div id="rgIndexList" class="rg-index-list"></div>
  `;
  document.getElementById("btnToggleRgIndex").addEventListener("click", () => {
    rgIndexExpanded = !rgIndexExpanded;
    renderRgIndexSection(container);
  });
  const listEl = document.getElementById("rgIndexList");
  if (!rgIndexExpanded) { listEl.style.display = "none"; return; }
  listEl.innerHTML = RG_REFERENCE.map(({ code, label }) =>
    `<div class="rg-index-row"><span class="validation-rg rg-recommendation">${code}</span> ${label}</div>`
  ).join("");
}

// Règles fixes (10/08/2026, RG-029..033) : "je veux juste pouvoir les cocher/décocher" -- pas de
// formulaire, pas de ciblage, juste une case par règle. Voir FIXED_RULE_FAMILIES/
// validateFixedFamilyRules() (js/07-validation-rg.js) -- toujours des recommandations, jamais des
// violations, jamais bloquant.
function renderFixedRulesSection(container) {
  container.innerHTML = `
    <div class="rules-header">
      <h3>Règles fixes</h3>
    </div>
    <div class="fixed-rules-list">
      ${Object.entries(FIXED_RULE_FAMILIES).map(([rg, { label }]) => `
        <label class="fixed-rule-option">
          <input type="checkbox" class="fixedRuleToggle" value="${rg}" ${state.fixedRuleToggles[rg] ? "checked" : ""}>
          <span class="validation-rg rg-recommendation">${rg}</span> ${label}
        </label>
      `).join("")}
      <label class="fixed-rule-option">
        <input type="checkbox" class="fixedRuleToggle" value="RG-035" ${state.fixedRuleToggles["RG-035"] ? "checked" : ""}>
        <span class="validation-rg rg-recommendation">RG-035</span> ${RG_035_LABEL}
      </label>
    </div>
  `;
  [...container.querySelectorAll(".fixedRuleToggle")].forEach((cb) => {
    cb.addEventListener("change", () => {
      state.fixedRuleToggles[cb.value] = cb.checked;
      saveState();
      render();
    });
  });
}

function renderRulesView() {
  const container = document.getElementById("rulesView");
  container.innerHTML = `
    <div class="global-rules-section" id="rgIndexSection"></div>
    <div class="global-rules-section">
      <div class="rules-header global-rules-header">
        <h3>Règles globales</h3>
        <button type="button" id="btnAddGlobalRule" class="btn-primary btn-outline">+ Ajouter une règle globale</button>
      </div>
      <div id="globalRuleFormContainer"></div>
      <div id="globalRulesList" class="rules-list"></div>
    </div>
    <div class="global-rules-section" id="gardeRuleSection"></div>
    <div class="global-rules-section" id="fixedRulesSection"></div>
    <div class="rules-header">
      <h3>Règle des Vacations</h3>
      <button type="button" id="btnAddRule" class="btn-primary">+ Ajouter une règle</button>
    </div>
    <div id="ruleFormContainer"></div>
    <div id="rulesList" class="rules-list"></div>
  `;
  renderRgIndexSection(document.getElementById("rgIndexSection"));
  renderFixedRulesSection(document.getElementById("fixedRulesSection"));
  document.getElementById("btnAddRule").addEventListener("click", () => {
    document.getElementById("btnAddRule").blur();
    // Ne propose que les modalités qui n'ont pas encore de règle (18/08/2026, RG-036) -- pour ajouter
    // un cas à une modalité déjà pourvue, "+ Segment" depuis son bloc (voir renderRulesList()).
    renderRuleForm(document.getElementById("ruleFormContainer"), null, null, { restrictToUnusedModalities: true });
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
  // resolveRuleActivity() (au lieu de state.activities.find() direct) : inclut la pseudo-activité
  // "Toutes les vraies vacations" (RG-038) -- son bloc se rend, se plie/déplie et se réordonne
  // EXACTEMENT comme un bloc de modalité réelle, sans aucun code séparé pour lui.
  const orderedActivities = state.rulesGroupOrder
    .map((id) => resolveRuleActivity(id))
    .filter(Boolean);

  orderedActivities.forEach((activity) => {
    // Une seule règle par modalité depuis le 18/08/2026 (RG-036) -- state.rules.find(), plus .filter().
    const rule = state.rules.find((r) => r.activityId === activity.id);
    if (!rule) return;
    anyRule = true;

    const isCollapsed = collapsedRuleGroups.has(activity.id);
    const section = document.createElement("div");
    section.className = "rules-activity-group" + (isCollapsed ? " collapsed" : "");

    // En-tête du bloc : le <h3> (titre + plier/déplier + glisser pour réordonner le BLOC) et le
    // bouton "+ Segment" (18/08/2026) côte à côte plutôt que le bouton DANS le <h3> -- évite tout
    // conflit avec son propre clic (plier/déplier)/glissé (réordonnancement des blocs).
    const headerRow = document.createElement("div");
    headerRow.className = "rules-group-header-row";
    const h3 = document.createElement("h3");
    h3.innerHTML = `<span class="rules-group-chevron">▾</span> ${activity.nom} <span class="rules-group-count">${plural(rule.segments.length, "segment")}</span>`;
    h3.title = "Cliquer pour plier/déplier -- glisser pour réordonner ce bloc";
    // Plier/déplier (10/08/2026) : un simple clic (mousedown+mouseup sans déplacement) ne déclenche
    // jamais dragstart -- les deux gestes cohabitent sans conflit, testé en vrai. Ne touche qu'à
    // `collapsedRuleGroups` (transitoire) + re-render de la liste, jamais state.rules ni saveState().
    h3.addEventListener("click", () => {
      if (isCollapsed) collapsedRuleGroups.delete(activity.id);
      else collapsedRuleGroups.add(activity.id);
      renderRulesList(container);
    });
    // Glisser-déposer du BLOC entier (pas juste ses segments) -- réordonne state.rulesGroupOrder.
    // `dataset.activityId` identifie le bloc ; le drop insère le bloc déplacé juste avant/après le
    // bloc cible selon le sens du glissé, même logique que le réordonnancement des `.rules-row`
    // plus bas et des colonnes Stats (§6.24).
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
    headerRow.appendChild(h3);

    // "+ Segment" (18/08/2026, RG-036) : ajoute un segment à CETTE règle (modalité déjà fixée, pas de
    // sélecteur de modalité dans le formulaire -- voir renderRuleForm()). stopPropagation() pour ne
    // jamais déclencher le clic plier/déplier du <h3> voisin.
    const addSegBtn = document.createElement("button");
    addSegBtn.type = "button";
    addSegBtn.className = "btn-primary btn-outline rules-add-segment-btn";
    addSegBtn.textContent = "+ Segment";
    addSegBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderRuleForm(document.getElementById("ruleFormContainer"), null, null, { lockedActivityId: activity.id });
    });
    headerRow.appendChild(addSegBtn);
    section.appendChild(headerRow);

    rule.segments.forEach((segment) => {
      const daysText = segment.days.length === DAYS.length ? "Tous les jours" : segment.days.join(", ");
      const creneauxText = segment.creneaux.map(creneauLabel).join(" + ");

      const row = document.createElement("div");
      row.className = "rules-row";
      // Réordonnable par glisser-déposer (09/08/2026, demande de Samir : "important pour la suite
      // pour leur donner une priorité") -- même patron que les colonnes Stats (§6.24) : `dataset.segmentId`
      // identifie la ligne, le drop déplace le segment dans `rule.segments` (l'ordre du tableau EST
      // l'ordre affiché/persisté, pas de champ séparé). Un id de segment est unique globalement, donc
      // `findIndex` renvoyant -1 suffit à refuser un glissé venu d'un AUTRE bloc (plus besoin de
      // comparer explicitement une modalité, contrairement à avant la restructuration en segments).
      // resolveCompositionRule() n'utilise pas encore cet ordre pour départager un chevauchement
      // (toujours "le moins de jours gagne", voir sa déclaration) ; cet ordre est pour l'instant
      // purement une préférence d'affichage de Samir, la vraie priorité viendra plus tard.
      row.draggable = true;
      row.dataset.segmentId = segment.id;
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", segment.id);
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
        if (!draggedId || draggedId === segment.id) return;
        const fromIdx = rule.segments.findIndex((s) => s.id === draggedId);
        if (fromIdx === -1) return; // pas un segment de ce même bloc
        const draggedSegment = rule.segments[fromIdx];
        const targetIdxBefore = rule.segments.findIndex((s) => s.id === segment.id); // avant retrait, pour le sens du glissé
        rule.segments.splice(fromIdx, 1);
        let insertAt = rule.segments.findIndex((s) => s.id === segment.id); // position de la cible après retrait (a pu décaler de 1)
        if (fromIdx < targetIdxBefore) insertAt += 1; // glissé vers l'avant -> insertion APRÈS la cible
        rule.segments.splice(insertAt, 0, draggedSegment);
        saveState();
        render();
      });

      const desc = document.createElement("div");
      desc.className = "rules-row-desc";
      desc.innerHTML =
        `<strong>${daysText}</strong> — ${creneauxText}<br>` +
        `${describeRuleComposition(segment)} attendu(s)` +
        (segment.requireSpecialite ? ' <span class="rules-badge-spec">Spécialité exigée</span>' : "");
      row.appendChild(desc);

      const actions = document.createElement("div");
      actions.className = "rules-row-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "staff-modal-edit";
      editBtn.textContent = "Modifier";
      // Modalité déjà fixée (celle du bloc) -- pas de sélecteur dans le formulaire.
      editBtn.addEventListener("click", () => renderRuleForm(document.getElementById("ruleFormContainer"), segment, null, { lockedActivityId: activity.id }));
      // Copier (09/08/2026, demande de Samir) : ouvre le formulaire d'AJOUT (pas de modification --
      // `existingSegment` reste null, donc la sauvegarde crée un nouveau segment) mais pré-rempli avec
      // toutes les valeurs du segment source via le 3e paramètre `prefillFrom`, pour ne devoir changer
      // que ce qui diffère (modalité, jours...) plutôt que ressaisir toute la composition. Seul
      // "Copier" garde un sélecteur de modalité LIBRE (pas verrouillé) -- c'est le seul moyen de
      // démarrer un segment pour une AUTRE modalité déjà pourvue d'une règle en réutilisant une
      // composition existante comme modèle (18/08/2026, voir renderRuleForm()).
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "staff-modal-edit";
      copyBtn.textContent = "Copier";
      copyBtn.addEventListener("click", () => renderRuleForm(document.getElementById("ruleFormContainer"), null, segment, { prefillActivityId: activity.id }));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "staff-modal-delete";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => {
        if (!confirm(`Supprimer ce segment (${activity.nom}, ${daysText}, ${creneauxText}) ?`)) return;
        rule.segments = rule.segments.filter((s) => s.id !== segment.id);
        // Plus aucun segment -- la règle entière (le bloc) n'a plus lieu d'exister : cohérent avec le
        // fait qu'"+ Ajouter une règle" ne propose que les modalités qui n'ont pas encore de règle.
        if (rule.segments.length === 0) state.rules = state.rules.filter((r) => r.id !== rule.id);
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
// (composition PAR modalité, ci-dessus). 1er type : "ignoreSpecialite" (RG-001, passe-droit de
// spécialité pour des personnes/statuts ciblés, sur des modalités/jours/créneaux choisis -- voir
// specialiteOverrideForPerson() et GLOBAL_RULE_STATUS_OPTIONS, js/07-validation-rg.js). Étendu le
// 10/08/2026 (même journée) : `mode` "ignore" (comportement historique, RG-001 jamais vérifiée pour
// la cible) ou "downgrade" ("passe-droit" -- le signal reste visible mais dégradé en recommandation
// au lieu d'une violation), plus une granularité jour(s)/créneau(x) optionnelle (rétrocompatible :
// une règle existante sans ces champs continue de s'appliquer à TOUT jour/créneau, comme avant leur
// introduction). 2e type : "excludePosting" (RG-028, "Interdire de poster" -- pour des personnes/
// statuts choisis, sur des modalités/jours/créneaux choisis, voir
// validateGlobalPostingExclusions()/isPostingExcludedAsViolation()).
const GLOBAL_RULE_TYPE_LABELS = {
  ignoreSpecialite: "Passe-droit de spécialité (RG-001)",
  excludePosting: "Interdire de poster (RG-028)",
};

function generateGlobalRuleId() {
  return "grule" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Texte résumé affiché dans la liste -- réutilisé aussi comme aperçu en direct dans le formulaire.
// `allActivities`/`allStatuses` (10/08/2026) court-circuitent leur partie du texte respective --
// "tout le monde" masque staffIds/statuses (redondants dès que allStatuses est coché). `allDays`/
// `allCreneaux` suivent le même principe, pour les deux types depuis le 10/08/2026 -- `!rule.days`/
// `!rule.creneaux` (champ absent, pas juste vide) retombent sur "tous" pour rester rétrocompatibles
// avec une règle "ignoreSpecialite" créée avant l'ajout de ces champs.
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
  const daysText = rule.allDays || !rule.days ? "tous les jours" : rule.days.join(", ") || "aucun jour choisi";
  const creneauxText = rule.allCreneaux || !rule.creneaux ? "tous les créneaux" : rule.creneaux.map(creneauLabel).join(" + ") || "aucun créneau choisi";
  const typeLabel = GLOBAL_RULE_TYPE_LABELS[rule.type] || rule.type;
  if (rule.type === "excludePosting") {
    const severityText = rule.severity === "violation" ? "Obligatoire" : "Facultative";
    return `${typeLabel} (${severityText}) pour ${targetsText} — sur ${activitiesText}, ${daysText}, ${creneauxText}`;
  }
  const modeText = rule.mode === "downgrade" ? "dégradée en recommandation" : "ignorée complètement";
  return `${typeLabel} (${modeText}) pour ${targetsText} — sur ${activitiesText}, ${daysText}, ${creneauxText}`;
}

function renderGlobalRulesList(container) {
  container.innerHTML = "";
  if (state.globalRules.length === 0) {
    container.innerHTML = '<div class="staff-modal-empty">Aucune règle globale -- toutes les vérifications s\'appliquent normalement à tout le monde.</div>';
    return;
  }
  state.globalRules.forEach((rule) => {
    const enabled = rule.enabled !== false; // absent/true = active (comportement historique)
    const row = document.createElement("div");
    row.className = "rules-row" + (enabled ? "" : " rules-row-disabled");
    const desc = document.createElement("div");
    desc.className = "rules-row-desc";
    desc.textContent = (enabled ? "" : "[Désactivée] ") + describeGlobalRule(rule);
    row.appendChild(desc);

    const actions = document.createElement("div");
    actions.className = "rules-row-actions";
    // Activer/Désactiver (11/08/2026, demande de Samir : "sans avoir besoin de les supprimer") --
    // bascule `rule.enabled`, consommé par specialiteOverrideForPerson()/isPostingExcludedAsViolation()/
    // validateGlobalPostingExclusions() (js/07-validation-rg.js), qui traitent une règle désactivée
    // comme absente sans jamais la retirer de state.globalRules.
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "staff-modal-edit";
    toggleBtn.textContent = enabled ? "Désactiver" : "Activer";
    toggleBtn.addEventListener("click", () => {
      rule.enabled = !enabled;
      saveState();
      render();
    });
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
    actions.append(toggleBtn, editBtn, delBtn);
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
          <option value="excludePosting">${GLOBAL_RULE_TYPE_LABELS.excludePosting}</option>
        </select>
      </div>
      <div class="form-row" id="globalRuleSeverityRow">
        <label for="globalRuleSeverity">Sévérité</label>
        <select id="globalRuleSeverity">
          <option value="recommendation">Facultative (recommandation)</option>
          <option value="violation">Obligatoire (violation)</option>
        </select>
      </div>
      <div class="form-row" id="globalRuleModeRow">
        <label for="globalRuleMode">Mode</label>
        <select id="globalRuleMode">
          <option value="ignore">Ignorer complètement (RG-001 jamais vérifiée)</option>
          <option value="downgrade">Passe-droit (visible en recommandation, jamais en violation)</option>
        </select>
      </div>
      <div class="form-row">
        <label>Modalité(s) concernée(s)</label>
        <div class="rule-checkbox-group">
          <label class="rule-checkbox-all"><input type="checkbox" id="globalRuleAllActivities"> <strong>Toutes les modalités</strong></label>
          ${state.activities.map((a) => `<label><input type="checkbox" class="globalRuleActivity" value="${a.id}"> ${a.nom}</label>`).join("")}
        </div>
      </div>
      <div class="form-row" id="globalRuleDaysRow">
        <label>Jour(s) concerné(s)</label>
        <div class="rule-checkbox-group">
          <label class="rule-checkbox-all"><input type="checkbox" id="globalRuleAllDays"> <strong>Tous les jours</strong></label>
          ${DAYS.map((d) => `<label><input type="checkbox" class="globalRuleDay" value="${d}"> ${d}</label>`).join("")}
        </div>
      </div>
      <div class="form-row" id="globalRuleCreneauxRow">
        <label>Créneau(x) concerné(s)</label>
        <div class="rule-checkbox-group">
          <label class="rule-checkbox-all"><input type="checkbox" id="globalRuleAllCreneaux"> <strong>Tous les créneaux</strong></label>
          ${CRENEAUX.map((c) => `<label><input type="checkbox" class="globalRuleCreneau" value="${c.id}"> ${c.label}</label>`).join("")}
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
  // Même correctif que renderRuleForm() -- voir son commentaire juste avant son propre scrollIntoView().
  container.scrollIntoView({ behavior: "auto", block: "start" });

  const typeSelect = document.getElementById("globalRuleType");
  const severitySelect = document.getElementById("globalRuleSeverity");
  const modeSelect = document.getElementById("globalRuleMode");
  const allActivitiesCheckbox = document.getElementById("globalRuleAllActivities");
  const allDaysCheckbox = document.getElementById("globalRuleAllDays");
  const allCreneauxCheckbox = document.getElementById("globalRuleAllCreneaux");
  const allStatusesCheckbox = document.getElementById("globalRuleAllStatuses");
  const activityCheckboxes = [...container.querySelectorAll(".globalRuleActivity")];
  const dayCheckboxes = [...container.querySelectorAll(".globalRuleDay")];
  const creneauCheckboxes = [...container.querySelectorAll(".globalRuleCreneau")];
  const statusCheckboxes = [...container.querySelectorAll(".globalRuleStatus")];
  const staffCheckboxes = [...container.querySelectorAll(".globalRuleStaff")];

  if (existingRule) {
    typeSelect.value = existingRule.type;
    severitySelect.value = existingRule.severity === "violation" ? "violation" : "recommendation";
    modeSelect.value = existingRule.mode === "downgrade" ? "downgrade" : "ignore";
    activityCheckboxes.forEach((cb) => { cb.checked = (existingRule.activityIds || []).includes(cb.value); });
    dayCheckboxes.forEach((cb) => { cb.checked = (existingRule.days || []).includes(cb.value); });
    creneauCheckboxes.forEach((cb) => { cb.checked = (existingRule.creneaux || []).includes(cb.value); });
    statusCheckboxes.forEach((cb) => { cb.checked = (existingRule.statuses || []).includes(cb.value); });
    staffCheckboxes.forEach((cb) => { cb.checked = (existingRule.staffIds || []).includes(cb.value); });
    allActivitiesCheckbox.checked = !!existingRule.allActivities;
    // Rétrocompatibilité (10/08/2026) : une règle "ignoreSpecialite" créée avant l'ajout de la
    // granularité jour/créneau n'a ni `days` ni `allDays` -- se comportait comme "tous les jours" en
    // pratique (voir specialiteOverrideForPerson()), donc coche "Tous les jours"/"Tous les créneaux"
    // par défaut à l'ouverture du formulaire plutôt que de laisser les deux décochés (ce qui
    // suggérerait à tort "aucun jour" au lieu de "tous").
    allDaysCheckbox.checked = existingRule.allDays !== undefined ? !!existingRule.allDays : !existingRule.days;
    allCreneauxCheckbox.checked = existingRule.allCreneaux !== undefined ? !!existingRule.allCreneaux : !existingRule.creneaux;
    allStatusesCheckbox.checked = !!existingRule.allStatuses;
  }

  // "Toutes les modalités"/"Tous les jours"/"Tous les créneaux"/"Tous les statuts" (10/08/2026) :
  // désactive (et décoche) les cases individuelles de leur groupe pendant que la case globale est
  // cochée -- évite de laisser croire qu'une sélection individuelle compte encore une fois qu'elle
  // est redondante. "Tous les statuts" désactive aussi le sélecteur de personnes, déjà redondant
  // (tout le monde est ciblé de toute façon) -- pas de couplage symétrique côté "Toutes les
  // modalités"/"Tous les jours"/"Tous les créneaux", qui n'ont pas d'équivalent.
  const updateActivityCheckboxesDisabled = () => {
    activityCheckboxes.forEach((cb) => {
      cb.disabled = allActivitiesCheckbox.checked;
      if (allActivitiesCheckbox.checked) cb.checked = false;
    });
  };
  const updateDayCheckboxesDisabled = () => {
    dayCheckboxes.forEach((cb) => {
      cb.disabled = allDaysCheckbox.checked;
      if (allDaysCheckbox.checked) cb.checked = false;
    });
  };
  const updateCreneauCheckboxesDisabled = () => {
    creneauCheckboxes.forEach((cb) => {
      cb.disabled = allCreneauxCheckbox.checked;
      if (allCreneauxCheckbox.checked) cb.checked = false;
    });
  };
  const updateStatusCheckboxesDisabled = () => {
    [...statusCheckboxes, ...staffCheckboxes].forEach((cb) => {
      cb.disabled = allStatusesCheckbox.checked;
      if (allStatusesCheckbox.checked) cb.checked = false;
    });
  };
  updateActivityCheckboxesDisabled();
  updateDayCheckboxesDisabled();
  updateCreneauCheckboxesDisabled();
  updateStatusCheckboxesDisabled();

  // Champs propres à un seul type -- Sévérité pour "Interdire de poster", Mode pour "Ignorer la
  // Spé" (10/08/2026, "passe-droit"). Jours/Créneaux sont désormais communs aux deux types (avant
  // le 10/08/2026, "Ignorer la Spé" n'avait pas cette granularité). Même patron que la visibilité
  // conditionnelle du créneau Astreinte dans renderRuleForm() (updateAstreinteVisibility()).
  const updateTypeSpecificVisibility = () => {
    const isExcludePosting = typeSelect.value === "excludePosting";
    document.getElementById("globalRuleSeverityRow").style.display = isExcludePosting ? "block" : "none";
    document.getElementById("globalRuleModeRow").style.display = isExcludePosting ? "none" : "block";
  };

  const updatePreview = () => {
    const preview = document.getElementById("globalRulePreview");
    const draft = {
      type: typeSelect.value,
      severity: severitySelect.value,
      mode: modeSelect.value,
      allActivities: allActivitiesCheckbox.checked,
      activityIds: activityCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      allDays: allDaysCheckbox.checked,
      days: dayCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      allCreneaux: allCreneauxCheckbox.checked,
      creneaux: creneauCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      allStatuses: allStatusesCheckbox.checked,
      statuses: statusCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
      staffIds: staffCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value),
    };
    preview.textContent = `Aperçu : ${describeGlobalRule(draft)}.`;
  };
  typeSelect.addEventListener("change", () => { updateTypeSpecificVisibility(); updatePreview(); });
  severitySelect.addEventListener("change", updatePreview);
  modeSelect.addEventListener("change", updatePreview);
  allActivitiesCheckbox.addEventListener("change", () => { updateActivityCheckboxesDisabled(); updatePreview(); });
  allDaysCheckbox.addEventListener("change", () => { updateDayCheckboxesDisabled(); updatePreview(); });
  allCreneauxCheckbox.addEventListener("change", () => { updateCreneauCheckboxesDisabled(); updatePreview(); });
  allStatusesCheckbox.addEventListener("change", () => { updateStatusCheckboxesDisabled(); updatePreview(); });
  [...activityCheckboxes, ...dayCheckboxes, ...creneauCheckboxes, ...statusCheckboxes, ...staffCheckboxes].forEach((cb) => cb.addEventListener("change", updatePreview));
  updateTypeSpecificVisibility();
  updatePreview();

  document.getElementById("globalRuleFormCancel").addEventListener("click", () => { container.innerHTML = ""; });

  document.getElementById("globalRuleFormSubmit").addEventListener("click", () => {
    const errorEl = document.getElementById("globalRuleFormError");
    errorEl.textContent = "";

    const type = typeSelect.value;
    const allActivities = allActivitiesCheckbox.checked;
    const activityIds = allActivities ? [] : activityCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const allStatuses = allStatusesCheckbox.checked;
    const statuses = allStatuses ? [] : statusCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const staffIds = allStatuses ? [] : staffCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const allDays = allDaysCheckbox.checked;
    const days = allDays ? [] : dayCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const allCreneaux = allCreneauxCheckbox.checked;
    const creneaux = allCreneaux ? [] : creneauCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);

    if (!allActivities && activityIds.length === 0) { errorEl.textContent = "Choisis au moins une modalité, ou coche \"Toutes les modalités\"."; return; }
    if (!allStatuses && statuses.length === 0 && staffIds.length === 0) { errorEl.textContent = "Choisis au moins une personne ou un statut, ou coche \"Tous les statuts\"."; return; }
    if (!allDays && days.length === 0) { errorEl.textContent = "Choisis au moins un jour, ou coche \"Tous les jours\"."; return; }
    if (!allCreneaux && creneaux.length === 0) { errorEl.textContent = "Choisis au moins un créneau, ou coche \"Tous les créneaux\"."; return; }

    let payload;
    if (type === "excludePosting") {
      payload = {
        type, allActivities, activityIds, allDays, days, allCreneaux, creneaux, allStatuses, statuses, staffIds,
        severity: severitySelect.value,
      };
    } else {
      payload = {
        type: "ignoreSpecialite", allActivities, activityIds, allDays, days, allCreneaux, creneaux, allStatuses, statuses, staffIds,
        mode: modeSelect.value,
      };
    }

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

// `prefillFrom` (09/08/2026, "Copier") : ignoré si `existingSegment` est fourni (une modification a
// toujours la priorité) -- ne sert que pour l'ajout, pré-remplit les champs depuis un AUTRE segment
// sans jamais le modifier lui-même (la sauvegarde crée toujours un segment neuf dans ce cas,
// `existingSegment` reste null jusqu'au bout).
// `existingSegment`/`prefillFrom` sont désormais des SEGMENTS (18/08/2026, RG-036 -- une règle =
// une modalité, plusieurs segments jour(x)/créneau(x)/composition dedans), plus des règles à plat.
// `opts.lockedActivityId` fige la modalité (pas de sélecteur -- "Modifier"/"+ Segment" depuis un
// bloc précis, la modalité est déjà connue et ne doit pas pouvoir bouger). `opts.restrictToUnusedModalities`
// (le bouton "+ Ajouter une règle" en haut de l'écran) ne propose que les modalités SANS règle du
// tout -- pour ajouter un cas à une modalité déjà pourvue, on utilise "+ Segment" depuis son bloc.
// "Copier" est le seul mode avec un sélecteur LIBRE (toutes les modalités, y compris déjà pourvues) :
// c'est le seul moyen de démarrer un segment pour une AUTRE modalité en réutilisant une composition
// existante comme modèle.
function renderRuleForm(container, existingSegment, prefillFrom, opts) {
  opts = opts || {};
  const source = existingSegment || prefillFrom || null;

  const containerOfSegment = existingSegment
    ? state.rules.find((r) => r.segments.some((s) => s.id === existingSegment.id))
    : null;
  const lockedActivityId = containerOfSegment ? containerOfSegment.activityId : opts.lockedActivityId || null;

  // "Toutes les vraies vacations" (RG-038) rejoint la liste des modalités choisissables au même titre
  // qu'une modalité réelle -- state.activities seul ne suffit plus.
  const allChoosableActivities = [...state.activities, ALL_REAL_VACATIONS_PSEUDO_ACTIVITY];
  if (opts.restrictToUnusedModalities) {
    const availableActivities = allChoosableActivities.filter((a) => !state.rules.some((r) => r.activityId === a.id));
    if (availableActivities.length === 0) {
      container.innerHTML = '<div class="staff-modal-empty">Toutes les modalités ont déjà une règle -- ouvre le bloc correspondant pour y ajouter un segment.</div>';
      container.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
  }
  const activityChoices = opts.restrictToUnusedModalities
    ? allChoosableActivities.filter((a) => !state.rules.some((r) => r.activityId === a.id))
    : allChoosableActivities;
  const lockedActivity = lockedActivityId ? resolveRuleActivity(lockedActivityId) : null;
  // Valeur initiale du sélecteur (verrouillé OU libre) -- verrouillé : la seule option possible ;
  // libre + Copier : la modalité du segment source, pour ne devoir changer que ce qui diffère.
  const prefillActivityId = lockedActivityId || opts.prefillActivityId || null;
  const activityOptions = lockedActivityId
    ? `<option value="${lockedActivityId}">${lockedActivity ? lockedActivity.nom : lockedActivityId}</option>`
    : activityChoices.map((a) => `<option value="${a.id}">${a.nom}</option>`).join("");

  let title;
  if (existingSegment) title = "Modifier un segment";
  else if (prefillFrom) title = "Copier un segment";
  else if (opts.lockedActivityId) title = `Ajouter un segment -- ${lockedActivity ? lockedActivity.nom : ""}`;
  else title = "Ajouter une règle (nouvelle modalité)";

  container.innerHTML = `
    <div class="staff-form rule-form">
      <h3>${title}</h3>
      <div class="form-row">
        <label for="ruleActivity">Modalité</label>
        <select id="ruleActivity" ${lockedActivityId ? "disabled" : ""}>${activityOptions}</select>
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
        <button type="button" id="ruleFormSubmit">${existingSegment ? "Enregistrer" : "Ajouter"}</button>
        <button type="button" id="ruleFormCancel">Annuler</button>
      </div>
      <div class="form-error" id="ruleFormError"></div>
    </div>
  `;
  // Le formulaire se rouvre toujours dans #ruleFormContainer, en HAUT du bloc "Règle des Vacations"
  // -- immobile, quel que soit l'endroit de la longue liste (#rulesList, en dessous) où "Modifier"/
  // "Copier" a été cliqué (11/08/2026, retour de Samir : "ça me met la fenêtre tout en haut au lieu
  // de là où j'ai cliqué, c'est pas user friendly"). Un défilement automatique vers le formulaire
  // règle ça sans changer sa position réelle dans le DOM (pas de réorganisation nécessaire).
  container.scrollIntoView({ behavior: "auto", block: "start" });

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

  // La modalité n'est plus lue depuis `source.activityId` (un segment n'en porte plus, voir
  // DEFAULT_COMPOSITION_RULES dans js/03-state.js) -- `prefillActivityId` calculé plus haut couvre à
  // la fois le cas verrouillé (déjà la seule <option>, ceci est un no-op) et le cas Copier (sélecteur
  // libre, prérempli avec la modalité du segment source).
  if (prefillActivityId) activitySelect.value = prefillActivityId;
  if (source) {
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
    const activity = resolveRuleActivity(activityId);
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
    // jours qu'un autre SEGMENT déjà existant DE CETTE MÊME RÈGLE (18/08/2026 -- avant la
    // restructuration, comparait contre tout state.rules ; désormais une règle == une modalité, donc
    // comparer contre les segments du conteneur cible revient exactement au même résultat).
    // Comparaison en ensembles, pas en ordre.
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const targetContainer = state.rules.find((r) => r.activityId === activityId);
    const duplicate = targetContainer && targetContainer.segments.find((s) =>
      s.id !== (existingSegment && existingSegment.id) && sameSet(s.creneaux, creneaux) && sameSet(s.days, days)
    );
    if (duplicate) {
      errorEl.textContent = `Un segment existe déjà pour ${activity.nom} sur ce même périmètre (${duplicate.rg}) -- modifie-le plutôt que d'en créer un second.`;
      return;
    }

    const payload = {
      creneaux, days, seniorMin, seniorMax, interneMin, interneMax,
      encourageInterneGrowth: encourageGrowthCheckbox.checked,
      allowSubstitution: substitutionCheckbox.checked,
      requireSpecialite: requireSpecialiteCheckbox.checked,
      astreinteExclusivityMode: astreinteExclusivitySelect.value,
    };

    if (existingSegment) {
      // Object.assign sur l'existant (pas un nouvel objet) : préserve les champs internes non
      // exposés dans ce formulaire (mentionSeniorInText/seniorExcessMessage/
      // socleReinforcementIfSingleInterne -- seul le segment RG-012 en a aujourd'hui) plutôt que de
      // les perdre silencieusement en modifiant ce segment depuis l'écran. La modalité d'un segment
      // existant n'est jamais modifiable depuis ce formulaire (verrouillée, voir lockedActivityId) --
      // donc jamais besoin de déplacer ce segment d'un conteneur à un autre ici.
      Object.assign(existingSegment, payload);
    } else {
      // Nouveau segment : rejoint le conteneur de la modalité choisie s'il existe déjà (18/08/2026,
      // "moins de règles à créer par vacation"), sinon crée un nouveau conteneur à un seul segment.
      const newSegment = { id: generateSegmentId(), rg: activity.nom, ...payload };
      if (targetContainer) {
        targetContainer.segments.push(newSegment);
      } else {
        state.rules.push({ id: generateRuleId(), activityId, labelPrefix: activity.nom, segments: [newSegment] });
      }
    }
    saveState();
    container.innerHTML = "";
    render();
  });
}
