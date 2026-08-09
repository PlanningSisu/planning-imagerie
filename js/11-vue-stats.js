// ---------- Vue Stats (24/07/2026) ----------
// But : voir en un coup d'œil si la répartition des vacations est équitable sur la semaine
// affichée. Même structure de lignes que la vue Personnel (personMatchesFilters()/compareStaffOrder()),
// mais les colonnes Jour x Créneau sont remplacées par un total + des badges par "famille" de
// modalité, regroupés par COULEUR de spécialité (demande explicite de Samir) plutôt que par type.

const STATS_FAMILY_LABELS = { scan: "Scan", irm: "IRM", ecn: "ECN", mammo: "Mammo" };
const STATS_TYPE_ORDER = ["Scan", "IRM", "ECN", "Mammo"];

// Scan A/B, IRM 1.5T/3T et ECN 1/2 doivent être fusionnés ("on s'en fiche de savoir si c'est A ou
// B") -- réutilise le champ `group` déjà existant sur ACTIVITIES (ex. "scan-start"/"scan-end") en
// retirant son suffixe, plutôt que d'inventer un nouveau mapping. Mammo n'a pas de `group` (une
// seule modalité, pas de fusion nécessaire) -- retombe sur son id.
function activityStatsFamily(activity) {
  return activity.group ? activity.group.replace(/-(start|end)$/, "") : activity.id;
}

// Parcourt toutes les cases de la semaine donnée et compte, par personne, un badge par (famille,
// spécialité) -- Scan U/Echo U (activity.urgence) restent toujours à part, jamais fusionnés, sans
// notion de spécialité (demande explicite de Samir : "en rouge, pas flashy", voir statBadgeClass()).
// Une case fermée (RG-010) ne compte jamais : rien n'a réellement été fait dessus cette semaine-là.
// `days` (Set des jours DAYS couverts par au moins une assignation, toutes activités/créneaux
// confondus) alimente le regroupement par disponibilité de renderStatsView() (24/07/2026, voir
// statsAvailabilityTier()) -- pas juste `total`, qui ne dit rien de la répartition dans la semaine
// (5 vacations le même jour vs 1 par jour ont le même total mais pas la même disponibilité).
//
// Bureau/Off (24/07/2026, demande de Samir) : colonnes dédiées dans la vue Stats, comme l'astreinte
// -- ne comptent JAMAIS dans `total` ni dans `badges`/`days`, et ne fusionnent plus entre elles en un
// seul badge "Bureau" (comportement d'avant ce changement). `bureau` compte un point par créneau
// (matin/après-midi) posté sur la modalité Bureau cette semaine ; `off` de même pour Off -- Off n'a
// jamais de créneau astreinte (RG-012/isCreneauApplicable), donc ce compte est déjà "à la demi-
// journée près" par construction (1 point = 1 créneau = une demi-journée), sans calcul supplémentaire.
function computeVacationStatsForWeek(monday) {
  const stats = new Map(); // staffId -> { total, badges: Map(groupKey -> {count, label, specialite, isUrgence, activityId}), days: Set, bureau, off, astreinte }

  const ensureEntry = (staffId) => {
    if (!stats.has(staffId)) stats.set(staffId, { total: 0, badges: new Map(), days: new Set(), bureau: 0, off: 0, astreinte: 0 });
    return stats.get(staffId);
  };

  state.activities.forEach((activity) => {
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return;
        const assigned = effectiveAssignedIds(key).filter(Boolean);
        if (assigned.length === 0) return;

        // Harmonisé le 08/08/2026 (retour de Samir, "le mode Période couvre déjà le besoin de cumul,
        // simplifie et harmonise") : l'astreinte comptait auparavant un CUMUL multi-semaines calculé
        // à part (computePastAstreinteCounts(), retirée) -- elle compte désormais juste la semaine
        // affichée, exactement comme Bureau/Off, exactement comme en mode Période (entry.astreinte,
        // voir computeVacationStatsForPeriod()). Toujours exclue du total/des badges/de
        // statsAvailabilityTier() (qui ne doit jamais en tenir compte, voir sa déclaration).
        if (creneau.id === "astreinte") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).astreinte++;
          });
          return;
        }

        if (activity.id === "bureau") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).bureau++;
          });
          return;
        }
        if (activity.id === "off") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).off++;
          });
          return;
        }

        let groupKey, label, specialite, isUrgence;
        if (activity.urgence) {
          groupKey = `urgence:${activity.id}`;
          label = activity.nom;
          specialite = null;
          isUrgence = true;
        } else {
          const family = activityStatsFamily(activity);
          specialite = effectiveVacationSpecialiteForWeek(activity.id, day, creneau.id, weekKey(monday)) || null; // RG-024
          groupKey = `${family}:${specialite || "none"}`;
          label = STATS_FAMILY_LABELS[family] || activity.nom;
          isUrgence = false;
        }

        assigned.forEach((staffId) => {
          if (!staffById(staffId)) return; // id orphelin (personne supprimée depuis) -- ignoré comme partout ailleurs.
          const entry = ensureEntry(staffId);
          entry.total++;
          entry.days.add(day);
          if (!entry.badges.has(groupKey)) {
            entry.badges.set(groupKey, { count: 0, label, specialite, isUrgence, activityId: activity.id });
          }
          entry.badges.get(groupKey).count++;
        });
      });
    });
  });

  return stats;
}

// Colonne "Astreinte" de la vue Stats -- jusqu'au 08/08/2026, ce n'était PAS un décompte de la seule
// semaine affichée en mode Semaine mais un CUMUL multi-semaines calculé à part
// (computePastAstreinteCounts(), avec repli trame dédié) -- retiré (retour de Samir : "le mode
// Période couvre déjà le besoin de cumul, simplifie et harmonise"). L'astreinte compte désormais la
// semaine affichée comme n'importe quelle autre colonne, exactement comme Bureau/Off -- voir
// `entry.astreinte` dans computeVacationStatsForWeek()/computeVacationStatsForPeriod(), les deux
// désormais symétriques. Pour un cumul sur plusieurs semaines, utiliser le mode Période avec une
// plage large.

// Regroupement par disponibilité (24/07/2026, demande de Samir) : au-delà du tri habituel
// (compareStaffOrder -- grade/spécialité/alphabétique), les lignes de la vue Stats sont d'abord
// réparties en 3 blocs :
// 0 (haut) = a AU MOINS UNE vacation cette semaine, peu importe combien de jours couverts ;
// 1 (milieu) = aucune vacation du tout cette semaine, et PAS en congé -- vraiment libre, à solliciter ;
// 2 (tout en bas) = en congé toute la semaine (`isFullyOnLeaveThisWeek()`) -- hors-jeu cette semaine,
//     un total à 0 ici ne veut pas dire "libre" comme pour le bloc 1, ne pas les mélanger. Vérifié EN
//     PREMIER, avant le nombre de jours couverts : un congé toute la semaine prime sur n'importe quel
//     décompte de vacations (en pratique déjà 0, RG-014 empêchant l'assignation via la vue Personnel,
//     mais le popover d'ajout reste une porte de sortie).
// **Revu le 24/07/2026 (même jour, retour de Samir) : l'ancien 4e bloc ("postée tous les jours",
// qui passait APRÈS le bloc "aucune vacation") est retiré.** Il faisait remonter des personnes
// entièrement libres au-dessus de personnes avec 8-9 vacations dans la semaine -- contraire à la
// demande explicite : "toutes les personnes qui ont des vacations doivent être en haut", peu
// importe si la semaine est complète ou pas. Les 2 anciens blocs (partiel + complet) sont donc
// fusionnés en un seul bloc 0 ; le tri habituel (compareStaffOrder) s'applique ensuite à l'intérieur
// de ce bloc comme des 2 autres, exactement comme avant.
// **Revu une 2e fois le 24/07/2026 (retour de Samir, suite à la séparation des colonnes Bureau/Off,
// voir 6.16) : "avoir des données" ne se limite plus aux badges Vacations.** Depuis que Bureau/Off
// sont sortis du calcul de `days`/`total` (leur propre colonne, jamais dans les badges), quelqu'un
// avec UNIQUEMENT du Bureau ou de l'Off cette semaine (aucun vrai badge Vacations) retombait à tort
// dans le bloc 1 ("vraiment libre"), mélangé par le tri habituel avec des personnes qui n'ont
// STRICTEMENT rien -- confirmé sur une vraie capture d'écran (des personnes avec Bureau=1 ou Off=1
// intercalées parmi des lignes à 0 partout). Fix : le bloc 0 regarde maintenant aussi `entry.bureau`/
// `entry.off`, pas seulement `entry.days` -- Bureau/Off comptent comme "des données" même s'ils ne
// produisent pas de badge. **L'astreinte reste volontairement exclue** de ce calcul (voir plus haut,
// "jamais prise en compte pour des questions d'ordre", demande antérieure de Samir toujours valable)
// -- c'est un cumul historique, pas un signal de disponibilité de la semaine affichée.
// `stats` est le résultat de computeVacationStatsForWeek(), déjà calculé une fois par rendu.
function statsAvailabilityTier(person, stats) {
  if (isFullyOnLeaveThisWeek(person)) return 2;
  const entry = stats.get(person.id);
  const hasData = entry && (entry.days.size > 0 || entry.bureau > 0 || entry.off > 0);
  return hasData ? 0 : 1;
}

// Ordre des badges d'une personne : le rouge (urgences, sans spécialité) toujours en premier, puis
// regroupés par COULEUR dans l'ordre canonique des spécialités (SPECIALITE_ORDER, le même partout
// ailleurs dans l'appli) -- pas par type de modalité. Demande explicite de Samir le 24/07/2026 :
// repérer d'un coup d'œil qui fait beaucoup d'une même spécialité, peu importe sur quelle modalité.
// À couleur égale, Scan avant IRM avant ECN avant Mammo (STATS_TYPE_ORDER).
function sortedStatsBadges(entry) {
  const list = [...entry.badges.values()];
  list.sort((a, b) => {
    if (a.isUrgence !== b.isUrgence) return a.isUrgence ? -1 : 1;
    if (a.isUrgence) {
      return state.activities.findIndex((x) => x.id === a.activityId) - state.activities.findIndex((x) => x.id === b.activityId);
    }
    const aIdx = a.specialite ? SPECIALITE_ORDER.indexOf(a.specialite) : SPECIALITE_ORDER.length;
    const bIdx = b.specialite ? SPECIALITE_ORDER.indexOf(b.specialite) : SPECIALITE_ORDER.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return STATS_TYPE_ORDER.indexOf(a.label) - STATS_TYPE_ORDER.indexOf(b.label);
  });
  return list;
}

// Réutilise les classes de couleur déjà existantes : .chip.spec-xxx pour une spécialité connue, le
// rouge "urgence" déjà utilisé ailleurs (.modalite-tag.urgence-tag) pour Scan U/Echo U, .spec-none
// (gris) pour une vacation sans spécialité propriétaire renseignée -- aucune nouvelle couleur créée
// pour cette vue, tout est déjà cohérent avec le reste de l'appli.
function statBadgeClass(badge) {
  if (badge.isUrgence) return "chip modalite-tag urgence-tag";
  if (!badge.specialite) return "chip spec-none";
  return `chip spec-${badge.specialite}`;
}

// Lundi de la semaine contenant `d` (24/07/2026, mode "Période") -- même logique que getMonday(),
// mais pour une date arbitraire au lieu de "aujourd'hui + un décalage de semaines". Nécessaire pour
// convertir une date quelconque d'une période choisie vers la même weekKey que celle utilisée par
// cellKey()/le reste de l'appli (state.assignments est toujours keyé par semaine, jamais par date).
function mondayOfDate(d) {
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() + diffToMonday);
  return monday;
}

// Jours ouvrés (Lundi-Vendredi) entre deux dates ISO incluses (mode "Période", 24/07/2026), avec le
// nom de jour et la weekKey correspondante déjà calculés -- pour construire directement les mêmes
// clés que cellKey() sans repasser par state.weekOffset (sans objet ici, une période peut mélanger
// semaines passées et futures).
function isoWeekdaysInRange(startIso, endIso) {
  const result = [];
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    const dow = cursor.getDay(); // 0 = dimanche ... 6 = samedi
    if (dow >= 1 && dow <= 5) {
      result.push({
        iso: toISODateLocal(cursor),
        dayName: DAYS[dow - 1],
        weekKeyPart: weekKey(mondayOfDate(cursor)),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// Période par défaut à la première bascule en mode "Période" (24/07/2026) : le mois en cours
// ("un mois par exemple", demande de Samir) -- dernier jour du mois via le "jour 0" du mois suivant,
// un idiome standard pour ne pas recalculer le nombre de jours du mois à la main.
function defaultStatsPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end) };
}

// Équivalent de effectiveAssignedIds(), mais pour une semaine ARBITRAIRE (pas forcément celle
// affichée dans le planning principal) -- 29/07/2026, bug remonté par Samir : le mode "Période"
// (voir computeVacationStatsForPeriod() juste en dessous) lisait state.assignments à sec, sans
// jamais retomber sur la trame, alors que le mode "Semaine" (via effectiveAssignedIds()) le fait
// pour la semaine actuelle/future -- résultat, une même période choisie dans les deux modes donnait
// des totaux différents (ex. Off/Bureau posés seulement dans la trame de Dubois : visibles en mode
// Semaine sur la semaine du 27/07, disparus en mode Période sur cette même semaine). Cause racine :
// effectiveAssignedIds() teste `state.weekOffset >= 0` (la semaine AFFICHÉE dans le planning
// principal), une notion sans rapport avec une semaine arbitraire parcourue ici -- le mode Période
// itère potentiellement plusieurs semaines (passées ET futures) dans une même plage, donc un seul
// flag global ne peut pas trancher correctement pour chacune. Cette variante compare directement la
// weekKey de la semaine en question à celle de la semaine réelle actuelle (comparaison de chaînes
// ISO, comme partout ailleurs dans le fichier) -- chaque semaine de la période reçoit donc sa propre
// décision, correcte même quand la plage mélange passé et futur.
// RG-023 (05/08/2026) : même filtre d'absence que effectiveAssignedIds() ci-dessus, voir
// filterAbsentFromTrame() -- iso calculé pour LA semaine `weekKeyPart` (pas state.weekOffset,
// sans rapport ici) via son propre lundi.
function effectiveAssignedIdsForWeek(key, weekKeyPart) {
  if (Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    return state.assignments[key];
  }
  if (weekKeyPart >= weekKey(getMonday(0))) {
    const [, day, creneauId] = trameKeyFromCellKey(key).split("|");
    const iso = weekIsoDates(mondayFromWeekKey(weekKeyPart))[DAYS.indexOf(day)];
    return filterAbsentFromTrame(state.trame[trameKeyFromCellKey(key)] || [], iso, creneauId);
  }
  return [];
}

// Équivalent de ensureMaterializedAssignments(), mais pour une semaine ARBITRAIRE -- même besoin
// que effectiveAssignedIdsForWeek() juste au-dessus (29/07/2026, voir depostAssignmentsForReposGardeDay()
// plus bas) : ensureMaterializedAssignments() d'origine dépend de state.weekOffset (la semaine
// affichée), donc incorrecte si on matérialise une case pour une semaine différente de celle-là.
function ensureMaterializedAssignmentsForWeek(key, weekKeyPart) {
  if (isWeekLocked(weekKeyPart)) return []; // verrouillage (29/07/2026), voir ensureMaterializedAssignments().
  if (!Object.prototype.hasOwnProperty.call(state.assignments, key)) {
    state.assignments[key] = effectiveAssignedIdsForWeek(key, weekKeyPart).slice();
  }
  return state.assignments[key];
}

// Compteur de "manquants" en vue Stats (05/08/2026, demande de Samir : "un compteur qui m'indique
// si j'ai oublié de poster quelqu'un"). Ignore TOUJOURS l'astreinte (ni dans le total attendu ni
// dans le décompte, cohérent avec le reste de la vue Stats, voir computeVacationStatsForWeek()) --
// seuls matin/après-midi sont considérés, 10 créneaux possibles par semaine.
// Un créneau est :
// - EXCUSÉ (retiré du total attendu) s'il est couvert par un congé ou un repos de garde
//   (isPersonAbsentOnIsoSlot(), RG-014). Un jour de garde, lui, ne change RIEN au compteur --
//   confirmé explicitement par Samir (05/08/2026) : la garde ne remplace pas les 2 demi-journées
//   normales attendues ce jour-là, donc aucune vérification dédiée à state.gardes ici.
// - COUVERT s'il y a une vraie affectation (n'importe quelle activité, Bureau/Off compris) OU un
//   Temps Partiel marqué dessus -- "Temps Partiel compte comme une vacation", demande explicite.
// - MANQUANT sinon (ni excusé, ni couvert) : c'est ce qui remonte, un objet {day, creneauId} par
//   créneau manquant.
// `{iso, dayName, weekKeyPart}` : même triple que produit isoWeekdaysInRange(), pour rester
// indépendant de state.weekOffset (utilisable aussi bien pour la semaine affichée que pour une
// période arbitraire en mode "Période").
function missingSlotsForDate(staffId, { iso, dayName, weekKeyPart }) {
  const missing = [];
  ["matin", "apres-midi"].forEach((creneauId) => {
    if (isPersonAbsentOnIsoSlot(staffId, iso, creneauId)) return;
    if (isPersonTPOnSlot(staffId, dayName, creneauId)) return;
    const covered = state.activities.some((activity) => {
      if (!isCreneauApplicable(activity.id, creneauId)) return false;
      const key = `${weekKeyPart}|${activity.id}|${dayName}|${creneauId}`;
      if (state.fermetures[key]) return false;
      return effectiveAssignedIdsForWeek(key, weekKeyPart).includes(staffId);
    });
    if (!covered) missing.push({ day: dayName, creneauId, iso });
  });
  return missing;
}

// Colonnes/badges "Congés"/"Repos de garde" de la vue Stats (08/08/2026, demande de Samir). Comptées
// en JOURS sur une liste de dates ISO -- un congé journée entière vaut 1, une demi-journée (RG-014)
// vaut 0,5 ; un repos de garde (RG-013, toujours journée entière) vaut toujours 1. `isoList` est la
// même liste que celle utilisée pour le compteur de "manquants" (missingDaysList.map(d => d.iso)),
// valable aussi bien en mode Semaine qu'en mode Période.
function congeDaysCountForRange(staffId, isoList) {
  let total = 0;
  isoList.forEach((iso) => {
    const matin = congeCoversSlot(staffId, iso, "matin");
    const aprem = congeCoversSlot(staffId, iso, "apres-midi");
    if (matin && aprem) total += 1;
    else if (matin || aprem) total += 0.5;
  });
  return total;
}

function reposGardeDaysCountForRange(staffId, isoList) {
  return isoList.filter((iso) => isOnReposGardeDay(staffId, iso)).length;
}

// Formate un nombre de jours pour l'affichage -- entier tel quel, décimal en virgule française
// ("2,5" plutôt que "2.5") pour une demi-journée de congé.
function formatDaysCount(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

// Équivalent de computeVacationStatsForWeek() pour le mode "Période" (24/07/2026) -- même forme de
// résultat (avec `astreinte` en plus directement dans l'entrée, voir plus bas). Consulte désormais la
// trame via effectiveAssignedIdsForWeek() ci-dessus (29/07/2026, voir son commentaire) exactement
// comme le mode Semaine, pour que les deux modes restent cohérents sur une même période.
function computeVacationStatsForPeriod(startIso, endIso) {
  const stats = new Map(); // staffId -> { total, badges, days: Set(iso), bureau, off, astreinte }

  const ensureEntry = (staffId) => {
    if (!stats.has(staffId)) stats.set(staffId, { total: 0, badges: new Map(), days: new Set(), bureau: 0, off: 0, astreinte: 0 });
    return stats.get(staffId);
  };

  isoWeekdaysInRange(startIso, endIso).forEach(({ iso, dayName, weekKeyPart }) => {
    state.activities.forEach((activity) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = `${weekKeyPart}|${activity.id}|${dayName}|${creneau.id}`;
        if (state.fermetures[key]) return;
        const assigned = effectiveAssignedIdsForWeek(key, weekKeyPart);
        if (assigned.length === 0) return;

        if (creneau.id === "astreinte") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).astreinte++;
          });
          return;
        }
        if (activity.id === "bureau") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).bureau++;
          });
          return;
        }
        if (activity.id === "off") {
          assigned.forEach((staffId) => {
            if (!staffById(staffId)) return;
            ensureEntry(staffId).off++;
          });
          return;
        }

        let groupKey, label, specialite, isUrgence;
        if (activity.urgence) {
          groupKey = `urgence:${activity.id}`;
          label = activity.nom;
          specialite = null;
          isUrgence = true;
        } else {
          const family = activityStatsFamily(activity);
          specialite = effectiveVacationSpecialiteForWeek(activity.id, dayName, creneau.id, weekKeyPart) || null; // RG-024
          groupKey = `${family}:${specialite || "none"}`;
          label = STATS_FAMILY_LABELS[family] || activity.nom;
          isUrgence = false;
        }

        assigned.forEach((staffId) => {
          if (!staffById(staffId)) return;
          const entry = ensureEntry(staffId);
          entry.total++;
          entry.days.add(iso);
          if (!entry.badges.has(groupKey)) {
            entry.badges.set(groupKey, { count: 0, label, specialite, isUrgence, activityId: activity.id });
          }
          entry.badges.get(groupKey).count++;
        });
      });
    });
  });

  return stats;
}

// Équivalent de isFullyOnLeaveThisWeek(), mais pour une plage de jours ouvrés ARBITRAIRE (mode
// "Période", 29/07/2026, bug remonté par Samir : "les Bureau/Off/Congés sont gérés différemment
// entre Semaine et Période sur les mêmes dates"). `businessDaysIso` = tableau de dates ISO déjà
// calculé une fois par rendu (voir periodDaysIso dans renderStatsView()), pour ne pas recalculer
// isoWeekdaysInRange() à chaque personne/comparaison de tri. Une plage vide n'est jamais "en congé".
function isFullyOnLeaveForRange(staffId, businessDaysIso) {
  return businessDaysIso.length > 0 && businessDaysIso.every((iso) => isOnCongeDay(staffId, iso) || isOnReposGardeDay(staffId, iso));
}

// Regroupement par disponibilité en mode "Période" (24/07/2026, revu le 29/07/2026) -- même principe
// que statsAvailabilityTier() (mode Semaine) : un congé couvrant TOUTE la période choisie prime sur
// n'importe quel décompte, même logique de généralisation qu'isFullyOnLeaveForRange() ci-dessus.
// **Avant le 29/07/2026, ce bloc n'existait pas du tout** ("pas de bloc congé toute la période...
// ne se généralise pas proprement à une plage arbitraire sans plus de précisions de Samir") -- une
// personne en congé sur toute une période se retrouvait mélangée avec les personnes réellement
// libres (bloc 1), ce qui a motivé le retour de Samir.
function statsPeriodTier(person, stats, periodDaysIso) {
  if (isFullyOnLeaveForRange(person.id, periodDaysIso)) return 2;
  const entry = stats.get(person.id);
  const hasData = entry && (entry.days.size > 0 || entry.bureau > 0 || entry.off > 0);
  return hasData ? 0 : 1;
}

function renderStatsView() {
  const container = document.getElementById("statsView");
  container.innerHTML = "";

  // Mode "Période" (24/07/2026) : initialise la plage par défaut (mois en cours) à la toute première
  // bascule, puis corrige silencieusement une plage inversée (fin choisie avant le début) plutôt que
  // d'afficher une période vide déroutante.
  if (statsMode === "period") {
    if (!statsRangeStart || !statsRangeEnd) {
      const def = defaultStatsPeriod();
      statsRangeStart = def.start;
      statsRangeEnd = def.end;
    }
    if (statsRangeStart > statsRangeEnd) {
      [statsRangeStart, statsRangeEnd] = [statsRangeEnd, statsRangeStart];
    }
  }

  const monday = getMonday(state.weekOffset);
  const stats = statsMode === "period"
    ? computeVacationStatsForPeriod(statsRangeStart, statsRangeEnd)
    : computeVacationStatsForWeek(monday);
  // Jours ouvrés de la période choisie, calculés une seule fois par rendu (29/07/2026) -- réutilisé
  // par statsPeriodTier() ci-dessous ET par la colonne Vacations plus bas (isFullyOnLeaveForRange()),
  // pour ne jamais recalculer isoWeekdaysInRange() par personne.
  const periodDaysIso = statsMode === "period" ? isoWeekdaysInRange(statsRangeStart, statsRangeEnd).map((d) => d.iso) : null;
  // Jours (triple complet iso/dayName/weekKeyPart, voir missingSlotsForDate()) pour le compteur de
  // "manquants" (05/08/2026) -- `periodDaysIso` juste au-dessus ne garde que l'iso, insuffisant ici.
  // Calculé une seule fois par rendu, réutilisé pour toutes les personnes de la colonne Total.
  const mondayFriday = new Date(monday);
  mondayFriday.setDate(monday.getDate() + 4);
  const missingDaysList = statsMode === "period"
    ? isoWeekdaysInRange(statsRangeStart, statsRangeEnd)
    : isoWeekdaysInRange(toISODateLocal(monday), toISODateLocal(mondayFriday));

  // Tri à deux niveaux : d'abord le bloc de disponibilité (statsAvailabilityTier() en mode Semaine,
  // statsPeriodTier() en mode Période, plus simple -- voir sa déclaration), puis le tri habituel
  // (grade/spécialité/alphabétique) à l'intérieur d'un bloc. L'astreinte n'entre JAMAIS dans ce tri.
  const people = state.staff.filter(personMatchesFilters).sort((a, b) => {
    const tierDiff = statsMode === "period"
      ? statsPeriodTier(a, stats, periodDaysIso) - statsPeriodTier(b, stats, periodDaysIso)
      : statsAvailabilityTier(a, stats) - statsAvailabilityTier(b, stats);
    if (tierDiff !== 0) return tierDiff;
    return compareStaffOrder(a, b);
  });

  // Bascule Semaine/Période (24/07/2026, demande de Samir) -- affichée avant tout le reste, y compris
  // si le filtre en cours ne matche personne, pour toujours pouvoir changer de mode/de plage.
  const modeBar = document.createElement("div");
  modeBar.className = "stats-mode-bar";
  const tabs = document.createElement("div");
  tabs.className = "stats-mode-tabs";
  [["week", "Semaine"], ["period", "Période"]].forEach(([mode, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stats-mode-tab" + (statsMode === mode ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (statsMode === mode) return;
      statsMode = mode;
      render();
    });
    tabs.appendChild(btn);
  });
  modeBar.appendChild(tabs);
  if (statsMode === "period") {
    const picker = document.createElement("div");
    picker.className = "stats-period-picker";
    const startInput = document.createElement("input");
    startInput.type = "date";
    startInput.value = statsRangeStart;
    startInput.addEventListener("change", () => {
      if (!startInput.value) return;
      statsRangeStart = startInput.value;
      render();
    });
    const sep = document.createElement("span");
    sep.textContent = "au";
    const endInput = document.createElement("input");
    endInput.type = "date";
    endInput.value = statsRangeEnd;
    endInput.addEventListener("change", () => {
      if (!endInput.value) return;
      statsRangeEnd = endInput.value;
      render();
    });
    picker.append(startInput, sep, endInput);
    modeBar.appendChild(picker);
  }

  // Case à cocher "Afficher les manquants" (05/08/2026, à côté du sélecteur Semaine/Période, demande
  // de Samir) -- décochée par défaut (statsShowMissing), pour ne montrer les badges §6.42 qu'à la
  // demande le temps de voir à l'usage si Samir les veut affichés en permanence ou pas.
  const missingToggle = document.createElement("label");
  missingToggle.className = "stats-missing-toggle";
  const missingCheckbox = document.createElement("input");
  missingCheckbox.type = "checkbox";
  missingCheckbox.checked = statsShowMissing;
  missingCheckbox.addEventListener("change", () => {
    statsShowMissing = missingCheckbox.checked;
    render();
  });
  missingToggle.append(missingCheckbox, "Afficher les manquants");
  modeBar.appendChild(missingToggle);

  // Colonnes/badges facultatifs (08/08/2026, demande de Samir : "toutes les colonnes soient
  // facultatives... choisir si je veux un compteur de type colonne ou de type badge") -- popover
  // partagé (comme tous les autres, voir renderStatsColumnsPopoverContent()). stopPropagation() : ce
  // bouton n'est ni .slot-cell ni .popover-anchor, sans lui le clic qui ouvre le popover remonterait
  // jusqu'au gestionnaire global et le refermerait aussitôt (même patron que #btnMoreMenu).
  const columnsBtn = document.createElement("button");
  columnsBtn.type = "button";
  columnsBtn.className = "stats-columns-btn";
  columnsBtn.textContent = "⚙ Colonnes";
  columnsBtn.title = "Choisir les colonnes/badges affichés";
  columnsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openStatsColumnsPopover(columnsBtn);
  });
  modeBar.appendChild(columnsBtn);

  container.appendChild(modeBar);

  if (people.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Aucune personne ne correspond aux filtres sélectionnés.";
    container.appendChild(hint);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "stats-table";
  const periodLabel = statsMode === "period"
    ? `du ${formatShort(new Date(`${statsRangeStart}T00:00:00`))} au ${formatShort(new Date(`${statsRangeEnd}T00:00:00`))}`
    : currentWeekLabel();
  // Harmonisé le 08/08/2026 : un seul libellé, l'astreinte compte la semaine affichée (ou la période
  // choisie) exactement comme les autres colonnes -- plus de distinction cumul/semaine seule.
  const astreinteTitle = statsMode === "period" ? "Nombre d'astreintes sur la période choisie" : "Nombre d'astreintes cette semaine";
  const noDataText = statsMode === "period" ? "Aucune vacation sur cette période." : "Aucune vacation cette semaine.";

  // Colonnes réordonnables à la main par glisser-déposer des en-têtes (24/07/2026, demande de Samir)
  // -- "Personnel" reste TOUJOURS fixe en 1re position (colonne figée), les 5 autres suivent l'ordre
  // choisi par Samir (state.statsColumnOrder, persisté). Chaque colonne = un descripteur d'en-tête
  // (libellé/classe/title) + une fonction qui construit sa cellule pour une ligne donnée -- un seul
  // endroit à modifier pour ajouter/changer une colonne, en-tête et corps du tableau restent
  // forcément synchronisés (jamais 2 listes à maintenir en parallèle).
  const columnDefs = {
    total: {
      label: "Total",
      headerClass: "stats-total-header",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.total : 0;
        td.appendChild(badge);

        // Compteur de "manquants" (05/08/2026) : masqué par défaut derrière la case "Afficher les
        // manquants" (statsShowMissing, décochée par défaut) -- pas de calcul du tout tant qu'elle
        // n'est pas cochée, ni le badge lui-même sinon (silencieux si rien à signaler, choix de
        // Samir, "j'aime bien" l'option sans bruit visuel quand tout va bien) -- badge rouge
        // uniquement si au moins un créneau n'est ni excusé (congé/repos) ni couvert
        // (affectation/Bureau/Off/Temps Partiel). Détail des créneaux précis au survol.
        const missing = statsShowMissing ? missingDaysList.flatMap((d) => missingSlotsForDate(person.id, d)) : [];
        if (missing.length > 0) {
          const missingBadge = document.createElement("span");
          missingBadge.className = "stats-missing-badge";
          // Date incluse dans le libellé (pas juste le nom du jour) -- indispensable en mode Période
          // qui peut couvrir plusieurs semaines : "Lundi Après-midi" seul serait ambigu (lequel des
          // lundis de la période ?).
          missingBadge.title = "Manquant : " + missing.map((m) => `${m.day} ${formatShort(new Date(`${m.iso}T00:00:00`))} ${creneauLabel(m.creneauId)}`).join(", ");
          missingBadge.innerHTML = `<span class="stats-missing-icon">!</span> ${missing.length} manquant${missing.length > 1 ? "s" : ""}`;
          td.appendChild(missingBadge);
        }
        return td;
      },
    },
    vacations: {
      label: `Vacations (${periodLabel})`,
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-badges-cell";
        const fullyOnLeave = statsMode === "period"
          ? isFullyOnLeaveForRange(person.id, periodDaysIso)
          : isFullyOnLeaveThisWeek(person);
        if (fullyOnLeave) {
          // Ligne gardée visible plutôt que masquée (contrairement au panneau Personnel, voir
          // isFullyOnLeaveThisWeek()) : un total à 0 sans explication laisserait croire à un oubli
          // plutôt qu'à une absence -- voir aussi buildAbsenceBar() pour la même logique ailleurs.
          const absence = document.createElement("span");
          absence.className = "stats-absence-label";
          absence.textContent = statsMode === "period" ? "Congés toute la période" : "Congés toute la semaine";
          td.appendChild(absence);
          return td;
        }
        // Colonnes/badges facultatifs (08/08/2026) : Congés/Repos de garde en mode "badge" s'ajoutent ici, à la suite des
        // badges de spécialité -- restructuré (par rapport à avant cette RG) pour qu'ils s'affichent
        // même si `entry` est vide (personne sans aucune vraie vacation cette semaine mais avec un
        // congé partiel, ex. 2 jours sur 5) : avant, ce cas tombait dans la branche `!entry` et son
        // texte générique, sans jamais montrer les badges Congés/Repos malgré `statsCounterMode`.
        let anyBadge = false;
        if (entry) {
          sortedStatsBadges(entry).forEach((badge) => {
            anyBadge = true;
            const span = document.createElement("span");
            span.className = statBadgeClass(badge) + " stats-badge";
            span.textContent = `${badge.count} ${badge.label}`;
            td.appendChild(span);
          });
        }
        const isoList = missingDaysList.map((d) => d.iso);
        // Couleur "absence" partagée par congé ET repos de garde (même convention que
        // buildAbsenceBar(), §4.9 CLAUDE.md -- pas une nouvelle couleur inventée).
        if (state.statsCounterMode.conges === "badge") {
          const days = congeDaysCountForRange(person.id, isoList);
          if (days > 0) {
            anyBadge = true;
            const span = document.createElement("span");
            span.className = "chip stats-badge stats-badge-absence";
            span.textContent = `${formatDaysCount(days)} Congés`;
            td.appendChild(span);
          }
        }
        if (state.statsCounterMode.reposGarde === "badge") {
          const days = reposGardeDaysCountForRange(person.id, isoList);
          if (days > 0) {
            anyBadge = true;
            const span = document.createElement("span");
            span.className = "chip stats-badge stats-badge-absence";
            span.textContent = `${days} Repos de garde`;
            td.appendChild(span);
          }
        }
        if (!anyBadge) {
          const empty = document.createElement("span");
          empty.className = "empty-hint";
          empty.textContent = noDataText;
          td.appendChild(empty);
        }
        return td;
      },
    },
    astreinte: {
      label: "Astreinte",
      headerClass: "stats-total-header",
      headerTitle: astreinteTitle,
      // Harmonisé le 08/08/2026 : décompte de la semaine affichée (ou de la période choisie),
      // exactement comme Bureau/Off -- entry.astreinte est calculée de façon symétrique par
      // computeVacationStatsForWeek()/computeVacationStatsForPeriod() depuis cette date.
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.astreinte : 0;
        td.appendChild(badge);
        return td;
      },
    },
    bureau: {
      label: "Bureau",
      headerClass: "stats-total-header",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.bureau : 0;
        td.appendChild(badge);
        return td;
      },
    },
    off: {
      label: "Off",
      headerClass: "stats-total-header",
      headerTitle: "Nombre de demi-journées (créneaux matin/après-midi)",
      buildCell(person, entry) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = entry ? entry.off : 0;
        td.appendChild(badge);
        return td;
      },
    },
    // Colonnes/badges facultatifs (08/08/2026) : Congés/Repos de garde, en colonne uniquement si state.statsCounterMode
    // les met dans ce mode (voir le filtre de columnOrder juste en dessous) -- sinon comptés en badge
    // dans la colonne "vacations" ci-dessus. N'a pas besoin de `entry` (computeVacationStatsForWeek()/
    // ...ForPeriod()) : compté directement depuis state.conges/state.gardes sur la même liste de
    // jours que le compteur de "manquants" (missingDaysList).
    conges: {
      label: "Congés",
      headerClass: "stats-total-header",
      headerTitle: "Nombre de jours de congé (0,5 = demi-journée)",
      buildCell(person) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = formatDaysCount(congeDaysCountForRange(person.id, missingDaysList.map((d) => d.iso)));
        td.appendChild(badge);
        return td;
      },
    },
    reposGarde: {
      label: "Repos de garde",
      headerClass: "stats-total-header",
      headerTitle: "Nombre de jours de repos de garde (RG-013)",
      buildCell(person) {
        const td = document.createElement("td");
        td.className = "stats-total-cell";
        const badge = document.createElement("span");
        badge.className = "stats-total-badge";
        badge.textContent = reposGardeDaysCountForRange(person.id, missingDaysList.map((d) => d.iso));
        td.appendChild(badge);
        return td;
      },
    },
  };

  // Colonnes facultatives (08/08/2026) : statsColumnVisibility, clé absente/`true` = visible
  // + Congés/Repos de garde exclus de la liste des COLONNES quand leur mode est "badge" (ils
  // s'affichent alors dans la cellule "vacations" à la place, voir columnDefs.vacations ci-dessus).
  const columnOrder = normalizeStatsColumnOrder(state.statsColumnOrder).filter((colId) => {
    if (state.statsColumnVisibility[colId] === false) return false;
    if ((colId === "conges" || colId === "reposGarde") && state.statsCounterMode[colId] !== "column") return false;
    return true;
  });

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const personnelTh = document.createElement("th");
  personnelTh.className = "activity-cell person-name-cell";
  personnelTh.textContent = "Personnel";
  headRow.appendChild(personnelTh);

  columnOrder.forEach((colId) => {
    const def = columnDefs[colId];
    const th = document.createElement("th");
    if (def.headerClass) th.className = def.headerClass;
    th.textContent = def.label;
    if (def.headerTitle) th.title = def.headerTitle;
    // Glisser-déposer d'en-tête pour réordonner (24/07/2026) : `dataset.columnId` identifie la
    // colonne, le drop recalcule l'ordre complet et le persiste (saveState()) -- même patron visuel
    // (.dragging/.drag-over) que le reste des glisser-déposer de l'appli.
    th.draggable = true;
    th.dataset.columnId = colId;
    th.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", colId);
      e.dataTransfer.effectAllowed = "move";
      th.classList.add("dragging");
    });
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (e) => {
      e.preventDefault();
      th.classList.add("drag-over");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drag-over"));
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      th.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === colId || !columnDefs[draggedId]) return;
      const order = normalizeStatsColumnOrder(state.statsColumnOrder);
      const fromIdx = order.indexOf(draggedId);
      const targetIdxBefore = order.indexOf(colId); // AVANT le retrait, pour savoir le sens du glissé.
      if (fromIdx === -1 || targetIdxBefore === -1) return;
      order.splice(fromIdx, 1);
      let insertAt = order.indexOf(colId); // position de la cible APRÈS le retrait (a pu décaler de 1).
      // Glissé vers l'avant (la cible était après la colonne déplacée) -> insertion APRÈS la cible,
      // pas avant -- sinon glisser une colonne sur sa voisine immédiate suivante ne bougeait rien
      // (le retrait + une insertion "avant" la remettait exactement à sa place d'origine).
      if (fromIdx < targetIdxBefore) insertAt += 1;
      order.splice(insertAt, 0, draggedId);
      state.statsColumnOrder = order;
      saveState();
      render();
    });
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  people.forEach((person) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = `${person.prenom[0]}. ${person.nom}`;
    nameCell.title = personTooltip(person);
    nameCell.className = "activity-cell person-name-cell";
    nameCell.style.cssText += personCellStyle(person);
    tr.appendChild(nameCell);

    const entry = stats.get(person.id);

    columnOrder.forEach((colId) => {
      tr.appendChild(columnDefs[colId].buildCell(person, entry));
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

