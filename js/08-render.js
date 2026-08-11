// ---------- Rendu ----------

function staffById(id) {
  return state.staff.find((s) => s.id === id);
}

// Détermine la classe CSS + le style inline d'une pastille : couleur = spécialité(s), forme = grade.
// 0 spécialité -> gris (socle). 1 -> couleur pleine. 2 -> dégradé bicolore (deux spécialités).
function chipVisual(person) {
  const specs = orderedSpecialites(person);
  const shapeClass = person.grade === "senior" ? " rect" : "";

  if (specs.length === 0) {
    return { className: `chip spec-none${shapeClass}`, style: "" };
  }
  if (specs.length === 1) {
    return { className: `chip spec-${specs[0]}${shapeClass}`, style: "" };
  }
  const c1 = SPECIALITES[specs[0]];
  const c2 = SPECIALITES[specs[1]];
  const style = `background: linear-gradient(135deg, ${c1.bg} 50%, ${c2.bg} 50%);`;
  return { className: `chip spec-split${shapeClass}`, style };
}

// Même code couleur que les pastilles, mais en style inline complet (fond + texte) pour habiller
// une cellule normale (ex. la colonne nom de la vue Personnel) plutôt qu'un chip.
function personCellStyle(person) {
  const specs = orderedSpecialites(person);
  if (specs.length === 0) return "background-color:#f1f5f9;color:#334155;";
  if (specs.length === 1) {
    const c = SPECIALITES[specs[0]];
    return `background-color:${c.bg};color:${c.text};`;
  }
  const c1 = SPECIALITES[specs[0]];
  const c2 = SPECIALITES[specs[1]];
  return `background:linear-gradient(135deg, ${c1.bg} 50%, ${c2.bg} 50%);color:#1f2937;`;
}

function applyChipVisual(el, person) {
  const { className, style } = chipVisual(person);
  el.className = className;
  if (style) el.style.cssText += style;
}

// Pastille assignée dans une case du planning (vue Modalité), avec bouton de retrait et
// glisser-déposer vers une autre case pour déplacer la personne (voir handleAssignmentDrop()).
function buildAssignedChip(person, key, day) {
  const chip = document.createElement("span");
  applyChipVisual(chip, person);
  const locked = isWeekLocked(key.split("|")[0]); // verrouillage (29/07/2026), voir isWeekLocked().
  // RG-014 (24/07/2026, retour de Samir) : le contour rouge posé sur toute la case
  // (.cell-absence-violation) ne disait pas QUI, parmi plusieurs personnes assignées, est la
  // personne absente en cause -- entoure désormais aussi la pastille de la personne concernée.
  // RG-020 (25/07/2026) : idem pour un conflit Temps Partiel. RG-021 (29/07/2026, généralise
  // RG-018/RG-019) : idem pour un double-positionnement sur une autre activité ce même créneau --
  // Off n'est plus un cas particulier, voir hasActivityExclusivityConflict(). Verrouillage : prime
  // sur tout le reste, aucune violation n'a de sens à signaler sur une case gelée.
  const [activityId, , creneauId] = trameKeyFromCellKey(key).split("|");
  const weekKeyPart = key.split("|")[0];
  if (locked) {
    chip.title = "Semaine verrouillée";
  } else if (activityId !== "off" && isPersonAbsentOnSlot(person.id, day, creneauId)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est absent(e) ce créneau-là`;
  } else if (isPersonTPOnSlot(person.id, day, creneauId)) {
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là`;
  } else if (findActivityExclusivityConflict(person.id, day, creneauId, activityId)) {
    // Nomme la vacation en conflit (09/08/2026, demande de Samir) -- plus utile que "ailleurs" pour
    // savoir laquelle des deux affectations retirer sans devoir chercher soi-même sur le planning.
    const conflictActivity = findActivityExclusivityConflict(person.id, day, creneauId, activityId);
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} est déjà posté(e) sur ${conflictActivity.nom} (${creneauLabel(creneauId)}) ce créneau-là`;
  } else if (hasSpecialiteMismatch(person, activityId, day, creneauId, weekKeyPart)) {
    // RG-001 (09/08/2026) : même contour rouge que RG-014/020/021, priorité la plus basse (les 3
    // autres conflits sont plus "graves" -- une case fermée/absente n'a pas non plus de spécialité
    // propriétaire à vérifier de toute façon, voir hasSpecialiteMismatch()).
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} n'a pas la spécialité de cette vacation`;
  } else if (isPostingExcludedAsViolation(person, activityId, day, creneauId)) {
    // RG-028 (10/08/2026, règle globale "Interdire de poster") : priorité la plus basse de toutes --
    // seulement les règles réglées en "Obligatoire" (severity: "violation") reddent la pastille, une
    // règle "Facultative" reste une simple recommandation dans la zone de validation, jamais sur la
    // pastille (même logique que RG-003/009 dont l'excédent ne touche jamais le contour rouge).
    chip.classList.add("chip-absence-violation");
    chip.title = `${person.prenom} ${person.nom} ne devrait pas être posté(e) ici (règle globale)`;
  }
  chip.textContent = `${person.prenom[0]}. ${person.nom}`;
  if (locked) {
    chip.classList.add("chip-week-locked");
    return chip; // ni glisser (draggable), ni bouton de retrait -- "rien d'actif" sur une semaine verrouillée.
  }
  chip.draggable = true;
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", person.id);
    e.dataTransfer.setData("application/x-source-key", key);
    e.dataTransfer.effectAllowed = "move";
  });
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Retirer";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeAssignment(key, person.id);
  });
  chip.appendChild(remove);
  return chip;
}

// Pastille de garde affichée dans l'en-tête de jour du planning (renderTable()) -- read-only,
// contrairement à buildAssignedChip() : pas de glisser-déposer ni de bouton de retrait, la garde
// se déclare depuis le popover congés/gardes (openCongePopover()), pas depuis l'en-tête.
function buildGardeChip(person) {
  const chip = document.createElement("span");
  applyChipVisual(chip, person);
  chip.classList.add("chip-garde");
  chip.textContent = `${person.prenom[0]}. ${person.nom}`;
  chip.title = `${person.prenom} ${person.nom} — garde`;
  return chip;
}

// Déplace/ajoute une personne dans les assignations d'une case cible, en la retirant au passage
// de sa case source si le glissé provient d'une autre case du planning (et pas de la liste
// Personnel, qui ne fournit pas de source-key et se comporte donc en simple ajout).
// Renvoie false si le dépôt est refusé (rien n'est modifié) -- l'appelant s'en sert pour donner un
// retour visuel (flash rouge, voir buildModaliteCell()), true si l'affectation a bien eu lieu.
//
// RG-014/RG-018/RG-019/RG-020 (25/07/2026, revu -- retour de Samir "je ne veux plus de blocage
// quand je positionne quelqu'un sur le planning") : une personne en congé, en repos de garde, en
// Off ce créneau-là, en Temps Partiel, ou déjà postée ailleurs en conflit avec Scan U/Echo U N'EST
// PLUS bloquée ici -- le glisser-déposer aboutit toujours, la contradiction remonte uniquement via
// la violation + contour rouge existants (voir buildAssignedChip()/buildModaliteTag(), déjà le seul
// mécanisme pour un conflit glissé via le popover, jamais filtré). Ancien comportement : un
// `isAssignmentBlocked()` dédié refusait le dépôt avant cette date -- retiré, plus aucun appelant.
function handleAssignmentDrop(e, targetKey) {
  const staffId = e.dataTransfer.getData("text/plain");
  if (!staffId || !staffById(staffId)) return false;
  const sourceKey = e.dataTransfer.getData("application/x-source-key");
  if (sourceKey && sourceKey === targetKey) return false;

  // RG-017 : matérialise systématiquement (source ET cible) avant de modifier -- une case source
  // encore purement issue de la trame (jamais touchée cette semaine) n'a pas de clé explicite dans
  // state.assignments ; sans ce passage par effectiveAssignedIds()/ensureMaterializedAssignments(),
  // la personne semblerait avoir disparu de nulle part (retirée de rien) tout en réapparaissant
  // dans la cible -- elle serait alors affichée deux fois (l'ancienne case continuant de suivre la
  // trame, jamais décrochée).
  if (sourceKey) {
    removeFromAssignments(sourceKey, staffId);
  }
  const targetList = ensureMaterializedAssignments(targetKey);
  if (!targetList.includes(staffId)) {
    targetList.push(staffId);
  }
  saveState();
  render();
  return true;
}

// Dépostage automatique CONTINU des absences (09/08/2026, demande de Samir : "je veux pas avoir à
// cliquer") -- généralise le dépostage ponctuel de RG-013/014, qui ne se déclenchait jusqu'ici qu'au
// moment précis où une garde/un congé est déclaré (voir depostAssignmentsForDay()) : réappliqué
// désormais à CHAQUE affichage de la semaine (appelé en tête de render(), avant tout le reste), pas
// seulement à la déclaration. Couvre le cas d'une case déjà remplie AVANT que le congé n'existe, ou
// remplie/importée par un chemin qui ne passe jamais par le dépostage interactif (import JSON brut
// notamment, qui fait un simple merge sans repasser par aucune règle métier) -- trouvé en vrai le
// 09/08/2026 sur un export réel de Samir (21 cas sur une seule semaine).
// - Respecte le verrouillage de semaine (RG-022) : une semaine verrouillée n'est jamais modifiée,
//   comme partout ailleurs -- seul le contour rouge RG-014 y reste comme signal.
// - Exception "Off" conservée (RG-014, 29/07/2026) : une personne absente postée sur Off n'est
//   jamais retirée, les deux disent la même chose ("cette personne ne travaille pas").
// - Ne touche que state.assignments MATÉRIALISÉ pour la semaine affichée -- le repli trame (RG-023)
//   filtre déjà les absents de son côté à la lecture, rien à déposter pour lui.
// - `changed` évite un saveState() (et donc une écriture GitHub) à chaque rendu s'il n'y a rien à
//   corriger -- la grande majorité des rendus n'ont aucune absence à déposter.
function autoDepostAbsentAssignmentsForDisplayedWeek() {
  const monday = getMonday(state.weekOffset);
  if (isWeekLocked(weekKey(monday))) return;
  let changed = false;
  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      state.activities.forEach((activity) => {
        if (activity.id === "off") return;
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = cellKey(activity.id, day, creneau.id);
        const list = state.assignments[key];
        if (!list || list.length === 0) return;
        const filtered = list.filter((staffId) => !isPersonAbsentOnSlot(staffId, day, creneau.id));
        if (filtered.length !== list.length) {
          state.assignments[key] = filtered;
          changed = true;
        }
      });
    });
  });
  if (changed) saveState();
}

function render() {
  autoDepostAbsentAssignmentsForDisplayedWeek();
  renderWeekLabel();
  renderWeekLockButton();

  // Dérivées du mode Trame (voir déclaration plus haut) -- recalculées en tout premier ici pour que
  // tout le reste de render() (et tout ce qu'il appelle) les voie déjà à jour.
  editingVacationSpecs = editingTrame && trameView === "specs";
  editingTramePersonnel = editingTrame && trameView === "personnel";

  document.getElementById("trameSubNav").classList.toggle("hidden", !editingTrame);
  document.querySelectorAll(".trame-tab").forEach((btn) => {
    btn.classList.toggle("active", editingTrame && trameView === btn.dataset.trameView);
  });

  document.getElementById("weekCongesBar").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel || editingRules);
  document.getElementById("tableWrap").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel || editingRules);
  document.getElementById("validationZone").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel || editingRules);
  document.getElementById("congesView").classList.toggle("hidden", !editingConges);
  document.getElementById("statsView").classList.toggle("hidden", !editingStats);
  document.getElementById("tramePersonnelView").classList.toggle("hidden", !editingTramePersonnel);
  document.getElementById("rulesView").classList.toggle("hidden", !editingRules);
  // La liste du personnel n'a aucune utilité en vue Congés/Stats/Trame Personnel/Règles et peut être
  // très haute (une ligne par personne) : la masquer y libère la hauteur d'écran nécessaire (trouvé
  // le 21/07/2026 en testant en vrai pour la vue Congés -- même raisonnement appliqué depuis à
  // Stats/Trame Personnel/Règles).
  document.getElementById("staffList").classList.toggle("hidden", editingConges || editingStats || editingTramePersonnel || editingRules);

  // Panneau de droite entier masqué UNIQUEMENT en vue Personnel du planning principal (22/07/2026) :
  // ses lignes y dupliquent exactement celles du tableau (une par personne), donc plus aucune
  // utilité -- masquer tout le panneau libère la largeur pour le tableau (Samir voulait voir
  // Vendredi sans scroll horizontal). **Revert du 22/07/2026 (même jour, retour de Samir)** : ça ne
  // s'applique QUE dans cette vue précise, pas en vue Modalité (l'ancien comportement — panneau
  // toujours affiché avec sa légende dedans — doit rester en vue Modalité/Spécialités Vacations/
  // Congés). D'où le déplacement de `#legend` en JS ci-dessous plutôt qu'un simple hidden posé une
  // fois pour toutes dans `index.html` : la légende doit continuer à fonctionner (filtrer la liste)
  // dans les vues où le panneau reste visible, donc elle doit physiquement y rester présente.
  const legend = document.getElementById("legend");
  const staffPanel = document.getElementById("staffPanel");
  // Trame Personnel (24/07/2026) rejoint ce même traitement -- demandé par Samir ("filtres en haut
  // comme sur cette page", en référence à la vraie vue Personnel) : ses lignes sont aussi une par
  // personne, la liste de droite y est tout aussi redondante, et masquer tout le panneau libère la
  // largeur nécessaire pour voir Vendredi sans scroll horizontal, exactement la même raison qui a
  // fait remonter la légende ici pour la vraie vue Personnel (voir juste en dessous).
  const inPersonnelView =
    editingTramePersonnel ||
    (currentView === "personnel" && !editingConges && !editingVacationSpecs && !editingStats && !editingRules);

  if (inPersonnelView) {
    // Remontée au-dessus du tableau (avant `#weekCongesBar`), pour rester accessible pendant que
    // tout le panneau qui la contenait normalement est masqué -- sinon les puces de filtre
    // n'auraient plus rien à agir dessus dans cette vue (voir renderPersonnelRows()).
    legend.classList.add("legend-top");
    document.querySelector(".planning-column").insertBefore(legend, document.getElementById("weekCongesBar"));
  } else {
    // Remise à sa place d'origine, entre le titre "Personnel" et la liste -- comportement
    // historique, conservé pour toutes les autres vues.
    legend.classList.remove("legend-top");
    staffPanel.insertBefore(legend, document.getElementById("staffList"));
  }

  staffPanel.classList.toggle("hidden", inPersonnelView || editingRules);

  if (editingConges) {
    renderCongesView();
  } else if (editingStats) {
    renderStatsView();
  } else if (editingTramePersonnel) {
    renderTramePersonnelView();
  } else if (editingRules) {
    renderRulesView();
  } else {
    renderTable();
    renderValidationZone();
    renderWeekCongesBar();
  }

  renderLegend();
  renderStaffList();
  sizeTableWrapMaxHeight();
  stackStickyHeaderRows();
}

// Hauteur max de .table-wrap calculée en JS (24/07/2026, "figer le volet des jours") -- PAS en CSS/
// flexbox : une tentative flexbox pleine page a été abandonnée le même jour (comprimait le tableau
// même quand il tenait très bien avant en empêchant la page de simplement défiler comme avant pour
// les vues courtes -- voir piège en section 2 de CLAUDE.md). Mesure la place réellement disponible
// jusqu'en bas de la fenêtre à partir de la position réelle de .table-wrap (pas une valeur devinée,
// même principe que sizeCongesRows() un peu plus bas) : si le contenu tient déjà dans cet espace,
// cette max-height ne change rien de visible (aucun scroll, comportement identique à avant) ; sinon,
// .table-wrap (overflow-y:auto, voir style.css) défile en interne avec en-tête/colonne gelés
// (position: sticky, déjà posé pour la colonne figée, voir §6.18 CLAUDE.md).
function sizeTableWrapMaxHeight() {
  const margin = 16; // même marge que le padding de `main`, pour ne pas coller au bord de la fenêtre
  const minHeight = 160; // plancher pour rester utilisable même sur une petite fenêtre
  document.querySelectorAll(".table-wrap").forEach((wrap) => {
    if (wrap.offsetParent === null) return; // masqué (display:none sur wrap lui-même ou un ancêtre .hidden)
    const top = wrap.getBoundingClientRect().top;
    const maxH = Math.max(minHeight, Math.floor(window.innerHeight - top - margin));
    wrap.style.maxHeight = `${maxH}px`;
  });
}

// Empile les 2 lignes d'en-tête (jours, puis matin/astreinte/après-midi) au lieu de les superposer
// (24/07/2026, corrige un 2e passage sur "figer le volet des jours") -- `thead th { position:
// sticky; top: 0 }` (style.css) donne le MÊME top:0 aux deux lignes de <thead> (vue Modalité/
// Personnel/Trame Vacation et Trame Personnel ont chacune 2 lignes : `.day-header` puis
// `.creneau-header`, voir renderTable()/renderTramePersonnelView()). Au scroll, les deux lignes se
// collaient donc au même endroit et la 2e (créneaux, plus loin dans le DOM) recouvrait la 1re
// (jours) -- symptôme remonté par Samir : "matin/astreinte/après-midi" semblait figé, "les jours"
// non (en réalité toujours là, juste caché dessous). Fix : mesurer la hauteur réelle de la 1re ligne
// et décaler la 2e d'autant via un `top` inline -- pas une valeur CSS fixe, la 1re ligne peut
// grandir (chips de garde RG-015 dans l'en-tête de jour, voir §6.1) donc la hauteur n'est pas
// constante d'une semaine à l'autre. Congés/Stats n'ont qu'une seule ligne d'en-tête : `rows.length
// < 2` les laisse intactes (déjà correctement gelées par la seule règle CSS top:0).
function stackStickyHeaderRows() {
  document.querySelectorAll(".table-wrap table thead").forEach((thead) => {
    const rows = thead.querySelectorAll("tr");
    if (rows.length < 2) return;
    const firstRowHeight = rows[0].getBoundingClientRect().height;
    rows[1].querySelectorAll("th").forEach((th) => {
      th.style.top = `${firstRowHeight}px`;
    });
  });
}

let tableWrapResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(tableWrapResizeTimer);
  tableWrapResizeTimer = setTimeout(() => {
    sizeTableWrapMaxHeight();
    stackStickyHeaderRows();
  }, 150);
});

// Retrace tout ce qui consulte staffFilters (légende, liste de droite, et depuis le 22/07/2026 la
// vue Congés et la vue Personnel du planning principal) -- factorisé pour rester la même liste
// qu'on touche le filtre via une puce (toggleStaffFilter()) ou via "Réinitialiser les filtres".
function refreshAfterFilterChange() {
  renderLegend();
  renderStaffList();
  if (editingConges) renderCongesView();
  // Manquait à l'ajout de la vue Stats (24/07/2026) -- bug réel remonté par Samir : filtrer depuis
  // la vue Stats (ou y arriver avec un filtre déjà actif) ne mettait jamais à jour son tableau, qui
  // gardait le filtre "initial" quoi qu'on fasse ensuite. Cette fonction duplique volontairement la
  // logique de render() (voir le commentaire au-dessus) plutôt que de l'appeler telle quelle --
  // penser à répercuter ici tout nouveau mode plein-écran qui dépend de staffFilters.
  if (editingStats) renderStatsView();
  if (editingTramePersonnel) renderTramePersonnelView(); // même piège que Stats -- voir commentaire ci-dessus.
  if (!editingConges && !editingVacationSpecs && !editingStats && !editingTramePersonnel && currentView === "personnel") renderTable();
  // Bandeau congés (09/08/2026, filtré par staffFilters) : visible dans les mêmes vues que dans
  // render() (ni Congés, ni Stats, ni Trame Personnel, ni Règles) -- même piège que Stats/Trame
  // Personnel ci-dessus, sinon un filtre changé pendant que le bandeau est déjà affiché ne le
  // recalculait jamais.
  if (!editingConges && !editingStats && !editingTramePersonnel && !editingRules) renderWeekCongesBar();
  sizeTableWrapMaxHeight();
  stackStickyHeaderRows();
}

function toggleStaffFilter(category, value) {
  const set = staffFilters[category];
  if (set.has(value)) set.delete(value);
  else set.add(value);
  refreshAfterFilterChange();
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  const addChip = (label, category, value, style) => {
    const span = document.createElement("span");
    const active = staffFilters[category].has(value);
    span.className = "chip legend-chip" + (active ? " active" : "");
    span.style.cssText = style;
    span.textContent = label;
    span.addEventListener("click", () => toggleStaffFilter(category, value));
    legend.appendChild(span);
  };

  const neutral = "background:#f1f5f9;border-color:#94a3b8;color:#1f2937;";
  addChip("Sénior", "grades", "senior", neutral + "border-radius:4px;font-weight:700;");
  addChip("Interne", "grades", "interne", neutral);
  addChip("CCA", "grades", "cca", neutral);
  addChip("TP", "grades", "tempsPlein", neutral); // 05/08/2026 -- "TP" pour Temps Plein, libellé court demandé par Samir

  // Saut de ligne forcé : les spécialités passent sous Sénior/Interne, sans réduire leur propre largeur.
  const lineBreak = document.createElement("span");
  lineBreak.style.cssText = "flex-basis:100%;height:0;";
  legend.appendChild(lineBreak);

  Object.entries(SPECIALITES).forEach(([key, spec]) => {
    addChip(spec.label, "specialites", key, `background:${spec.bg};border-color:${spec.border};color:${spec.text};`);
  });
  addChip("Socle", "specialites", "socle", "background:#f1f5f9;border-color:#94a3b8;color:#334155;");

  // "Hors Sisu" (23/07/2026) : bascule à part, pas un chip de plus dans grades/specialites (voir
  // staffFilters -- sémantique "révèle" et non "restreint", RG-016). Style pointillé pour la
  // distinguer visuellement des vrais filtres de grade/spécialité.
  const horsSisuChip = document.createElement("span");
  horsSisuChip.className = "chip legend-chip" + (staffFilters.showHorsSisu ? " active" : "");
  horsSisuChip.style.cssText = "background:#f1f5f9;border-color:#94a3b8;color:#334155;border-style:dashed;";
  horsSisuChip.textContent = "Hors Sisu";
  horsSisuChip.title = "Afficher aussi les personnes \"Hors Sisu\" (masquées par défaut)";
  horsSisuChip.addEventListener("click", () => {
    staffFilters.showHorsSisu = !staffFilters.showHorsSisu;
    refreshAfterFilterChange();
  });
  legend.appendChild(horsSisuChip);

  if (staffFilters.grades.size > 0 || staffFilters.specialites.size > 0 || staffFilters.showHorsSisu) {
    const reset = document.createElement("span");
    reset.className = "legend-reset";
    reset.textContent = "× Réinitialiser les filtres";
    reset.addEventListener("click", () => {
      staffFilters.grades.clear();
      staffFilters.specialites.clear();
      staffFilters.showHorsSisu = false;
      refreshAfterFilterChange();
    });
    legend.appendChild(reset);
  }
}

function renderTable() {
  const table = document.getElementById("planningTable");
  table.innerHTML = "";

  const thead = document.createElement("thead");

  const dayRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.className = "corner-cell";
  dayRow.appendChild(cornerTh);
  const headerMonday = getMonday(state.weekOffset);
  const headerWeekDates = weekIsoDates(headerMonday);
  DAYS.forEach((day, dayIdx) => {
    const th = document.createElement("th");
    th.colSpan = CRENEAUX.length;
    th.className = "day-header day-header-focusable day-start"; // séparateur de jour, voir §6.28/§6.29
    if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === null) {
      th.classList.add("focus-active");
    }
    th.title = "Cliquer pour filtrer le personnel présent et disponible ce jour";
    th.addEventListener("click", () => toggleStaffFocusFilter(day, null));

    const label = document.createElement("div");
    label.className = "day-header-label";
    label.textContent = day;
    th.appendChild(label);

    // RG-015 : personnes de garde ce jour-là, affichées directement dans l'en-tête pour que Samir
    // les voie d'un coup d'œil pendant qu'il assigne le personnel, sans devoir rouvrir la vue Congés.
    const gardeStaff = gardeStaffForDate(headerWeekDates[dayIdx]);
    if (gardeStaff.length > 0) {
      const gardeRow = document.createElement("div");
      gardeRow.className = "day-header-garde";
      gardeStaff.forEach((p) => gardeRow.appendChild(buildGardeChip(p)));
      th.appendChild(gardeRow);
    }

    dayRow.appendChild(th);
  });
  thead.appendChild(dayRow);

  const creneauRow = document.createElement("tr");
  const modaliteTh = document.createElement("th");
  modaliteTh.className = "modalite-header";
  if (editingVacationSpecs) {
    modaliteTh.textContent = "Trame Vacation";
  } else {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "view-toggle-btn";
    toggleBtn.textContent = currentView === "modalite" ? "Modalité ⇄" : "Personnel ⇄";
    toggleBtn.title = currentView === "modalite" ? "Voir par personnel" : "Voir par modalité";
    toggleBtn.addEventListener("click", () => {
      currentView = currentView === "modalite" ? "personnel" : "modalite";
      render();
    });
    modaliteTh.appendChild(toggleBtn);
  }
  creneauRow.appendChild(modaliteTh);
  DAYS.forEach((day) => {
    CRENEAUX.forEach((c, creneauIdx) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "creneau-header creneau-header-focusable";
      if (creneauIdx === 0) th.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
      if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === c.id) {
        th.classList.add("focus-active");
      }
      th.title = "Cliquer pour filtrer le personnel présent et disponible sur ce créneau";
      th.addEventListener("click", () => toggleStaffFocusFilter(day, c.id));
      creneauRow.appendChild(th);
    });
  });
  thead.appendChild(creneauRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (editingVacationSpecs) {
    renderVacationSpecRows(tbody);
  } else if (currentView === "modalite") {
    renderModaliteRows(tbody);
  } else {
    renderPersonnelRows(tbody);
  }
  table.appendChild(tbody);
}

// RG-014 (22/07/2026, voir regles-gestion.md), granularité créneau depuis le 05/08/2026 (congé
// demi-journée) : une personne en congé (matin/après-midi/journée entière) ou en repos de garde
// (RG-013, toujours journée entière) sur le créneau `creneauId` du jour `day` de la semaine
// ACTUELLEMENT AFFICHÉE (state.weekOffset). LE point d'entrée pour toute vérification liée à une
// case précise -- moteur de validation (validateAbsences()), contour rouge de violation
// (buildAssignedChip()/buildModaliteTag()), focus demi-journée (personMatchesFocusFilter()) -- depuis
// le 25/07/2026, ne bloque PLUS le glisser-déposer en vue Modalité (handleAssignmentDrop()), voir le
// commentaire dédié là-bas.
function isPersonAbsentOnSlot(staffId, day, creneauId) {
  const iso = weekIsoDates(getMonday(state.weekOffset))[DAYS.indexOf(day)];
  return isPersonAbsentOnIsoSlot(staffId, iso, creneauId);
}

// Cœur ISO (05/08/2026, indépendant de state.weekOffset) -- extrait d'isPersonAbsentOnSlot() pour
// être réutilisable par tout calcul portant sur une date précise sans rapport avec la semaine
// affichée (ex. le compteur de "manquants" en vue Stats, mode Période, voir missingSlotsForDate()).
function isPersonAbsentOnIsoSlot(staffId, iso, creneauId) {
  return congeCoversSlot(staffId, iso, creneauId) || isOnReposGardeDay(staffId, iso);
}

// Absent(e) TOUTE la journée (matin ET après-midi) -- un congé "journée entière", ou deux congés
// demi-journée qui se complètent (matin + après-midi), ou un repos de garde (toujours journée
// entière). Utilisée pour tout ce qui raisonne au niveau du jour complet plutôt que d'un créneau
// précis (focus jour entier) -- voir isPersonAbsentOnSlot() pour la version par créneau.
function isPersonAbsentOnDay(staffId, day) {
  return isPersonAbsentOnSlot(staffId, day, "matin") && isPersonAbsentOnSlot(staffId, day, "apres-midi");
}

// RG-018 ("Jour Off", 24/07/2026, demande de Samir) : "Off" (nom interne d'activité `off`, voir
// ACTIVITIES) se déclare comme n'importe quelle modalité -- typiquement dans la Trame Personnel
// (RG-017), d'où un effet sur la semaine affichée via effectiveAssignedIds() (trame ou affectation
// réelle de cette semaine précise, peu importe). Contrairement à RG-014 (congé/repos, toute la
// journée), Off bloque seulement le CRÉNEAU précis où il est posé (demi-journée) -- Off le matin
// n'empêche pas de poster la même personne l'après-midi du même jour.
function isPersonOffOnSlot(staffId, day, creneauId) {
  return effectiveAssignedIds(cellKey("off", day, creneauId)).includes(staffId);
}

// RG-020 (Temps Partiel, 25/07/2026, demande de Samir) : une personne à temps partiel n'est pas
// disponible sur les créneaux hors de son contrat -- donnée STRUCTURELLE (comme la trame), jamais
// liée à une semaine précise (pas de notion d'"override" ponctuel comme assignments/trame). Bloque
// dans la Trame Personnel elle-même (décision explicite du 25/07/2026) ; sur le planning réel, ne
// bloque plus le glisser-déposer depuis le même jour (retour de Samir, voir handleAssignmentDrop()/
// handleModaliteDrop()) -- juste une violation signalée, comme congé/Off/l'exclusivité Scan U.
function tpKey(staffId, day, creneauId) {
  return `${staffId}|${day}|${creneauId}`;
}

function isPersonTPOnSlot(staffId, day, creneauId) {
  return !!state.tempsPartiel[tpKey(staffId, day, creneauId)];
}

// RG-021 (29/07/2026, demande de Samir -- généralise RG-018/RG-019) : deux activités DIFFÉRENTES
// sont désormais toujours exclusives sur un même jour+créneau, quelles qu'elles soient -- une
// personne postée au Scan B ne peut plus être postée aussi en Mammo le même créneau, exactement
// comme Scan U/Echo U l'étaient déjà entre elles depuis le 24/07/2026. Off n'est plus un cas
// particulier : c'est juste une activité comme les autres pour ce calcul (avant le 29/07/2026, RG-018
// et RG-019 étaient deux implémentations séparées de la même idée, l'une bornée à Off, l'autre bornée
// à Scan U/Echo U -- fusionnées ici en une seule fonction, RG-006 "double-positionnement" n'a donc
// plus de cas non couvert). Symétrique : `activityId` peut être l'activité qu'on essaie de poser (on
// vérifie alors si la personne est déjà ailleurs) ou une activité déjà en place (on vérifie alors si
// elle est postée sur une autre activité).
// Ne concerne QUE Matin/Après-midi -- l'astreinte (créneau à part, propre à Scan U, RG-012) reste
// hors-sujet ("l'astreinte c'est autre chose", confirmé par Samir le 24/07/2026) : elle ne peut de
// toute façon accueillir que Scan U (isCreneauApplicable()), aucun double-positionnement possible.
// Renvoie l'AUTRE activité en conflit (voir la règle ci-dessus), ou `null` s'il n'y en a pas --
// utilisée pour nommer la vacation en cause dans les tooltips (09/08/2026, demande de Samir : "tu
// peux indiquer la vacation en question et le créneau ?"). `hasActivityExclusivityConflict()` reste
// le simple booléen, utilisé là où le nom de l'activité en conflit ne compte pas (moteur de
// validation, exclusion de RG-020/RG-001).
function findActivityExclusivityConflict(staffId, day, creneauId, activityId) {
  if (creneauId === "astreinte") return null;
  return state.activities.find((activity) => {
    if (activity.id === activityId) return false;
    const key = cellKey(activity.id, day, creneauId);
    // RG-010 : une case fermée n'a plus de composition attendue, jamais un conflit -- notamment pour
    // une vieille fermeture antérieure au 24/07/2026 qui n'a jamais matérialisé state.assignments à
    // vide (bug corrigé depuis pour toute nouvelle fermeture, voir setDayClosedForActivity()) : sans
    // ce garde-fou, le repli trame de la case fermée continue de "compter" indéfiniment pour RG-021,
    // invisible à l'écran puisque la case n'affiche qu'une croix.
    if (state.fermetures[key]) return false;
    return effectiveAssignedIds(key).includes(staffId);
  }) || null;
}

function hasActivityExclusivityConflict(staffId, day, creneauId, activityId) {
  return !!findActivityExclusivityConflict(staffId, day, creneauId, activityId);
}

// Bascule le focus jour/demi-journée (voir déclaration de staffFocusFilter) : un clic sur exactement
// la même cible (même day + même creneauId, `null` compris pour "jour entier") l'annule, un clic sur
// une cible différente (autre jour, ou même jour mais créneau différent) la remplace.
function toggleStaffFocusFilter(day, creneauId) {
  if (staffFocusFilter && staffFocusFilter.day === day && staffFocusFilter.creneauId === creneauId) {
    staffFocusFilter = null;
  } else {
    staffFocusFilter = { day, creneauId };
  }
  render();
}

// `staffId` est-elle déjà postée sur CE créneau précis -- toutes activités confondues ? Utilisée
// uniquement pour un focus demi-journée (voir personMatchesFocusFilter()) -- le focus jour entier a
// sa propre logique depuis le 25/07/2026, voir isPersonUnavailableAllDay() juste en dessous.
function isPersonPostedOnCreneau(staffId, day, creneauId) {
  return state.activities.some((activity) => effectiveAssignedIds(cellKey(activity.id, day, creneauId)).includes(staffId));
}

// RG-018/RG-020 (25/07/2026, retour de Samir sur le focus JOUR ENTIER) : une personne est
// indisponible "toute la journée" si Off et/ou Temps Partiel couvrent les 2 demi-journées (matin ET
// après-midi -- jamais l'astreinte, hors sujet pour ces deux statuts). Peu importe lequel des deux
// statuts couvre quelle moitié : Temps Partiel le matin + Off l'après-midi compte aussi comme
// indisponible toute la journée (union des deux, demandé explicitement).
function isPersonUnavailableAllDay(staffId, day) {
  return ["matin", "apres-midi"].every((creneauId) =>
    isPersonTPOnSlot(staffId, day, creneauId) || isPersonOffOnSlot(staffId, day, creneauId)
  );
}

// Filtre du panneau Personnel dérivé du focus actif (voir staffFocusFilter). Congé/repos de garde
// (RG-014) exclut toujours, jour entier ou demi-journée.
// - **Focus JOUR ENTIER** (revu le 25/07/2026, retour de Samir) : exclut si absent(e) TOUTE la
//   journée (isPersonAbsentOnDay(), les 2 demi-journées) ou "indisponible toute la journée" (voir
//   isPersonUnavailableAllDay() ci-dessus). Le check "déjà postée quelque part ce jour" (n'importe
//   quelle activité, une seule demi-journée suffisait) a été RETIRÉ -- il masquait à tort quelqu'un
//   qui n'avait qu'une seule demi-journée occupée, remplacé par ce critère plutôt que cumulé avec.
//   Depuis le 05/08/2026 (congé demi-journée), une personne absente seulement le matin OU seulement
//   l'après-midi n'est donc plus exclue d'un focus jour entier (elle reste postable sur l'autre moitié).
// - **Focus DEMI-JOURNÉE** (05/08/2026 : congé/repos vérifiés maintenant PAR CRÉNEAU, isPersonAbsentOnSlot()
//   -- avant, isPersonAbsentOnDay() excluait à tort les deux moitiés dès qu'une seule était absente) :
//   absence sur CE créneau précis, Temps Partiel ce créneau précis, ou déjà postée sur CE créneau
//   précis (Off y compris, une activité comme une autre pour ce check).
function personMatchesFocusFilter(person) {
  if (!staffFocusFilter) return true;
  const { day, creneauId } = staffFocusFilter;
  if (!creneauId) {
    if (isPersonAbsentOnDay(person.id, day)) return false;
    return !isPersonUnavailableAllDay(person.id, day);
  }
  if (isPersonAbsentOnSlot(person.id, day, creneauId)) return false;
  if (isPersonTPOnSlot(person.id, day, creneauId)) return false;
  return !isPersonPostedOnCreneau(person.id, day, creneauId);
}

// Construit une case assignable de la vue Modalité pour une activité/jour/créneau donnés.
// Séparé de renderModaliteRows() pour pouvoir fusionner la case Astreinte+Après-midi sur les
// activités autres que Scan U (RG-012, voir plus bas) sans dupliquer toute cette logique.
function buildModaliteCell(activity, day, creneau) {
  const td = document.createElement("td");
  td.className = "slot-cell";

  const key = cellKey(activity.id, day, creneau.id);
  const assigned = effectiveAssignedIds(key); // RG-017 : peut venir de la trame si jamais touchée cette semaine.
  const closed = !!state.fermetures[key]; // RG-010 : fermeture hebdomadaire, voir regles-gestion.md
  // Verrouillage (29/07/2026) : bypass TOUT le reste -- une case verrouillée n'accepte ni clic ni
  // glisser-déposer, quel que soit son état par ailleurs (voir isWeekLocked()).
  const locked = isWeekLocked(key.split("|")[0]);
  if (locked) td.classList.add("cell-week-locked");

  const vacSpec = effectiveVacationSpecialite(activity.id, day, creneau.id); // RG-024 : exception de la semaine si elle existe.
  if (vacSpec) td.classList.add(`tint-${vacSpec}`);

  // RG-011 : une vacation de spécialité "Os" n'est jamais assignable -- même comportement
  // bloquant qu'une fermeture (RG-010), mais piloté par vacationSpecialites (structurel).
  const osBlocked = !closed && vacSpec === "os";

  if (closed) {
    td.classList.add("cell-closed");
    const cross = document.createElement("span");
    cross.className = "closed-mark";
    cross.textContent = "✕";
    cross.title = "Vacation fermée cette semaine";
    td.appendChild(cross);
  } else {
    // Marque textuelle en plus de la teinte pour la spécialité "Os" (fond blanc, sinon
    // invisible sur le fond de page) -- voir SPECIALITES.os et section 5 de CLAUDE.md.
    if (osBlocked) {
      td.classList.add("cell-os-blocked");
      const badge = document.createElement("span");
      badge.className = "modalite-spec-label";
      badge.textContent = SPECIALITES.os.label;
      td.appendChild(badge);
    }

    // Générateur de planning auto (11/08/2026, voir js/22-generation-planning.js) : cercle orange si
    // cette case, une fois matérialisée pour la semaine affichée, ne contient plus tout le monde que
    // la trame y aurait mis (un déplacement -- généré ou manuel, peu importe -- a fait bouger
    // quelqu'un). Purement dérivé, voir trameDeviationMissingIds().
    const missingFromTrame = !locked ? trameDeviationMissingIds(key) : [];
    if (missingFromTrame.length > 0) {
      const mark = document.createElement("span");
      mark.className = "trame-deviation-mark";
      const names = missingFromTrame.map(staffById).filter(Boolean).map((p) => `${p.prenom} ${p.nom}`);
      mark.title = `Diffère de la trame : ${names.join(", ")} normalement ici cette semaine, déplacé(e)(s) ailleurs.`;
      td.appendChild(mark);
    }

    if (assigned.length === 0) {
      if (!osBlocked) {
        const hint = document.createElement("span");
        hint.className = "empty-hint";
        hint.textContent = locked ? "Verrouillée" : "+ ajouter";
        td.appendChild(hint);
      }
    } else {
      const people = assigned.map(staffById).filter(Boolean);
      const seniors = people.filter((p) => p.grade === "senior").sort(compareSpecialiteKeys);
      const internes = people.filter((p) => p.grade !== "senior").sort(compareSpecialiteKeys);

      const addCellGroup = (group) => {
        if (group.length === 0) return;
        const row = document.createElement("div");
        row.className = "cell-group";
        group.forEach((person) => row.appendChild(buildAssignedChip(person, key, day)));
        td.appendChild(row);
      };
      addCellGroup(seniors);
      addCellGroup(internes);

      // RG-014/RG-021 : une personne absente, ou postée sur une autre activité ce même créneau
      // (double-positionnement, RG-021 généralise l'ancienne RG-018/RG-019 depuis le 29/07/2026),
      // peut se retrouver assignée malgré tout -- ni le glisser-déposer ni le popover d'ajout ne
      // bloquent plus rien (25/07/2026, retour de Samir : "je ne veux plus de blocage quand je
      // positionne quelqu'un"), donc ce contour rouge est désormais le SEUL signal de la
      // contradiction, en plus de la violation dans la zone du moteur (validateAbsences()/
      // validateActivityExclusivity()). L'absence reste ignorée sur la case Off elle-même (RG-014,
      // "être en congés et avoir un Off, c'est pas grave") ; le double-positionnement, lui,
      // s'applique désormais aussi à Off comme à n'importe quelle autre activité.
      if (
        !locked &&
        people.some((p) =>
          (activity.id !== "off" && isPersonAbsentOnSlot(p.id, day, creneau.id)) ||
          hasActivityExclusivityConflict(p.id, day, creneau.id, activity.id)
        )
      ) {
        td.classList.add("cell-absence-violation");
      }
    }

    if (locked) {
      // Verrouillage (29/07/2026) : "rien d'actif" -- aucun écouteur posé, tooltip explicite au
      // survol (que la case soit vide ou déjà peuplée), même patron qu'une case fermée (RG-010) ou
      // Os (RG-011) : le blocage vient d'un `if`/`else if` qui ne pose simplement pas les écouteurs.
      td.title = "Semaine verrouillée -- aucune modification possible.";
    } else if (!osBlocked) {
      td.addEventListener("click", () => openAssignPopover(key, td, activity, day, creneau));

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
        if (!handleAssignmentDrop(e, key)) {
          // Dépôt sans effet (source === cible, ou dataTransfer invalide) -- flash rouge bref pour
          // signaler que le glisser-déposer n'a rien fait, plutôt qu'un échec silencieux qui
          // pourrait passer pour un bug. Ne couvre plus RG-014/018/019/020 depuis le 25/07/2026 :
          // le dépôt aboutit désormais toujours pour ces cas, voir handleAssignmentDrop().
          td.classList.add("drop-rejected");
          setTimeout(() => td.classList.remove("drop-rejected"), 400);
        }
      });
    }
  }

  return td;
}

const CRENEAU_MATIN = CRENEAUX.find((c) => c.id === "matin");
const CRENEAU_APRES_MIDI = CRENEAUX.find((c) => c.id === "apres-midi");

// Vue par défaut : une ligne par modalité, on y assigne des personnes. `personnelOnly` (09/08/2026,
// "Hors SISU") exclut une activité de cette grille -- reste assignable via la vue Personnel/Trame
// Personnel, voir sa déclaration dans ACTIVITIES.
function renderModaliteRows(tbody) {
  state.activities.filter((a) => !a.personnelOnly).forEach((activity) => {
    const tr = document.createElement("tr");
    if (activity.group && activity.group.endsWith("-start")) tr.classList.add("group-start");
    if (activity.group && activity.group.endsWith("-end")) tr.classList.add("group-end");

    const nameCell = document.createElement("td");
    nameCell.textContent = activity.nom;
    nameCell.className = "activity-cell" + (activity.urgence ? " urgence" : "");
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      if (activity.id === "scan-u") {
        CRENEAUX.forEach((creneau, creneauIdx) => {
          const cell = buildModaliteCell(activity, day, creneau);
          if (creneauIdx === 0) cell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
          tr.appendChild(cell);
        });
      } else {
        // RG-012 : l'astreinte n'existe pas ici -- au lieu d'une case grisée à part, on fusionne
        // la colonne Astreinte dans la case Après-midi (colSpan 2) : la case reste une case
        // Après-midi normale, juste visuellement plus large, la colonne Astreinte "disparaît".
        const matinCell = buildModaliteCell(activity, day, CRENEAU_MATIN);
        matinCell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
        tr.appendChild(matinCell);
        const apresMidiCell = buildModaliteCell(activity, day, CRENEAU_APRES_MIDI);
        apresMidiCell.colSpan = 2;
        tr.appendChild(apresMidiCell);
      }
    });

    tbody.appendChild(tr);
  });
}

// Mode "Spécialités Vacations" : mêmes lignes/colonnes que la vue Modalité, mais chaque case
// porte au plus une spécialité "propriétaire" (structurel, indépendant de la semaine) au lieu
// d'une liste de personnes. Alimente le fond teinté de la vue classique (voir tint-xxx en CSS)
// et servira de base aux futures RG de compétences.
function renderVacationSpecRows(tbody) {
  state.activities.filter((a) => !a.personnelOnly).forEach((activity) => {
    const tr = document.createElement("tr");
    if (activity.group && activity.group.endsWith("-start")) tr.classList.add("group-start");
    if (activity.group && activity.group.endsWith("-end")) tr.classList.add("group-end");

    const nameCell = document.createElement("td");
    nameCell.textContent = activity.nom;
    // "popover-anchor" (24/07/2026, fermeture en masse) : PAS ".slot-cell" -- cette classe porte
    // beaucoup de styles visuels (hover, teintes, curseur bloqué...) qui n'ont rien à faire sur le
    // nom de l'activité. Marqueur purement fonctionnel, exempté du même titre que ".slot-cell" par
    // le gestionnaire de clic global (voir plus bas) pour que le popover qu'il ouvre ne se referme
    // pas tout seul aussitôt ouvert (même piège déjà rencontré avec le bandeau congés, voir 6.11
    // CLAUDE.md : sans cette exemption, le clic qui ouvre le popover remonte ensuite jusqu'au
    // gestionnaire document et le referme dans la foulée).
    nameCell.className = "activity-cell popover-anchor" + (activity.urgence ? " urgence" : "");
    nameCell.title = "Cliquer pour fermer cette vacation sur toute la semaine ou certains jours";
    nameCell.addEventListener("click", () => openBulkFermeturePopover(activity, nameCell));
    tr.appendChild(nameCell);

    DAYS.forEach((day) => {
      if (activity.id === "scan-u") {
        CRENEAUX.forEach((creneau, creneauIdx) => {
          const cell = buildVacationSpecCell(activity, day, creneau);
          if (creneauIdx === 0) cell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
          tr.appendChild(cell);
        });
      } else {
        // RG-012 : même fusion Astreinte+Après-midi que dans la vue Modalité, voir buildModaliteCell().
        const matinCell = buildVacationSpecCell(activity, day, CRENEAU_MATIN);
        matinCell.classList.add("day-start"); // séparateur de jour, voir §6.28/style.css
        tr.appendChild(matinCell);
        const apresMidiCell = buildVacationSpecCell(activity, day, CRENEAU_APRES_MIDI);
        apresMidiCell.colSpan = 2;
        tr.appendChild(apresMidiCell);
      }
    });

    tbody.appendChild(tr);
  });
}

function buildVacationSpecCell(activity, day, creneau) {
  const td = document.createElement("td");
  td.className = "slot-cell";

  const specKey = vacationSpecKey(activity.id, day, creneau.id);
  const spec = effectiveVacationSpecialite(activity.id, day, creneau.id); // RG-024 : exception de la semaine si elle existe.
  const isWeeklyOverride = isVacationSpecialiteWeeklyOverride(activity.id, day, creneau.id);
  const closureKey = cellKey(activity.id, day, creneau.id);
  const closed = !!state.fermetures[closureKey];
  // Rappel du geste clic gauche/droit sur la case elle-même (08/08/2026, retour de Samir) -- en plus
  // du title déjà posé sur l'étiquette par buildVacationSpecTag() (qui explique la valeur AFFICHÉE),
  // celui-ci couvre aussi la zone vide de la case ("+ ajouter") où l'étiquette n'existe pas encore.
  td.title = "Clic gauche : spécialité structurelle (toutes les semaines). Clic droit : exception pour cette semaine uniquement.";

  if (closed) {
    td.classList.add("cell-closed");
    td.appendChild(buildFermetureTag(closureKey));
  }
  if (spec) {
    td.classList.add(`tint-${spec}`);
    td.appendChild(buildVacationSpecTag(spec, specKey, isWeeklyOverride));
  }
  if (!closed && !spec) {
    const hint = document.createElement("span");
    hint.className = "empty-hint";
    hint.textContent = "+ ajouter";
    td.appendChild(hint);
  }

  td.addEventListener("click", () => openVacationSpecPopover(specKey, td, activity, day, creneau));
  // RG-024 (08/08/2026) : clic droit = exception pour la SEMAINE AFFICHÉE uniquement, sans toucher à
  // la valeur structurelle (clic gauche, popover normal ci-dessus) -- même distinction gauche/droite
  // que le congé demi-journée (§6.40), pour un geste déjà connu.
  td.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openVacationSpecWeekMenu(specKey, e.clientX, e.clientY);
  });
  return td;
}

function buildVacationSpecTag(specKeyName, specKey, isWeeklyOverride) {
  const spec = SPECIALITES[specKeyName];
  const tag = document.createElement("span");
  tag.className = "chip vacation-spec-tag" + (isWeeklyOverride ? " vacation-spec-tag-weekly" : "");
  tag.style.cssText = `background-color:${spec.bg};color:${spec.text};`;
  tag.textContent = spec.label;
  tag.title = isWeeklyOverride
    ? "Exception pour cette semaine -- clic droit sur la case pour la modifier/retirer"
    : "Valeur structurelle (toutes les semaines)";
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = isWeeklyOverride ? "Retirer l'exception de cette semaine" : "Retirer (structurel, toutes les semaines)";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    // RG-024 : le × retire ce qui est RÉELLEMENT affiché -- l'exception de semaine si c'en est une,
    // sinon la valeur structurelle, jamais les deux à la fois.
    if (isWeeklyOverride) {
      setVacationSpecialiteForCurrentWeek(specKey, "clear");
    } else {
      delete state.vacationSpecialites[specKey];
    }
    saveState();
    render();
  });
  tag.appendChild(remove);
  return tag;
}

// RG-010 : fermeture hebdomadaire d'une vacation, indépendante de la spécialité structurelle
// (les deux coexistent -- fermer n'efface pas la spécialité "propriétaire", voir regles-gestion.md).
function buildFermetureTag(closureKey) {
  const tag = document.createElement("span");
  tag.className = "chip vacation-spec-tag fermeture-tag";
  tag.textContent = "Fermé";
  const remove = document.createElement("span");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Rouvrir";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    setFermeture(closureKey, false);
    saveState();
    render();
  });
  tag.appendChild(remove);
  return tag;
}

// Positionnement partagé par les 6 popovers de l'appli (tous réutilisent #assignPopover) -- ergonomie
// revue le 29/07/2026 (retour de Samir sur la Trame Personnel, "la liste déroulante peut s'afficher
// tout en bas et ne me permet pas de l'utiliser même si je scroll down") : sur un tableau proche de
// la hauteur de la fenêtre (§6.21), une case cliquée en bas de page plaçait le popover sous elle sans
// jamais vérifier qu'il restait dans la fenêtre -- rien ne le ramenait à l'écran, ni le scroll de la
// page (capté par le défilement interne de `.table-wrap` tant que la souris reste dessus) ni le
// scroll de la liste interne (`.popover-select-list`, qui ne fait que 220px de haut, bien plus petite
// que le dépassement réel). Fix : mesurer la taille RÉELLE du popover une fois son contenu déjà rendu
// (`renderXPopoverContent()` doit toujours être appelé AVANT), puis le basculer au-dessus de la case
// si la place manque en dessous ET qu'il y a davantage de place au-dessus -- sinon le garder en
// dessous (mieux que de le coller au bord du haut si les deux côtés sont serrés). Toujours appelé en
// dernier par chaque `open*Popover()`, à la place de la séquence dupliquée `pop.style.top/left` +
// `pop.classList.remove("hidden")`.
function positionPopover(pop, cellEl) {
  const rect = cellEl.getBoundingClientRect();
  pop.classList.remove("hidden"); // doit être visible pour mesurer sa vraie taille (display:none -> 0).
  const popRect = pop.getBoundingClientRect();
  const margin = 8;

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < popRect.height + margin && spaceAbove > spaceBelow;

  let top = flipUp
    ? window.scrollY + rect.top - popRect.height - 4
    : window.scrollY + rect.bottom + 4;
  top = Math.max(window.scrollY + margin, top); // jamais au-dessus du tout début de la page.

  let left = window.scrollX + rect.left;
  const maxLeft = window.scrollX + window.innerWidth - popRect.width - margin;
  left = Math.min(left, Math.max(window.scrollX + margin, maxLeft)); // jamais hors écran à droite/gauche.

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

// Bascule la liste déroulante interne (`.popover-select-list`, celle qui liste les personnes/modalités
// à ajouter) -- même souci que positionPopover() ci-dessus, mais pour ce second niveau : elle s'ouvre
// toujours vers le bas en CSS (`top: calc(100% + 4px)`), sans jamais vérifier la place disponible.
// Bascule vers le haut (`.popover-select-list-up`, voir style.css) si la place manque en dessous ET
// qu'il y en a davantage au-dessus du déclencheur.
function togglePopoverSelectList(trigger, list) {
  const opening = list.classList.contains("hidden");
  list.classList.toggle("hidden");
  list.classList.remove("popover-select-list-up");
  if (!opening) return;
  const triggerRect = trigger.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  if (spaceBelow < listRect.height + 8 && spaceAbove > spaceBelow) {
    list.classList.add("popover-select-list-up");
  }
}

// Annotation de semaine (08/08/2026, clic sur "Semaine du..." dans la topbar) : popover partagé
// (comme tous les autres, voir positionPopover()) avec une simple zone de texte libre, une par
// semaine (state.weekNotes, clé weekKey). Sauvegarde en direct à chaque frappe (`input`, pas de
// bouton "Enregistrer" séparé) -- saveState() est déjà debouncé (scheduleFileSave(), ~400ms), donc
// pas de coût réel à sauvegarder à chaque caractère. Contrairement aux autres popovers, ne se
// re-rend JAMAIS lui-même après une frappe (reconstruire le <textarea> via innerHTML ferait perdre
// le focus/la position du curseur en pleine saisie) -- seul renderWeekLabel() est rappelé
// directement (pas tout render(), trop coûteux à chaque caractère) pour mettre à jour la
// couleur/le survol de "Semaine du..." en direct.
function openWeekNotePopover(cellEl) {
  const pop = document.getElementById("assignPopover");
  renderWeekNotePopoverContent();
  positionPopover(pop, cellEl);
}

function renderWeekNotePopoverContent() {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "240px";
  const wk = weekKey(getMonday(state.weekOffset));
  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>Annotation</strong><br>
    <span style="font-size:12px;color:#6b7280;">${currentWeekLabel()}</span>
    <textarea id="weekNoteTextarea" class="week-note-textarea" placeholder="Notes libres pour cette semaine..."></textarea>
  `;
  const textarea = document.getElementById("weekNoteTextarea");
  // .value (jamais interpolé dans le HTML ci-dessus) : évite tout souci d'échappement si
  // l'annotation contient des caractères spéciaux (<, >, &...).
  textarea.value = state.weekNotes[wk] || "";
  textarea.addEventListener("input", () => {
    if (textarea.value.trim()) state.weekNotes[wk] = textarea.value;
    else delete state.weekNotes[wk];
    saveState();
    renderWeekLabel();
  });
  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
  textarea.focus();
}

// Colonnes/badges facultatifs de la vue Stats (08/08/2026, "toutes les colonnes soient
// facultatives... choisir colonne ou badge") : liste des métriques réglables -- Personnel n'en fait
// pas partie (toujours fixe, comme pour columnDefs/DEFAULT_STATS_COLUMN_ORDER). `hasMode` = a le
// choix Colonne/Badge. **Étendu à Astreinte/Bureau/Off le 09/08/2026** (demande de Samir : "donner ce
// choix pour tout") -- initialement réservé à Congés/Repos de garde, l'idée que "badge" n'aurait pas
// de sens pour un total/cumul comme Astreinte ne tenait pas : mêmes badges gris que Congés/Repos,
// juste sans la couleur "absence" (voir columnDefs.vacations dans 11-vue-stats.js). Seuls Total et
// Vacations restent sans `hasMode` : Total EST la colonne, Vacations EST déjà la cellule de badges.
const STATS_COLUMN_METRICS = [
  { id: "total", label: "Total" },
  { id: "vacations", label: "Vacations" },
  { id: "astreinte", label: "Astreinte", hasMode: true },
  { id: "bureau", label: "Bureau", hasMode: true },
  { id: "off", label: "Off", hasMode: true },
  { id: "conges", label: "Congés", hasMode: true },
  { id: "reposGarde", label: "Repos de garde", hasMode: true },
];

function openStatsColumnsPopover(cellEl) {
  const pop = document.getElementById("assignPopover");
  renderStatsColumnsPopoverContent();
  positionPopover(pop, cellEl);
}

function renderStatsColumnsPopoverContent() {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "230px";
  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>Colonnes affichées</strong>
    <div id="statsColumnsList" class="stats-columns-list"></div>
  `;
  const list = document.getElementById("statsColumnsList");
  STATS_COLUMN_METRICS.forEach(({ id, label, hasMode }) => {
    const row = document.createElement("div");
    row.className = "stats-columns-row";

    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "stats-columns-checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.statsColumnVisibility[id] !== false;
    checkbox.addEventListener("change", () => {
      state.statsColumnVisibility[id] = checkbox.checked;
      saveState();
      render();
      renderStatsColumnsPopoverContent();
    });
    checkboxLabel.append(checkbox, " " + label);
    row.appendChild(checkboxLabel);

    if (hasMode) {
      const modeToggle = document.createElement("div");
      modeToggle.className = "stats-columns-mode-toggle";
      [["column", "Colonne"], ["badge", "Badge"]].forEach(([mode, modeLabel]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "stats-columns-mode-btn" + (state.statsCounterMode[id] === mode ? " active" : "");
        btn.textContent = modeLabel;
        btn.addEventListener("click", () => {
          state.statsCounterMode[id] = mode;
          saveState();
          render();
          renderStatsColumnsPopoverContent();
        });
        modeToggle.appendChild(btn);
      });
      row.appendChild(modeToggle);
    }

    list.appendChild(row);
  });
  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

function openVacationSpecPopover(specKey, cellEl, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  renderVacationSpecPopoverContent(specKey, activity, day, creneau);
  positionPopover(pop, cellEl);
}

function renderVacationSpecPopoverContent(specKey, activity, day, creneau) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "";
  // RG-024 (08/08/2026) : `current` est la valeur STRUCTURELLE -- ce popover (clic gauche sur la
  // case) ne modifie et n'affiche jamais que celle-là dans sa liste d'options ; l'exception de
  // semaine (si elle existe) est affichée à part, modifiable uniquement via le clic droit sur la
  // case (openVacationSpecWeekMenu()) -- distinction volontaire pour ne jamais confondre les deux.
  const current = state.vacationSpecialites[specKey];
  const weeklyOverride = isVacationSpecialiteWeeklyOverride(activity.id, day, creneau.id)
    ? effectiveVacationSpecialite(activity.id, day, creneau.id)
    : null;
  const closureKey = cellKey(activity.id, day, creneau.id);
  const closed = !!state.fermetures[closureKey];

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${activity.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${day} — ${creneau.label}</span>
    <div id="popAssigned" class="popover-assigned"></div>
    ${weeklyOverride ? '<div class="vacation-spec-weekly-hint">Exception pour cette semaine -- clic droit sur la case pour la changer.</div>' : ""}
    <div class="popover-select-list vacation-spec-options"></div>
  `;

  const assignedContainer = document.getElementById("popAssigned");
  if (closed) {
    assignedContainer.appendChild(buildFermetureTag(closureKey));
    assignedContainer.querySelector(".fermeture-tag .remove").addEventListener("click", () =>
      renderVacationSpecPopoverContent(specKey, activity, day, creneau)
    );
  }
  if (weeklyOverride) {
    const weeklyTag = buildVacationSpecTag(weeklyOverride, specKey, true);
    assignedContainer.appendChild(weeklyTag);
    weeklyTag.querySelector(".remove").addEventListener("click", () =>
      renderVacationSpecPopoverContent(specKey, activity, day, creneau)
    );
  }
  if (current) {
    const structuralTag = buildVacationSpecTag(current, specKey, false);
    assignedContainer.appendChild(structuralTag);
    structuralTag.querySelector(".remove").addEventListener("click", () =>
      renderVacationSpecPopoverContent(specKey, activity, day, creneau)
    );
  }
  if (!closed && !current && !weeklyOverride) {
    assignedContainer.innerHTML = '<span class="empty-hint">Aucune spécialité définie pour l\'instant</span>';
  }

  const optionsList = pop.querySelector(".vacation-spec-options");
  Object.entries(SPECIALITES).forEach(([key, spec]) => {
    if (key === current) return;
    const row = document.createElement("div");
    row.className = "popover-select-option";
    row.style.cssText = `background-color:${spec.bg};color:${spec.text};`;
    row.textContent = spec.label;
    row.addEventListener("click", () => {
      // Toujours structurel -- l'exception de semaine (si présente) n'est jamais modifiée d'ici,
      // voir la note en tête de fonction.
      state.vacationSpecialites[specKey] = key;
      saveState();
      render();
      renderVacationSpecPopoverContent(specKey, activity, day, creneau);
    });
    optionsList.appendChild(row);
  });

  if (!closed) {
    // RG-010 : option "Fermé" séparée des spécialités -- écrit dans state.fermetures (hebdomadaire),
    // jamais dans vacationSpecialites (structurel). Les deux peuvent coexister.
    const closeRow = document.createElement("div");
    closeRow.className = "popover-select-option fermeture-option";
    closeRow.textContent = "Fermé";
    closeRow.addEventListener("click", () => {
      // Bug remonté par Samir le 24/07/2026 : fermer une case ne dépostait personne -- la personne
      // restait dans state.assignments (juste masquée visuellement), donc encore comptée "postée"
      // partout où l'app lit effectiveAssignedIds() directement sans vérifier state.fermetures (ex.
      // le filtre "Focus jour/créneau", §6.17). Fix : fermer = matérialiser la case à vide, EXACTEMENT
      // comme si on avait retiré chaque personne à la main (×) -- ne touche jamais state.trame.
      // Voir setFermeture() pour le détail (et le verrouillage de semaine, 29/07/2026).
      setFermeture(closureKey, true);
      saveState();
      render();
      renderVacationSpecPopoverContent(specKey, activity, day, creneau);
    });
    optionsList.appendChild(closeRow);
  }

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

