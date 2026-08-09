// ---------- Vue Congés ----------
// Personnes en colonnes (groupées séniors -> internes spécialisés -> internes socle, filtrées par
// les mêmes puces que le panneau Personnel via personMatchesFilters()), semaines du trimestre
// affiché en lignes. Une case verte = absent(e) toute la semaine (Lundi-Vendredi), jaune = certains
// jours seulement (détail au survol). Clic sur une case = déclarer/retirer un congé (popover).

function renderCongesView() {
  const container = document.getElementById("congesView");
  container.innerHTML = "";

  const nav = document.createElement("div");
  nav.className = "conges-nav";

  const yearNav = document.createElement("div");
  yearNav.className = "week-nav";
  const prevYear = document.createElement("button");
  prevYear.textContent = "←";
  prevYear.title = "Année précédente";
  prevYear.addEventListener("click", () => {
    congesYear -= 1;
    render();
  });
  const yearLabel = document.createElement("span");
  yearLabel.textContent = congesYear;
  const nextYear = document.createElement("button");
  nextYear.textContent = "→";
  nextYear.title = "Année suivante";
  nextYear.addEventListener("click", () => {
    congesYear += 1;
    render();
  });
  yearNav.append(prevYear, yearLabel, nextYear);
  nav.appendChild(yearNav);

  const tabs = document.createElement("div");
  tabs.className = "quarter-tabs";
  [1, 2, 3, 4].forEach((q) => {
    const btn = document.createElement("button");
    btn.textContent = "T" + q;
    btn.className = "quarter-tab" + (q === congesQuarter ? " active" : "");
    btn.addEventListener("click", () => {
      congesQuarter = q;
      render();
    });
    tabs.appendChild(btn);
  });
  nav.appendChild(tabs);
  container.appendChild(nav);

  const people = state.staff.filter(personMatchesFilters).slice().sort(compareStaffOrder);
  const firstInterneIdx = people.findIndex((p) => !p.horsSisu && p.grade !== "senior");
  const firstSocleIdx = people.findIndex((p) => !p.horsSisu && p.grade !== "senior" && (p.specialites || []).length === 0);
  // RG-016 : séparateur supplémentaire avant le groupe Hors Sisu (visible seulement si la puce
  // "Hors Sisu" est cochée, sinon findIndex renvoie -1 et ne matche jamais).
  const firstHorsSisuIdx = people.findIndex((p) => p.horsSisu);
  const boundaryClass = (i) => (i === firstInterneIdx || i === firstSocleIdx || i === firstHorsSisuIdx ? " conges-group-start" : "");

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "conges-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const congesCornerTh = document.createElement("th");
  congesCornerTh.className = "corner-cell";
  headRow.appendChild(congesCornerTh);
  const personHeaderCells = []; // parallèle à `people`, pour surligner la colonne au survol d'une case.
  people.forEach((p, i) => {
    const th = document.createElement("th");
    th.className = "conges-person-header" + boundaryClass(i);
    // Même code couleur que partout ailleurs dans l'appli (chips, colonne nom de la vue
    // Personnel) -- voir personCellStyle(). Sur le <th> lui-même (pas le span pivoté), pour
    // garder un fond rectangulaire propre malgré la rotation du texte.
    th.style.cssText = personCellStyle(p);
    const span = document.createElement("span");
    span.textContent = personAcronym(p);
    span.title = personTooltip(p);
    th.appendChild(span);
    headRow.appendChild(th);
    personHeaderCells.push(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (people.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty-hint";
    td.textContent = "Aucune personne ne correspond aux filtres sélectionnés.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // Semaine en cours (indépendante de state.weekOffset -- toujours "aujourd'hui", voir getMonday()),
  // pour surligner en vert la ligne correspondante (repère "on est ici" -- demandé le 21/07/2026).
  const todayMondayIso = toISODateLocal(getMonday(0));
  const weeks = quarterWeeks(congesYear, congesQuarter);

  // Regroupement visuel par mois (même principe que les blocs Scan U/Echo U du planning
  // principal, voir .group-start/.group-end dans style.css) : grosse bordure quand le mois de la
  // semaine change, rien entre deux semaines du même mois. Le mois retenu est celui du lundi.
  let prevMonthKey = null;

  weeks.forEach((monday) => {
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const isCurrentWeek = toISODateLocal(monday) === todayMondayIso;

    const monthKey = `${monday.getFullYear()}-${monday.getMonth()}`;
    const isNewMonth = prevMonthKey !== null && monthKey !== prevMonthKey;
    prevMonthKey = monthKey;

    const tr = document.createElement("tr");
    if (isNewMonth) tr.classList.add("group-start");
    const label = document.createElement("td");
    label.className = "conges-week-label" + (isCurrentWeek ? " conges-current-week" : "");
    label.textContent = `${formatShort(monday)} → ${formatShort(friday)}`;
    tr.appendChild(label);

    people.forEach((p, i) => {
      const td = document.createElement("td");
      td.className = "slot-cell conges-cell" + boundaryClass(i);
      // Congé / garde / repos de garde (RG-013) mélangés dans la même case, jour par jour -- voir
      // buildAbsenceBar() (4.8/4.9 CLAUDE.md), partagée avec le bandeau congés du planning (6.11).
      const bar = buildAbsenceBar(p, monday);
      if (bar) td.appendChild(bar);
      td.addEventListener("click", () => openCongePopover(p, monday, td));
      // Surligne l'en-tête de ligne (semaine) et de colonne (personne) au survol, pour se repérer
      // dans le tableau sans avoir à remonter des yeux jusqu'aux bords (demandé le 22/07/2026).
      td.addEventListener("mouseenter", () => {
        label.classList.add("conges-highlight");
        personHeaderCells[i].classList.add("conges-highlight");
      });
      td.addEventListener("mouseleave", () => {
        label.classList.remove("conges-highlight");
        personHeaderCells[i].classList.remove("conges-highlight");
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);

  sizeCongesRows(weeks.length);
}

// Calcule la hauteur de ligne qui fait tenir tout le trimestre (nav + en-tête + les `rowCount`
// lignes de semaine) dans la fenêtre visible, sans scroll vertical -- et la plus haute possible
// dans cette limite (demandé par Samir le 21/07/2026, plutôt qu'une valeur fixe devinée). Une
// ligne chargée (ex. 4 jours différents empilés dans une case jaune) peut malgré tout dépasser
// cette hauteur : `height` sur une <tr> est un minimum, pas un maximum, le contenu prime.
function sizeCongesRows(rowCount) {
  const container = document.getElementById("congesView");
  const table = container.querySelector(".conges-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  if (!tbody || rowCount === 0) return;

  const margin = 8; // petite marge en bas de fenêtre, pour ne pas coller au bord
  const topOffset = container.getBoundingClientRect().top;
  const headerHeight = thead.getBoundingClientRect().height;
  const available = window.innerHeight - topOffset - headerHeight - margin;
  const minRowHeight = 20; // plancher pour rester cliquable/lisible même avec beaucoup de semaines
  let rowHeight = Math.max(minRowHeight, Math.floor(available / rowCount));

  const applyHeight = (h) => {
    [...tbody.children].forEach((tr) => {
      tr.style.height = `${h}px`;
    });
  };
  applyHeight(rowHeight);

  // Ajustement empirique : bordures collapsées + arrondis font dériver le résultat de quelques
  // px, difficile à prédire précisément à l'avance -- on mesure le dépassement réel après un
  // premier passage et on corrige d'un coup plutôt que de deviner une constante.
  const overshoot = table.getBoundingClientRect().bottom - (window.innerHeight - margin);
  if (overshoot > 0 && rowHeight > minRowHeight) {
    const correction = Math.ceil(overshoot / rowCount);
    rowHeight = Math.max(minRowHeight, rowHeight - correction);
    applyHeight(rowHeight);
  }
}

let congesResizeTimer = null;
window.addEventListener("resize", () => {
  if (!editingConges) return;
  clearTimeout(congesResizeTimer);
  congesResizeTimer = setTimeout(() => renderCongesView(), 150);
});

function openCongePopover(person, monday, cellEl) {
  const pop = document.getElementById("assignPopover");
  renderCongePopoverContent(person, monday);
  positionPopover(pop, cellEl);
}

// Popover de la vue Congés (22/07/2026) : plus de saisie par plage de dates -- un bouton "Toute la
// semaine en congé" pour l'ajout/retrait rapide, puis deux rangées de pilules jour par jour (Congé
// / Garde, une pilule par jour ouvré de la semaine cliquée). Une pilule active (couleur pleine) se
// désactive au clic, une inactive (grise) s'active -- pas de bouton "Ajouter" séparé, chaque clic
// est immédiat. Popover élargi (`pop.style.minWidth`) pour que "Lun 13" etc. tienne sur une seule
// ligne dans chaque pilule -- remis à vide dans les 3 autres popovers de l'appli (voir leurs
// fonctions renderXxxPopoverContent), sinon la largeur resterait collée après une ouverture ici.
function renderCongePopoverContent(person, monday) {
  const pop = document.getElementById("assignPopover");
  pop.style.minWidth = "300px";
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const weekDays = DAYS.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { iso: toISODateLocal(d), label: `${day.slice(0, 3)} ${d.getDate()}` };
  });

  // Bouton "Toute la semaine" en toggle (pas juste un ajout à sens unique) : si les 5 jours sont
  // déjà en congé, le même bouton les retire tous -- sinon il faudrait décocher les 5 pilules une
  // par une pour annuler un ajout "toute la semaine" fait par erreur (retour Samir 22/07/2026).
  const weekFullyOn = weekDays.every(({ iso }) => isOnCongeDay(person.id, iso));

  pop.innerHTML = `
    <span class="close-btn" id="popClose">×</span>
    <strong>${person.prenom} ${person.nom}</strong><br>
    <span style="font-size:12px;color:#6b7280;">${formatShort(monday)} → ${formatShort(friday)}</span>
    <button type="button" id="congeWeekBtn" class="conge-week-btn${weekFullyOn ? " active" : ""}">${weekFullyOn ? "Retirer toute la semaine" : "Toute la semaine en congé"}</button>
    <div class="conge-pill-group">
      <div class="conge-pill-label">Congé</div>
      <div class="conge-pill-row" id="congePillRow"></div>
    </div>
    <div class="conge-pill-group">
      <div class="conge-pill-label">Garde</div>
      <div class="conge-pill-row" id="gardePillRow"></div>
    </div>
  `;

  const congeRow = document.getElementById("congePillRow");
  const gardeRow = document.getElementById("gardePillRow");

  // RG-013 (24/07/2026, retour de Samir) : une garde le dimanche génère un repos de garde le lundi
  // (jour calendaire suivant), mais DAYS s'arrête au lundi -- sans cette pilule, aucun moyen de
  // déclarer cette garde-là, donc le repos du lundi ne pouvait jamais être affiché. Garde
  // UNIQUEMENT (pas de pilule Congé équivalente : un congé isolé le dimanche ne serait affiché
  // nulle part, aucune colonne ne le montrerait, contrairement à la garde qui a un effet visible
  // via le repos du lendemain). Placée avant "Lun" dans la rangée Garde, chronologiquement en tête.
  const sundayDate = new Date(monday);
  sundayDate.setDate(monday.getDate() - 1);
  const sundayIso = toISODateLocal(sundayDate);
  const sundayGardeBtn = document.createElement("button");
  sundayGardeBtn.type = "button";
  sundayGardeBtn.className = "conge-pill conge-pill-garde" + (isOnGardeDay(person.id, sundayIso) ? " active" : "");
  sundayGardeBtn.textContent = `Dim ${sundayDate.getDate()}`;
  sundayGardeBtn.title = "Garde du dimanche -- génère le repos de garde du lundi";
  sundayGardeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGardeDay(person.id, sundayIso);
    saveState();
    render();
    renderCongePopoverContent(person, monday);
  });
  gardeRow.appendChild(sundayGardeBtn);

  weekDays.forEach(({ iso, label }) => {
    // Demi-journée (05/08/2026) : la pilule reste un clic gauche = journée entière (inchangé), mais
    // affiche un " ½" + bordure en tirets si le jour n'est couvert que par une seule moitié -- clic
    // droit pour choisir (voir openCongeHalfDayMenu()). congeRecord() relit l'enregistrement courant
    // (pas juste un booléen) pour connaître son demiJournee éventuel.
    const congeRecord = state.conges.find((c) => congeCoversDay(c, person.id, iso));
    const half = congeRecord ? congeRecord.demiJournee : null;
    const congeBtn = document.createElement("button");
    congeBtn.type = "button";
    congeBtn.className = "conge-pill conge-pill-conge" + (congeRecord ? " active" : "") + (half ? " conge-pill-half" : "");
    congeBtn.textContent = half ? `${label} ½` : label;
    congeBtn.title = half
      ? `Congé ${half === "matin" ? "matin" : "après-midi"} uniquement -- clic droit pour modifier`
      : "Clic droit pour ne poser qu'une demi-journée";
    // stopPropagation() : sans ça, le clic remonte jusqu'au gestionnaire global document (voir plus
    // bas dans le fichier) APRÈS que renderCongePopoverContent() a déjà remplacé pop.innerHTML --
    // le bouton d'origine se retrouve détaché du DOM, donc `pop.contains(e.target)` renvoie false et
    // le popover se referme tout seul juste après chaque clic. Bug réel rencontré le 22/07/2026 (le
    // popover se fermait après chaque pilule, rendant la suppression d'un congé quasi impossible).
    congeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isOnCongeDay(person.id, iso)) removeCongeDay(person.id, iso);
      else addCongeDay(person.id, iso);
      saveState();
      render();
      renderCongePopoverContent(person, monday);
    });
    // Clic droit (05/08/2026, congé demi-journée -- Samir a choisi ce geste pour ne rien changer au
    // clic gauche existant ni ajouter d'élément visuel permanent au popover, "rare mais ça arrive").
    congeBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCongeHalfDayMenu(person, iso, e.clientX, e.clientY, () => renderCongePopoverContent(person, monday));
    });
    congeRow.appendChild(congeBtn);

    const gardeBtn = document.createElement("button");
    gardeBtn.type = "button";
    gardeBtn.className = "conge-pill conge-pill-garde" + (isOnGardeDay(person.id, iso) ? " active" : "");
    gardeBtn.textContent = label;
    gardeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGardeDay(person.id, iso);
      saveState();
      render();
      renderCongePopoverContent(person, monday);
    });
    gardeRow.appendChild(gardeBtn);
  });

  document.getElementById("congeWeekBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (weekFullyOn) {
      weekDays.forEach(({ iso }) => removeCongeDay(person.id, iso));
    } else {
      weekDays.forEach(({ iso }) => addCongeDay(person.id, iso));
    }
    saveState();
    render();
    renderCongePopoverContent(person, monday);
  });

  document.getElementById("popClose").addEventListener("click", () => pop.classList.add("hidden"));
}

// Menu contextuel (clic droit) sur une pilule Congé -- 3 choix + Retirer (05/08/2026, congé demi-
// journée : "rare mais ça arrive", Samir a choisi le clic droit pour ne rien changer au clic gauche
// existant ni ajouter d'élément visuel permanent au popover). Réutilise le look de .dropdown-menu
// (#moreMenu) mais en position fixed, positionné aux coordonnées du clic (comme un menu contextuel
// natif) -- pas ancré à un parent positionné comme #moreMenu. Fermé au choix ou au clic extérieur
// (voir le gestionnaire global document plus bas).
function openCongeHalfDayMenu(person, iso, x, y, onChange) {
  const menu = document.getElementById("congeHalfDayMenu");
  const current = state.conges.find((c) => congeCoversDay(c, person.id, iso));
  const currentState = current ? (current.demiJournee || "full") : null;

  menu.innerHTML = "";
  [
    { key: "full", label: "Journée entière" },
    { key: "matin", label: "Matin seul" },
    { key: "apres-midi", label: "Après-midi seul" },
  ].forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = (currentState === key ? "✓ " : "") + label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCongeHalfDay(person.id, iso, key === "full" ? null : key);
      saveState();
      render();
      onChange();
      menu.classList.add("hidden");
    });
    menu.appendChild(btn);
  });

  if (current) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Retirer";
    clearBtn.style.color = "#b91c1c";
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCongeHalfDay(person.id, iso, "clear");
      saveState();
      render();
      onChange();
      menu.classList.add("hidden");
    });
    menu.appendChild(clearBtn);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");
}

// RG-024 (08/08/2026) : menu contextuel (clic droit sur une case Trame Vacation) pour poser une
// exception de spécialité PROPRE À LA SEMAINE AFFICHÉE, sans toucher à la valeur structurelle --
// même patron que openCongeHalfDayMenu() (même élément partagé #congeHalfDayMenu, générique malgré
// son nom historique), même distinction gauche/droite que le congé demi-journée. Contrairement à ce
// dernier, pas de callback onChange() séparé à rappeler : le clic droit agit directement sur la
// grille (pas depuis un popover déjà ouvert), un simple render() après coup suffit à tout rafraîchir.
function openVacationSpecWeekMenu(specKey, x, y) {
  const menu = document.getElementById("congeHalfDayMenu");
  const wk = weekKey(getMonday(state.weekOffset));
  const weeklyKey = `${wk}|${specKey}`;
  const hasOverride = Object.prototype.hasOwnProperty.call(state.vacationSpecialitesWeekly, weeklyKey);
  const currentOverride = state.vacationSpecialitesWeekly[weeklyKey];

  menu.innerHTML = "";
  Object.entries(SPECIALITES).forEach(([key, spec]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = (hasOverride && currentOverride === key ? "✓ " : "") + spec.label + " (cette semaine)";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setVacationSpecialiteForCurrentWeek(specKey, key);
      saveState();
      render();
      menu.classList.add("hidden");
    });
    menu.appendChild(btn);
  });

  if (hasOverride) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Retirer l'exception";
    clearBtn.style.color = "#b91c1c";
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setVacationSpecialiteForCurrentWeek(specKey, "clear");
      saveState();
      render();
      menu.classList.add("hidden");
    });
    menu.appendChild(clearBtn);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");
}

