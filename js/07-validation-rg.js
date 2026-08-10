// ---------- Moteur de validation (RG) ----------
// Moteur d'avertissement, pas de blocage : ne modifie jamais state, se contente de comparer le
// planning de la semaine affichée aux RG codées et de lister les écarts. Détail des règles dans
// regles-gestion.md (section "Moteur de validation") — toute RG codée ici doit y être référencée,
// et réciproquement chaque check ci-dessous doit citer explicitement son RG-XXX en commentaire.

// Accord français : "s" au pluriel seulement à partir de 2 (0 et 1 restent au singulier).
// Ex. plural(0,"sénior") -> "0 sénior", plural(1,"sénior") -> "1 sénior", plural(2,"sénior") -> "2 séniors".
function plural(count, word) {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

// Compare séniors + internes d'une case à une composition attendue { seniorMin, seniorMax,
// interneMin, interneMax } en UNE seule fois, pour produire au plus 1 ligne de violation et 1 ligne
// de recommandation par case — plutôt que 2 lignes séparées (une par rôle), qui prêtaient à
// confusion pour une RG qui est en réalité une seule règle de composition (retour Samir 20/07/2026).
// interneMin/interneMax à null = cette RG ne réglemente pas du tout les internes (ex. RG-007).
// Prend `assigned` (tableau de personnes, pas juste des comptes) depuis le 09/08/2026 -- nécessaire
// pour `socleReinforcementIfSingleInterne` (RG-012, regarde le profil de spécialité des internes) et
// pour la future correction des absences (Étape 2 du moteur paramétrable, filtrera `assigned` en
// amont plutôt que de changer cette fonction).
//
// Règle transverse (20/07/2026, rétroactive et applicable à toute RG de composition, pas propre à
// une seule RG) : un sénior au-delà du minimum requis peut couvrir un manque d'interne sans que ça
// remonte en violation — mais on le signale en recommandation ("X pourrait être remplacé par un
// interne") plutôt que de le compter comme un simple excédent, car le remplacement inverse (interne
// -> sénior) n'est jamais imposé nulle part, c'est bien à sens unique. `comp.allowSubstitution: false`
// (nouveau, 09/08/2026) désactive ce mécanisme pour une règle donnée -- seule RG-012 (astreinte) s'en
// sert : un sénior n'y "compense" jamais un manque d'interne, sa présence est simplement indésirable.
function checkComposition(assigned, comp, rg, label, violations, recommendations) {
  const nbSeniors = assigned.filter((p) => p.grade === "senior").length;
  const internes = assigned.filter((p) => p.grade !== "senior");
  const nbInternes = internes.length;
  const allowSubstitution = comp.allowSubstitution !== false; // défaut true (RG-008)
  const mentionSenior = comp.mentionSeniorInText !== false; // défaut true

  const extraSeniors = Math.max(0, nbSeniors - comp.seniorMin);
  const interneShortfall = comp.interneMin !== null ? Math.max(0, comp.interneMin - nbInternes) : 0;
  const substitutable = allowSubstitution ? Math.min(extraSeniors, interneShortfall) : 0;
  const seniorsAfterSubstitution = nbSeniors - substitutable; // ce qu'il reste de séniors une fois la substitution "appliquée"

  const seniorShort = nbSeniors < comp.seniorMin;
  const interneShort = comp.interneMin !== null && nbInternes + substitutable < comp.interneMin;

  if (seniorShort || interneShort) {
    // mentionSenior: false (RG-012 uniquement) -- l'astreinte n'attend "0 sénior" que dans un sens
    // négatif (voir l'excédent plus bas), ça n'a jamais de sens de l'écrire dans "X attendus, trouvé
    // Y" ("0 sénior + 1 interne attendus" serait confus) -- seul l'interne compte dans ce message-là.
    let interneText = null;
    if (comp.interneMin !== null) {
      interneText =
        comp.interneMax !== null && comp.interneMax !== comp.interneMin
          ? `${comp.interneMin} à ${plural(comp.interneMax, "interne")}`
          : plural(comp.interneMin, "interne");
    }
    const seniorPart = mentionSenior ? plural(comp.seniorMin, "sénior") : null;
    const expected = seniorPart && interneText ? `${seniorPart} + ${interneText}` : seniorPart || interneText;
    const foundSeniorPart = mentionSenior ? plural(nbSeniors, "sénior") : null;
    const foundInternePart = comp.interneMin !== null ? plural(nbInternes, "interne") : null;
    const found = foundSeniorPart && foundInternePart ? `${foundSeniorPart} + ${foundInternePart}` : foundSeniorPart || foundInternePart;
    const totalMin = (mentionSenior ? comp.seniorMin : 0) + (comp.interneMin || 0);
    const attendu = totalMin > 1 ? "attendus" : "attendu";
    violations.push({ rg, message: `${label} : ${expected} ${attendu}, trouvé ${found}.` });
  }

  if (substitutable > 0) {
    const verb = substitutable > 1 ? "pourraient être remplacés" : "pourrait être remplacé";
    recommendations.push({ rg, message: `${label} : ${plural(substitutable, "sénior")} ${verb} par ${plural(substitutable, "interne")}.` });
  }

  // comp.encourageInterneGrowth (ex. RG-009) : à l'inverse d'un "en trop", signale qu'il y a encore
  // de la place jusqu'à interneMax sans que ce soit obligatoire (ex. 1 interne minimum mais 2
  // idéal) — seulement si le minimum est déjà atteint "naturellement" (pas via une substitution
  // RG-008, sinon on aurait deux recommandations qui se chevauchent pour la même case).
  if (comp.encourageInterneGrowth && comp.interneMax !== null && nbInternes >= comp.interneMin && nbInternes < comp.interneMax) {
    const room = comp.interneMax - nbInternes;
    const verb = room > 1 ? "pourraient être ajoutés" : "pourrait être ajouté";
    recommendations.push({ rg, message: `${label} : ${plural(room, "interne")} de plus ${verb} (jusqu'à ${comp.interneMax}).` });
  }

  const excessParts = [];
  if (comp.seniorMax !== null && seniorsAfterSubstitution > comp.seniorMax) {
    // comp.seniorExcessMessage (RG-012 uniquement) : phrase dédiée ("l'astreinte n'accueille que des
    // internes") au lieu du "X en trop" générique -- toujours seule sur sa ligne (jamais combinée
    // avec un excédent d'interne, ça ne peut pas arriver pour RG-012 qui n'a pas d'interneMax).
    if (comp.seniorExcessMessage) {
      recommendations.push({
        rg,
        message: `${label} : ${plural(seniorsAfterSubstitution - comp.seniorMax, "sénior")} en trop (${comp.seniorExcessMessage}).`,
      });
    } else {
      excessParts.push(plural(seniorsAfterSubstitution - comp.seniorMax, "sénior"));
    }
  }
  if (comp.interneMax !== null && nbInternes > comp.interneMax) {
    excessParts.push(plural(nbInternes - comp.interneMax, "interne"));
  }
  if (excessParts.length > 0) {
    recommendations.push({ rg, message: `${label} : ${excessParts.join(" et ")} en trop.` });
  }

  // comp.socleReinforcementIfSingleInterne (RG-012 uniquement) : si un seul interne est présent et
  // qu'aucun n'est "socle" (0 spécialité), suggère d'en ajouter un en renfort -- le helper générique
  // ne connaissait pas le profil de spécialité avant le 09/08/2026 (assigned ne portait que des
  // comptes), cette règle vivait donc à part dans validateScanU(). Généralisée ici en gardant le
  // comportement identique, pas encore un vrai axe "profil d'interne requis" réutilisable ailleurs
  // (voir moteur-regles-brouillon.md §4.2, Étape 4).
  if (comp.socleReinforcementIfSingleInterne && nbInternes >= 1 && nbInternes < 2) {
    const nbSocle = internes.filter((p) => (p.specialites || []).length === 0).length;
    if (nbSocle === 0) {
      recommendations.push({ rg, message: `${label} : un interne socle pourrait être ajouté en renfort de l'interne déjà présent.` });
    }
  }
}

// ---------- Moteur générique de composition (moteur de règles paramétrable, 09/08/2026) ----------
// Remplace les anciennes validateScanU()/validateScanA() (une fonction par modalité, if/else par
// jour/créneau codés en dur) par un interpréteur générique qui lit `state.rules` -- éditable depuis
// l'écran "Règles" (js/21-vue-regles.js). La forme d'une règle et les valeurs de départ vivent dans
// DEFAULT_COMPOSITION_RULES (js/03-state.js, voir pourquoi c'est là-bas et pas ici). RG-015
// (composition de la garde) N'EST PAS ici : une garde n'a pas de modalité/activité, elle reste dans
// validateGardes() -- voir moteur-regles-brouillon.md §3 pour ce choix de périmètre.

// Résout, pour une case précise (modalité/jour/créneau), quelle règle de state.rules s'y applique.
// "La règle la plus spécifique gagne" : entre deux règles qui couvriraient le même jour, la portée
// avec le MOINS de jours l'emporte (ex. RG-007 sur "Jeudi" seul face à une règle "tous les jours" qui
// le couvrirait aussi). Réutilisée aussi hors du moteur de validation par hasSpecialiteMismatch()
// (contour rouge par personne, voir buildAssignedChip()/buildModaliteTag()).
function resolveCompositionRule(activityId, day, creneauId) {
  const matches = state.rules.filter(
    (r) => r.activityId === activityId && r.creneaux.includes(creneauId) && r.days.includes(day)
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, r) => (r.days.length < best.days.length ? r : best));
}

// ---------- Règles globales (10/08/2026) ----------
// Transverses à toutes les modalités, distinctes de state.rules (composition PAR modalité) -- voir
// state.globalRules (js/03-state.js) et l'écran (js/21-vue-regles.js). 1er type : "ignoreSpecialite"
// (RG-001, désactive le contrôle de spécialité pour des personnes/statuts ciblés, sur des modalités
// choisies). Conçu pour accueillir d'autres types plus tard sans changer cette forme.

// Catalogue des "statuts" ciblables par une règle globale, en plus de personnes nommées
// individuellement -- couvre grade ET profil de spécialité (clarifié par Samir : "cadre = grade +
// statut (interne, mono spé, double spé etc)"). `test(person)` est la seule chose consommée par
// personMatchesAnyGlobalRuleStatus() ci-dessous ; `label` sert à l'écran (js/21-vue-regles.js).
const GLOBAL_RULE_STATUS_OPTIONS = [
  { id: "senior", label: "Sénior", test: (p) => p.grade === "senior" },
  { id: "interne", label: "Interne (tous profils)", test: (p) => p.grade === "interne" },
  { id: "interne-socle", label: "Interne socle", test: (p) => p.grade === "interne" && orderedSpecialites(p).length === 0 },
  { id: "interne-mono", label: "Interne mono-spécialisé", test: (p) => p.grade === "interne" && orderedSpecialites(p).length === 1 },
  { id: "interne-specialise", label: "Interne spécialisé (2 spé)", test: (p) => p.grade === "interne" && orderedSpecialites(p).length === 2 },
  { id: "cca", label: "CCA", test: (p) => !!p.cca },
];

function personMatchesAnyGlobalRuleStatus(person, statusIds) {
  return (statusIds || []).some((id) => {
    const option = GLOBAL_RULE_STATUS_OPTIONS.find((o) => o.id === id);
    return option && option.test(person);
  });
}

// RG-001 : la spécialité n'est jamais vérifiée pour une personne/un statut couvert par une règle
// globale "ignoreSpecialite" active sur cette modalité précise (portée "Par modalité", demande
// explicite de Samir plutôt qu'un blanket "partout"). `staffIds` et `statuses` se combinent en OR
// (une personne nommée directement ignore la spé même si aucun statut ne la couvre, et vice-versa).
// `allActivities`/`allStatuses` (10/08/2026) : cases "Toutes les modalités"/"Tous les statuts" dans
// le formulaire -- des sentinelles qui court-circuitent la comparaison plutôt que d'énumérer chaque
// id, pour qu'une modalité ajoutée plus tard soit automatiquement couverte sans revenir éditer la
// règle. Champs optionnels sur un item d'un tableau déjà persisté (comme person.cca en son temps) --
// absents sur une règle existante = `undefined`, falsy, donc aucun comportement changé pour elles.
function isSpecialiteIgnoredForPerson(person, activityId) {
  return state.globalRules.some((gr) =>
    gr.type === "ignoreSpecialite" &&
    (gr.allActivities || gr.activityIds.includes(activityId)) &&
    (gr.allStatuses || (gr.staffIds || []).includes(person.id) || personMatchesAnyGlobalRuleStatus(person, gr.statuses))
  );
}

// RG-028 (10/08/2026, 2e type de règle globale) : "Interdire de poster" -- pour des personnes/
// statuts choisis, sur des modalités/jours/créneaux choisis, être posté(e) est signalé comme une
// contradiction. Contrairement à "ignoreSpecialite" (qui court-circuite une vérification existante),
// celle-ci EST la vérification -- jamais bloquant, jamais auto-corrigé (confirmé par Samir, même
// famille que RG-021/RG-027), sévérité réglable PAR RÈGLE (`severity`: "recommendation"|"violation")
// plutôt qu'un simple on/off comme RG-027 : une règle globale qu'on ne veut plus vérifier se
// supprime directement (pas de 3e état "désactivée" ici, contrairement à `astreinteExclusivityMode`
// qui vit sur une règle structurelle qu'on ne supprime jamais).
// `days`/`creneaux`/`allDays`/`allCreneaux` : même patron que `activityIds`/`allActivities` --
// sentinelles "tous" plutôt qu'une énumération, pour qu'un jour/créneau ne soit jamais oublié.
function isPostingExcludedAsViolation(person, activityId, day, creneauId) {
  return state.globalRules.some((gr) =>
    gr.type === "excludePosting" &&
    gr.severity === "violation" &&
    (gr.allActivities || gr.activityIds.includes(activityId)) &&
    (gr.allDays || gr.days.includes(day)) &&
    (gr.allCreneaux || gr.creneaux.includes(creneauId)) &&
    (gr.allStatuses || (gr.staffIds || []).includes(person.id) || personMatchesAnyGlobalRuleStatus(person, gr.statuses))
  );
}

// Point d'entrée du moteur pour RG-028 -- parcourt CHAQUE règle globale "excludePosting" (pas
// chaque case, contrairement aux autres validateXxx()) : deux règles qui se chevauchent sur la
// même case produisent chacune leur propre ligne, jamais dédupliquées entre elles (chaque règle
// est une contrainte distincte, même principe que RG-014/RG-020 qui peuvent flaguer la même case
// sans se fusionner).
function validateGlobalPostingExclusions() {
  const violations = [];
  const recommendations = [];

  state.globalRules.forEach((gr) => {
    if (gr.type !== "excludePosting") return;
    const activityIds = gr.allActivities ? state.activities.map((a) => a.id) : gr.activityIds;
    const days = gr.allDays ? DAYS : gr.days;
    const creneauIds = gr.allCreneaux ? CRENEAUX.map((c) => c.id) : gr.creneaux;
    const target = gr.severity === "violation" ? violations : recommendations;

    activityIds.forEach((activityId) => {
      const activity = state.activities.find((a) => a.id === activityId);
      if (!activity) return;
      days.forEach((day) => {
        creneauIds.forEach((creneauId) => {
          if (!isCreneauApplicable(activityId, creneauId)) return;
          const creneau = CRENEAUX.find((c) => c.id === creneauId);
          const key = cellKey(activityId, day, creneauId);
          if (state.fermetures[key]) return; // RG-010 : case fermée, rien à signaler.
          effectiveAssignedIds(key).forEach((staffId) => {
            const person = staffById(staffId);
            if (!person) return;
            const targeted = gr.allStatuses || (gr.staffIds || []).includes(staffId) || personMatchesAnyGlobalRuleStatus(person, gr.statuses);
            if (!targeted) return;
            target.push({
              rg: "RG-028",
              message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} ne devrait pas être posté(e) ici (règle globale).`,
            });
          });
        });
      });
    });
  });

  return { violations, recommendations };
}

// RG-001 "cheat code" (10/08/2026, mots de Samir) : une compétence (person.competences, jusque-là
// purement informative -- voir §6.31 CLAUDE.md) compte désormais AUSSI comme une spécialité valide
// pour le calcul de RG-001 -- EN PLUS de la "vraie" spécialité (orderedSpecialites), jamais à sa
// place (une personne satisfait la règle si l'une OU l'autre couvre la spécialité propriétaire de la
// case). Centralisé ici, appelé à la fois par hasSpecialiteMismatch() (contour rouge) et la boucle
// RG-001 de validateCompositionRules() (violation dans la zone de validation), pour ne jamais
// désynchroniser les deux.
function personSatisfiesSpecialite(person, vacSpec) {
  return orderedSpecialites(person).includes(vacSpec) || orderedCompetences(person).includes(vacSpec);
}

// RG-001 (spécialité, tranché le 09/08/2026 : dans le périmètre bêta) : la règle peut exiger que
// chaque personne PRÉSENTE sur cette vacation ait la spécialité propriétaire de la case parmi les
// siennes (1 pour un sénior, 1 ou 2 pour un interne) -- pas juste une personne du groupe -- OU une
// compétence correspondante (voir personSatisfiesSpecialite() ci-dessus, "cheat code" 10/08/2026).
// Rien à vérifier si la case n'a pas de spécialité propriétaire renseignée (`vacationSpecialites`),
// quel que soit le réglage de la règle : il n'y a rien à comparer. Réutilisée par
// validateCompositionRules() (violation, texte) ET par buildAssignedChip()/buildModaliteTag()
// (contour rouge sur la pastille en cause, même traitement visuel que RG-014/020/021) --
// `weekKeyPart` toujours celle de la case rendue (RG-024 : une exception de semaine change la
// spécialité effective), jamais supposée = semaine affichée, une pastille pouvant être rendue pour
// une semaine différente de state.weekOffset.
function hasSpecialiteMismatch(person, activityId, day, creneauId, weekKeyPart) {
  const rule = resolveCompositionRule(activityId, day, creneauId);
  if (!rule || !rule.requireSpecialite) return false;
  if (isSpecialiteIgnoredForPerson(person, activityId)) return false; // règle globale (10/08/2026)
  const vacSpec = effectiveVacationSpecialiteForWeek(activityId, day, creneauId, weekKeyPart);
  if (!vacSpec) return false;
  return !personSatisfiesSpecialite(person, vacSpec);
}

// Point d'entrée du moteur générique -- une seule fonction pour toutes les modalités couvertes par
// state.rules (Scan U, Scan A aujourd'hui), remplace validateScanU()+validateScanA().
function validateCompositionRules() {
  const violations = [];
  const recommendations = [];

  const activityIds = [...new Set(state.rules.map((r) => r.activityId))];
  activityIds.forEach((activityId) => {
    const activity = state.activities.find((a) => a.id === activityId);
    if (!activity) return;
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activityId, creneau.id)) return; // RG-012 : astreinte réservée à Scan U.
        const rule = resolveCompositionRule(activityId, day, creneau.id);
        if (!rule) return; // aucune règle définie pour cette case -- rien à vérifier.
        const key = cellKey(activityId, day, creneau.id);
        if (state.fermetures[key]) return; // RG-010 : vacation fermée cette semaine, aucune composition attendue.
        if (isVacationCellOs(activity, day, creneau)) return; // RG-011 : vacation Os, jamais staffée.
        const allAssigned = effectiveAssignedIds(key).map(staffById).filter(Boolean);
        const label = `${rule.labelPrefix}, ${day} ${creneau.label}`;

        // Absences (09/08/2026, "on corrige les absences dans leur aspect bancal") : une personne
        // absente (congé/repos de garde) ce créneau-là ne compte plus dans le calcul de composition
        // -- comme un trou de plus à combler. Elle reste affichée normalement dans la case, avec son
        // contour rouge RG-014 habituel (mécanisme séparé, inchangé) -- les deux signaux coexistent :
        // "il manque quelqu'un" (ici) et "cette personne ne devrait pas être là" (RG-014), jamais
        // fusionnés en un seul message.
        const present = allAssigned.filter((p) => !isPersonAbsentOnSlot(p.id, day, creneau.id));
        checkComposition(present, rule, rule.rg, label, violations, recommendations);

        // Spécialité (RG-001) : une violation par personne présente qui ne correspond pas, jamais une
        // seule ligne pour toute la case (voir hasSpecialiteMismatch()).
        if (rule.requireSpecialite) {
          const vacSpec = effectiveVacationSpecialite(activityId, day, creneau.id);
          if (vacSpec) {
            present.forEach((person) => {
              if (isSpecialiteIgnoredForPerson(person, activityId)) return; // règle globale (10/08/2026)
              if (!personSatisfiesSpecialite(person, vacSpec)) { // "cheat code" compétence (10/08/2026)
                violations.push({
                  rg: rule.rg,
                  message: `${label} : ${person.prenom} ${person.nom} n'a pas la spécialité de cette vacation (${SPECIALITES[vacSpec].label}).`,
                });
              }
            });
          }
        }
      });
    });
  });

  return { violations, recommendations };
}

// RG-014 : une personne assignée ne doit jamais être en congé ou en repos de garde (RG-013) le
// jour de la case où elle est postée. Contrairement à RG-002/003/007/009/012, ce n'est pas une
// RG de composition (nombre de séniors/internes) mais une contrainte transverse à TOUTES les
// activités/créneaux applicables -- d'où une boucle sur state.activities plutôt qu'une seule
// modalité. Toujours une violation (jamais une recommandation) : il n'y a pas de "trop de zèle"
// possible ici. Filet de sécurité pour tout ce qui a échappé au blocage du glisser-déposer (le
// popover d'ajout n'est pas filtré, voir handleAssignmentDrop()) -- voir aussi le contour rouge
// posé directement sur la case dans buildModaliteCell() (.cell-absence-violation).
function validateAbsences() {
  const violations = [];
  const recommendations = [];

  state.activities.forEach((activity) => {
    DAYS.forEach((day) => {
      CRENEAUX.forEach((creneau) => {
        if (!isCreneauApplicable(activity.id, creneau.id)) return;
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return; // RG-010 : case fermée, aucune vérification attendue.
        const assigned = effectiveAssignedIds(key);
        assigned.forEach((staffId) => {
          const person = staffById(staffId);
          if (!person) return;
          if (activity.id !== "off" && isPersonAbsentOnSlot(staffId, day, creneau.id)) {
            // Off ne compte pas comme un conflit avec une absence (congé/repos de garde) : les deux
            // disent la même chose ("cette personne ne travaille pas"), jamais une contradiction --
            // demande de Samir le 29/07/2026 ("si je suis en congés et qu'on m'a mis un Off, c'est
            // pas grave").
            violations.push({
              rg: "RG-014",
              message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} est absent(e) ce jour-là.`,
            });
          } else if (isPersonTPOnSlot(staffId, day, creneau.id)) {
            // RG-020 : plus aucun blocage à l'ajout depuis le 25/07/2026 (ni popover, ni glisser-
            // déposer) -- ce message est désormais le seul signal de la contradiction.
            violations.push({
              rg: "RG-020",
              message: `${activity.nom}, ${day} ${creneau.label} : ${person.prenom} ${person.nom} est à Temps Partiel ce créneau-là.`,
            });
          }
          // RG-018 (conflit Off) fusionnée dans RG-021 le 29/07/2026 -- voir validateActivityExclusivity(),
          // qui couvre désormais Off comme n'importe quelle autre activité. Ne plus réintroduire de
          // branche dédiée ici, ça produirait un double signalement du même conflit.
        });
      });
    });
  });

  return { violations, recommendations };
}

// RG-021 (29/07/2026, généralise RG-018/RG-019) : voir hasActivityExclusivityConflict() pour le
// détail de la règle. Fonction à PART (pas ajoutée à validateAbsences(), pourtant thématiquement
// proche), mais parcourt désormais TOUTES les activités (pas seulement Scan U/Echo U comme
// l'ancienne RG-019) puisque n'importe quelle paire peut désormais entrer en conflit -- `reported`
// déduplique par personne pour chaque (jour, créneau), pour ne compter le même conflit qu'une seule
// fois même s'il est retrouvé depuis plusieurs des activités impliquées.
function validateActivityExclusivity() {
  const violations = [];

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      if (creneau.id === "astreinte") return; // hors-sujet, voir hasActivityExclusivityConflict().
      const reported = new Set();
      state.activities.forEach((activity) => {
        const key = cellKey(activity.id, day, creneau.id);
        if (state.fermetures[key]) return;
        effectiveAssignedIds(key).forEach((staffId) => {
          if (reported.has(staffId)) return;
          const person = staffById(staffId);
          if (!person) return;
          if (hasActivityExclusivityConflict(staffId, day, creneau.id, activity.id)) {
            reported.add(staffId);
            violations.push({
              rg: "RG-021",
              message: `${day} ${creneau.label} : ${person.prenom} ${person.nom} est posté(e) sur plusieurs activités à la fois.`,
            });
          }
        });
      });
    });
  });

  return { violations, recommendations: [] };
}

// RG-027 (10/08/2026, "donnée tacite" remontée par Samir) : on évite de poser en astreinte (Scan U)
// quelqu'un déjà posté sur Scan U OU Echo U (matin OU après-midi) ce même jour calendaire --
// distinct de RG-021 (exclusivité), qui exclut explicitement l'astreinte de son propre calcul
// (`hasActivityExclusivityConflict()`, "hors-sujet"). Réglage par règle de composition (le champ
// `astreinteExclusivityMode` vit sur la règle qui couvre le créneau "astreinte" de Scan U, aujourd'hui
// RG-012) plutôt qu'un mécanisme paramétrable générique : Samir a confirmé préférer coder ce cas très
// spécifique en dur et n'exposer qu'un réglage Désactivée/Facultative/Obligatoire dans l'écran
// "Règles", plutôt que de généraliser la notion d'"incompatibilité entre deux activités sur des
// créneaux différents le même jour" dans state.rules pour un seul cas d'usage aujourd'hui.
// `"off"` (valeur par défaut, y compris pour une règle existante sans ce champ -- undefined) ne
// vérifie rien ; `"recommendation"`/`"violation"` pilotent uniquement la SÉVÉRITÉ d'affichage --
// jamais bloquant, jamais auto-corrigé (comme RG-021), confirmé par Samir ("avertissement") : c'est
// un signal préparatoire pour une future automatisation d'assignation, pas encore cette automatisation
// elle-même.
function validateAstreinteExclusivity() {
  const violations = [];
  const recommendations = [];

  DAYS.forEach((day) => {
    const rule = resolveCompositionRule("scan-u", day, "astreinte");
    const mode = rule && rule.astreinteExclusivityMode;
    if (mode !== "recommendation" && mode !== "violation") return;

    const onAstreinte = effectiveAssignedIds(cellKey("scan-u", day, "astreinte"));
    onAstreinte.forEach((staffId) => {
      const conflictActivityId = ["scan-u", "echo-u"].find((activityId) =>
        ["matin", "apres-midi"].some((creneauId) => effectiveAssignedIds(cellKey(activityId, day, creneauId)).includes(staffId))
      );
      if (!conflictActivityId) return;
      const person = staffById(staffId);
      if (!person) return;
      const conflictActivity = state.activities.find((a) => a.id === conflictActivityId);
      const target = mode === "violation" ? violations : recommendations;
      target.push({
        rg: "RG-027",
        message: `Astreinte, ${day} : ${person.prenom} ${person.nom} est aussi posté(e) sur ${conflictActivity.nom} ce jour-là.`,
      });
    });
  });

  return { violations, recommendations };
}

// RG-015 : composition de la garde, éditable depuis l'écran "Règles" (10/08/2026, `state.gardeRule`
// -- voir DEFAULT_GARDE_RULE dans js/03-state.js et renderGardeRuleSection() dans js/21-vue-regles.js,
// avant ça codée en dur ici même). Contrairement aux RG de composition de vacation
// (RG-002/003/007/009/012), il n'y a pas de créneau ni de modalité : state.gardes n'a qu'une date par
// personne, donc une seule composition attendue par jour calendaire de la semaine affichée, la même
// tous les jours (pas de variation par jour comme RG-007 vs RG-002). Réutilise checkComposition()
// comme les règles de composition de vacation.
function validateGardes() {
  const violations = [];
  const recommendations = [];
  const monday = getMonday(state.weekOffset);

  weekIsoDates(monday).forEach((iso, i) => {
    const onGarde = gardeStaffForDate(iso);
    checkComposition(onGarde, state.gardeRule, "RG-015", `Garde, ${DAYS[i]}`, violations, recommendations);
  });

  return { violations, recommendations };
}

// Point d'entrée unique du moteur : ajouter ici l'appel de toute nouvelle fonction validateXxx().
function runValidation() {
  const results = [validateCompositionRules(), validateAbsences(), validateGardes(), validateActivityExclusivity(), validateAstreinteExclusivity(), validateGlobalPostingExclusions()];
  return {
    violations: results.flatMap((r) => r.violations),
    recommendations: results.flatMap((r) => r.recommendations),
  };
}

function renderValidationColumn(items, kind) {
  // kind: "violation" | "recommendation" — pilote les libellés et classes CSS.
  const isViolation = kind === "violation";
  const label = isViolation ? "violation" : "recommandation";
  const badgeClass = isViolation ? "rg-violation" : "rg-recommendation";

  if (items.length === 0) {
    return `<div class="validation-ok">✓ Aucune ${label} pour cette semaine.</div>`;
  }

  const agreementS = items.length > 1 ? "s" : "";
  return `
    <h3 class="validation-title ${kind}-title">${plural(items.length, label)} détectée${agreementS} cette semaine</h3>
    <ul class="validation-list">
      ${items.map((v) => `<li><span class="validation-rg ${badgeClass}">${v.rg}</span> ${v.message}</li>`).join("")}
    </ul>
  `;
}

function renderValidationZone() {
  const zone = document.getElementById("validationZone");
  const { violations, recommendations } = runValidation();

  zone.innerHTML = `
    <div class="validation-col validation-col-violations">${renderValidationColumn(violations, "violation")}</div>
    <div class="validation-col validation-col-recommendations">${renderValidationColumn(recommendations, "recommendation")}</div>
  `;
}

