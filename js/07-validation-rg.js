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
    // `severity` (11/08/2026, demande de Samir : "aucun sénior dans une vacation ça doit remonter
    // très haut") : nombre total de personnes manquantes (séniors + internes, substitution RG-008
    // déjà appliquée) -- 0 sénior sur 2 exigés (severity 2) doit apparaître AVANT 1 manquant sur 2
    // (severity 1) dans la zone de validation, voir le tri dans runValidation(). Les autres types de
    // violation (absence, exclusivité, spécialité, RG-028...) n'ont pas cette notion de magnitude et
    // restent sans `severity` explicite -- traités comme la plus basse priorité au tri (voir plus bas).
    const seniorMissing = Math.max(0, comp.seniorMin - nbSeniors);
    const interneMissing = comp.interneMin !== null ? Math.max(0, comp.interneMin - (nbInternes + substitutable)) : 0;
    violations.push({ rg, message: `${label} : ${expected} ${attendu}, trouvé ${found}.`, severity: seniorMissing + interneMissing });
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

// Résout, pour une case précise (modalité/jour/créneau), quel SEGMENT de la règle de cette modalité
// (state.rules, une seule règle par activityId depuis le 18/08/2026, voir DEFAULT_COMPOSITION_RULES
// dans js/03-state.js) s'y applique. "Le segment le plus spécifique gagne" : entre deux segments qui
// couvriraient le même jour, la portée avec le MOINS de jours l'emporte (ex. RG-007 sur "Jeudi" seul
// face à un segment "tous les jours" qui le couvrirait aussi). Un segment ne s'additionne JAMAIS à un
// autre -- le plus spécifique remplace entièrement le plus générique (toute sa composition, pas
// seulement le champ qui diffère).
//
// RG-037 (18/08/2026, retour de Samir sur la résolution des conflits) : à spécificité STRICTEMENT
// égale (même nombre de jours, ex. Lundi+Jeudi vs Jeudi+Vendredi -- deux segments à 2 jours qui
// couvrent tous les deux Jeudi), le segment le PLUS BAS dans la liste (`rule.segments`, l'ordre
// réordonnable par glisser-déposer à l'écran, §6.49) l'emporte -- même logique que Samir avait
// proposée pour un ordre global ("celui du dessous prime"), mais bornée au SEUL cas où la
// spécificité ne suffit déjà pas à trancher (voir CLAUDE.md §6.61 pour la discussion complète :
// un ordre qui prime sur TOUTE la résolution, même quand la spécificité donnerait déjà la bonne
// réponse, a été jugé trop risqué -- un simple glissé cosmétique pourrait alors inverser
// silencieusement une composition réelle sans aucun signal à l'écran). Explicite depuis ce jour --
// remplace un effet de bord accidentel de l'ancien `reduce()`, qui gardait le PREMIER trouvé sur une
// égalité (sens inverse), jamais un choix délibéré ni documenté avant RG-037.
// RG-038 (18/08/2026, voir plus bas) : si la modalité n'a pas de règle à elle qui couvre cette case,
// repli sur la règle spéciale "Toutes les vraies vacations" (state.rules avec `activityId ===
// ALL_REAL_VACATIONS_ID`) -- jamais pour Bureau/Off/Hors SISU.
// Renvoie un objet APLATI (tous les champs du segment + `activityId`/`labelPrefix` du conteneur, plus
// `ruleId` pour qui a besoin de retrouver le conteneur) -- forme IDENTIQUE à l'ancienne règle à plat,
// donc tous les autres consommateurs (validateCompositionRules(), compositionShortfallMessage(), le
// générateur automatique...) continuent de fonctionner sans aucun changement. Réutilisée aussi hors
// du moteur de validation par hasSpecialiteMismatch() (contour rouge par personne, voir
// buildAssignedChip()/buildModaliteTag()).
// Résout le segment le plus spécifique (RG-036/037) d'UNE règle donnée pour ce jour+créneau -- pas
// de notion de repli ici, juste l'algorithme de résolution à l'intérieur d'un seul conteneur.
// Factorisé pour être appelé deux fois par resolveCompositionRule() (règle spécifique PUIS règle de
// repli "Toutes les vraies vacations", RG-038).
// RG-039 (18/08/2026, "je veux dans le même segment pouvoir dire Lundi Matin, Mardi toute la journée
// et Vendredi après-midi") : un segment ne porte plus `days`/`creneaux` (deux listes indépendantes,
// qui forçaient les MÊMES créneaux sur tous les jours choisis) mais `creneauxByDay` -- objet {jour ->
// tableau de créneaux}, un jour absent (ou à tableau vide) = pas couvert ce jour-là. Un segment couvre
// donc une case (jour, créneau) précise si `creneauxByDay[day]` existe et inclut `creneauId`.
function segmentSpecificity(s) {
  return Object.keys(s.creneauxByDay).filter((d) => (s.creneauxByDay[d] || []).length > 0).length;
}
function resolveSegmentForRule(rule, day, creneauId) {
  const matches = rule.segments.filter((s) => (s.creneauxByDay[day] || []).includes(creneauId));
  if (matches.length === 0) return null;
  let segment = matches[0];
  for (let i = 1; i < matches.length; i++) {
    // <= (pas <) : à nombre de jours ÉGAL (RG-037), le segment rencontré EN DERNIER (donc le plus bas
    // dans `rule.segments`) remplace le précédent -- c'est ce qui fait gagner "le plus bas dans la liste".
    if (segmentSpecificity(matches[i]) <= segmentSpecificity(segment)) segment = matches[i];
  }
  return segment;
}

function resolveCompositionRule(activityId, day, creneauId) {
  const specificRule = state.rules.find((r) => r.activityId === activityId);
  if (specificRule) {
    const segment = resolveSegmentForRule(specificRule, day, creneauId);
    if (segment) return { ...segment, activityId, labelPrefix: specificRule.labelPrefix, ruleId: specificRule.id };
  }
  // RG-038 (18/08/2026, demande de Samir : "un bloc qui s'applique à toutes les vraies vacations") --
  // repli : consulté SEULEMENT si la modalité elle-même n'a rien à dire pour cette case précise
  // (aucune règle du tout, OU une règle qui existe mais ne couvre pas ce jour/créneau) -- une règle
  // spécifique à la modalité gagne donc TOUJOURS quand elle a quelque chose à dire, quel que soit son
  // nombre de jours (jamais de comparaison de spécificité entre les deux portées, qui n'aurait pas de
  // sens). Jamais consulté pour Bureau/Off/Hors SISU (RG-038 : "vraies vacations" = tout sauf ces 3).
  if (!isRealVacationActivity(activityId)) return null;
  const fallbackRule = state.rules.find((r) => r.activityId === ALL_REAL_VACATIONS_ID);
  if (!fallbackRule) return null;
  const segment = resolveSegmentForRule(fallbackRule, day, creneauId);
  if (!segment) return null;
  // Le libellé affiché (messages de violation/recommandation) reste celui de la VRAIE modalité --
  // jamais "Toutes les vraies vacations", qui rendrait les messages méconnaissables.
  const activity = state.activities.find((a) => a.id === activityId);
  return { ...segment, activityId, labelPrefix: activity ? activity.nom : activityId, ruleId: fallbackRule.id };
}

// Repère visuel CASE (11/08/2026, demande de Samir : "si une case ne contient pas assez d'interne/
// sénior, tu entoures en rouge [toute la case]", puis "il me faudrait une infobulle... 'un sénior
// manquant'") : cette case a-t-elle moins de séniors/internes PRÉSENTS que ce que sa règle exige, et
// si oui, quel texte l'expliquer ? Même calcul que checkComposition() (filtré des absents, RG-014 --
// une personne absente ne compte plus vers le minimum), réduit à un texte court plutôt qu'une entrée
// de violations[]/recommendations[] -- consommé uniquement par buildModaliteCell() pour poser
// `.cell-composition-violation` + le `title` de la case. `null` s'il n'y a rien à signaler (pas de
// règle, case fermée RG-010, ou Os RG-011 -- mêmes exclusions que validateCompositionRules()/le reste
// du moteur) ou si la composition est déjà satisfaite.
function compositionShortfallMessage(activityId, day, creneauId) {
  const rule = resolveCompositionRule(activityId, day, creneauId);
  if (!rule) return null;
  const key = cellKey(activityId, day, creneauId);
  if (state.fermetures[key]) return null;
  const activity = state.activities.find((a) => a.id === activityId);
  const creneau = CRENEAUX.find((c) => c.id === creneauId);
  if (!activity || isVacationCellOs(activity, day, creneau)) return null;
  const present = effectiveAssignedIds(key)
    .map(staffById)
    .filter(Boolean)
    .filter((p) => !isPersonAbsentOnSlot(p.id, day, creneauId));
  const nbSeniors = present.filter((p) => p.grade === "senior").length;
  const nbInternes = present.filter((p) => p.grade !== "senior").length;
  const seniorShort = Math.max(0, rule.seniorMin - nbSeniors);
  // RG-035 (18/08/2026) : même suppression que dans validateCompositionRules() -- doit rester en
  // synchro avec elle, sinon la case resterait entourée en rouge alors que la violation a disparu
  // de la liste. interneMin traité comme "non réglementé" pour Jeudi matin quand la case est cochée.
  const interneMinEffective =
    state.fixedRuleToggles["RG-035"] && day === "Jeudi" && creneauId === "matin" ? null : rule.interneMin;
  const interneShort = interneMinEffective !== null ? Math.max(0, interneMinEffective - nbInternes) : 0;
  if (seniorShort === 0 && interneShort === 0) return null;
  const seniorPart = seniorShort > 0 ? `${plural(seniorShort, "sénior")} manquant${seniorShort > 1 ? "s" : ""}` : null;
  const internePart = interneShort > 0 ? `${plural(interneShort, "interne")} manquant${interneShort > 1 ? "s" : ""}` : null;
  return [seniorPart, internePart].filter(Boolean).join(" et ");
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

// RG-001 : passe-droit de spécialité -- une règle globale "ignoreSpecialite" active pour cette
// personne/ce statut, sur cette modalité/ce jour/ce créneau précis (portée "Par modalité", demande
// explicite de Samir plutôt qu'un blanket "partout"), renvoie soit `"ignore"` (comportement
// historique -- RG-001 jamais vérifiée pour la cible, ni violation ni recommandation), soit
// `"downgrade"` (10/08/2026, "cheat code"/"passe-droit" : le signal reste visible mais dégradé en
// recommandation au lieu d'une violation -- mots de Samir : "j'autorise Victoria à faire de l'Uro...
// tu mets juste une recommandation pas une violation"), soit `null` si aucune règle ne s'applique.
// `staffIds`/`statuses` se combinent en OR (une personne nommée directement est couverte même si
// aucun statut ne la couvre, et vice-versa) -- `allActivities`/`allStatuses`/`allDays`/`allCreneaux`
// sont des sentinelles "tous" plutôt qu'une énumération, pour qu'une modalité/un jour/un créneau
// ajouté plus tard soit automatiquement couvert sans revenir éditer la règle.
// `days`/`creneaux`/`allDays`/`allCreneaux`/`mode` (10/08/2026) sont optionnels -- une règle créée
// AVANT leur introduction n'a ni les uns ni l'autre (`undefined`) : `!gr.days`/`!gr.creneaux`
// retombent alors sur "tous les jours/créneaux" (comportement historique, cette règle s'appliquait
// déjà sans notion de jour/créneau), et `gr.mode` absent retombe sur `"ignore"` (comportement
// historique aussi, seul mode qui existait avant le passe-droit). Si plusieurs règles se
// chevauchent pour la même case, "ignore" gagne toujours sur "downgrade" (le passe-droit le plus
// fort l'emporte, jamais un mélange incohérent des deux).
function specialiteOverrideForPerson(person, activityId, day, creneauId) {
  const matches = state.globalRules.filter((gr) => {
    if (gr.type !== "ignoreSpecialite") return false;
    if (gr.enabled === false) return false; // désactivée (11/08/2026, voir renderGlobalRulesList()) -- traitée comme absente, sans la supprimer.
    if (!(gr.allActivities || gr.activityIds.includes(activityId))) return false;
    if (!(gr.allDays || !gr.days || gr.days.includes(day))) return false;
    if (!(gr.allCreneaux || !gr.creneaux || gr.creneaux.includes(creneauId))) return false;
    return gr.allStatuses || (gr.staffIds || []).includes(person.id) || personMatchesAnyGlobalRuleStatus(person, gr.statuses);
  });
  if (matches.length === 0) return null;
  return matches.some((gr) => (gr.mode || "ignore") === "ignore") ? "ignore" : "downgrade";
}

// RG-028 (10/08/2026, 2e type de règle globale) : "Interdire de poster" -- pour des personnes/
// statuts choisis, sur des modalités/jours/créneaux choisis, être posté(e) est signalé comme une
// contradiction. Contrairement à "ignoreSpecialite" (qui court-circuite une vérification existante),
// celle-ci EST la vérification -- jamais bloquant, jamais auto-corrigé (confirmé par Samir, même
// famille que RG-021/RG-027), sévérité réglable PAR RÈGLE (`severity`: "recommendation"|"violation").
// `enabled` (11/08/2026, demande de Samir : "activer/désactiver sans supprimer") : `false` explicite
// = règle ignorée sans être supprimée (voir renderGlobalRulesList()) -- absent/`true` = active,
// comportement historique pour toute règle créée avant ce champ.
// `days`/`creneaux`/`allDays`/`allCreneaux` : même patron que `activityIds`/`allActivities` --
// sentinelles "tous" plutôt qu'une énumération, pour qu'un jour/créneau ne soit jamais oublié.
function isPostingExcludedAsViolation(person, activityId, day, creneauId) {
  return state.globalRules.some((gr) =>
    gr.type === "excludePosting" &&
    gr.enabled !== false && // désactivée (11/08/2026) -- traitée comme absente, sans la supprimer.
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
    if (gr.enabled === false) return; // désactivée (11/08/2026) -- traitée comme absente, sans la supprimer.
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
// `activityId` (11/08/2026, demande de Samir) : pour Digestif/Uro/Gynéco, une compétence peut être
// scindée par portée Scan/IRM (`"<spé>:scan"`/`"<spé>:irm"`, voir COMPETENCE_ORDER/
// competenceScopeForActivity() dans js/01-demo-data.js) -- ne compte que si `activityId` tombe
// effectivement dans la portée où la personne l'a cochée (Scan A/B, ou IRM 1.5T/3T). Thorax reste une
// simple compétence globale, aucune portée à vérifier pour elle.
// Mammo (11/08/2026, bug réel remonté par Samir) : TOUTES les cases Mammo ont "Gynéco" comme
// spécialité propriétaire en pratique (`vacationSpecialites`), puisque "Mammo" lui-même n'est jamais
// une valeur possible de `vacationSpecialites` (voir §4.2/§4.4 CLAUDE.md -- seules les 5 spécialités
// officielles le peuvent). Sans ce cas particulier, un sénior Uro coché "compétence Mammo" restait à
// tort signalé en mismatch sur une case Mammo, qui exigeait alors la compétence/spécialité GYNÉCO --
// alors que Mammo est une compétence à part, pas un sous-ensemble de Gynéco. La compétence "Mammo"
// suffit donc à elle seule sur l'activité Mammo, quelle que soit la spécialité propriétaire affichée
// dessus -- court-circuite le reste de la fonction avant même de regarder `vacSpec`.
function personSatisfiesSpecialite(person, vacSpec, activityId) {
  if (orderedSpecialites(person).includes(vacSpec)) return true;
  const competences = orderedCompetences(person);
  if (activityId === "mammo" && competences.includes("mammo")) return true;
  if (COMPETENCE_SCAN_IRM_SPECIALITES.includes(vacSpec)) {
    const scope = competenceScopeForActivity(activityId);
    return scope !== null && competences.includes(`${vacSpec}:${scope}`);
  }
  return competences.includes(vacSpec);
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
  // Passe-droit (10/08/2026) : "ignore" ET "downgrade" suppriment tous les deux le contour rouge --
  // seul un "downgrade" reste visible, mais uniquement comme recommandation dans la zone de
  // validation (voir la boucle RG-001 de validateCompositionRules() plus bas), jamais sur la
  // pastille (même principe que RG-028 en sévérité "Facultative", qui ne touche jamais le contour).
  if (specialiteOverrideForPerson(person, activityId, day, creneauId)) return false;
  const vacSpec = effectiveVacationSpecialiteForWeek(activityId, day, creneauId, weekKeyPart);
  if (!vacSpec) return false;
  return !personSatisfiesSpecialite(person, vacSpec, activityId);
}

// Point d'entrée du moteur générique -- une seule fonction pour toutes les modalités couvertes par
// state.rules (Scan U, Scan A aujourd'hui), remplace validateScanU()+validateScanA().
function validateCompositionRules() {
  const violations = [];
  const recommendations = [];

  // RG-038 (18/08/2026) : si la règle de repli "Toutes les vraies vacations" existe, TOUTE vraie
  // vacation doit être visitée -- même celles qui n'ont aucune règle à elles -- pour que
  // resolveCompositionRule() ait l'occasion d'appliquer son repli. Sans ça, une modalité sans règle
  // propre ne serait jamais vérifiée du tout, malgré la règle de repli. Le conteneur de repli lui-même
  // (`ALL_REAL_VACATIONS_ID`) est exclu de la liste -- ce n'est jamais une modalité à vérifier
  // directement (state.activities.find() renverrait de toute façon `undefined` pour lui).
  const specificActivityIds = state.rules.map((r) => r.activityId).filter((id) => id !== ALL_REAL_VACATIONS_ID);
  const hasFallbackRule = state.rules.some((r) => r.activityId === ALL_REAL_VACATIONS_ID);
  const activityIds = [...new Set(hasFallbackRule ? [...specificActivityIds, ...realVacationActivityIds()] : specificActivityIds)];
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
        // RG-035 (18/08/2026) : coché, désactive complètement le volet "interne" de la composition
        // pour Jeudi matin, sur TOUTES les modalités qui ont une règle -- pas de violation "interne
        // manquant", pas de recommandation liée (trop d'internes, encourageInterneGrowth). Les
        // séniors restent vérifiés normalement. Clone (pas de mutation de `rule`, référencé ailleurs
        // -- écran Règles, générateur) : interneMin/interneMax à null = "internes non réglementés
        // par cette règle", même mécanisme que RG-007 (interneMin déjà null nativement).
        const effectiveComp =
          state.fixedRuleToggles["RG-035"] && day === "Jeudi" && creneau.id === "matin"
            ? { ...rule, interneMin: null, interneMax: null, encourageInterneGrowth: false }
            : rule;
        checkComposition(present, effectiveComp, rule.rg, label, violations, recommendations);

        // Spécialité (RG-001) : une violation par personne présente qui ne correspond pas, jamais une
        // seule ligne pour toute la case (voir hasSpecialiteMismatch()). Passe-droit (10/08/2026) :
        // "ignore" supprime le signal complètement (comportement historique) ; "downgrade" le garde
        // visible mais en recommandation plutôt qu'en violation -- jamais les deux à la fois pour la
        // même personne.
        if (rule.requireSpecialite) {
          const vacSpec = effectiveVacationSpecialite(activityId, day, creneau.id);
          if (vacSpec) {
            present.forEach((person) => {
              if (personSatisfiesSpecialite(person, vacSpec, activityId)) return; // "cheat code" compétence (10/08/2026)
              const override = specialiteOverrideForPerson(person, activityId, day, creneau.id);
              if (override === "ignore") return;
              const message = `${label} : ${person.prenom} ${person.nom} n'a pas la spécialité de cette vacation (${SPECIALITES[vacSpec].label}).`;
              if (override === "downgrade") {
                recommendations.push({ rg: rule.rg, message });
              } else {
                violations.push({ rg: rule.rg, message });
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
// popover d'ajout n'est pas filtré, voir handleAssignmentDrop()) -- voir aussi le contour rouge posé
// directement sur la pastille de la personne concernée dans buildAssignedChip() (.chip-absence-violation).
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

// RG-029..033 (10/08/2026) : 5 règles fixes codées en dur, cochables individuellement depuis l'écran
// "Règles" -- "je veux juste pouvoir les cocher/décocher", pas de ciblage personnes/statuts/modalités
// comme les règles globales (RG-026/028) ni de sévérité réglable comme RG-027 : TOUJOURS une
// recommandation (jamais une violation, jamais bloquant, jamais auto-corrigé). Chacune vérifie qu'une
// même personne n'est pas postée matin ET après-midi (le même jour calendaire) sur une "famille"
// d'activités donnée -- l'astreinte n'entre jamais en compte (créneau à part, RG-012/RG-027 déjà
// dédiés). RG-031/032 (Scan U seul / Echo U seul) sont volontairement redondantes avec RG-030
// (Scanner, qui inclut déjà Scan U) et RG-033 (Scan U ou Echo U) -- Samir : "plus tard chaque RG aura
// un poids donc il sera intéressant de distinguer", donc CHAQUE combinaison reste une RG à part
// entière plutôt que d'être fusionnée, même si le signal se chevauche aujourd'hui.
const FIXED_RULE_FAMILIES = {
  "RG-029": { label: "Pas d'IRM toute la journée", activityIds: ["irm-15t", "irm-3t"], messageSuffix: "posté(e) en IRM toute la journée" },
  "RG-030": { label: "Pas de Scanner toute la journée", activityIds: ["scan-a", "scan-b", "scan-u"], messageSuffix: "posté(e) au Scanner toute la journée" },
  "RG-031": { label: "Pas de Scan U toute la journée", activityIds: ["scan-u"], messageSuffix: "posté(e) sur Scan U toute la journée" },
  "RG-032": { label: "Pas de Echo U toute la journée", activityIds: ["echo-u"], messageSuffix: "posté(e) sur Echo U toute la journée" },
  "RG-033": { label: "Pas de Scan U ou Echo U toute la journée", activityIds: ["scan-u", "echo-u"], messageSuffix: "posté(e) sur Scan U/Echo U toute la journée" },
};

// RG-035 (18/08/2026, "pas d'alerte si pas d'interne posté sur toutes les vacations le jeudi
// matin") : contrairement aux 5 règles ci-dessus (qui AJOUTENT une recommandation via
// validateFixedFamilyRules), celle-ci SUPPRIME une alerte déjà produite ailleurs (le manque
// d'interne calculé par checkComposition() dans validateCompositionRules(), voir plus bas) --
// mécaniquement différente, donc pas dans FIXED_RULE_FAMILIES (qui suppose toujours une détection
// "même personne postée matin+après-midi"). Reste dans le même sac de state.fixedRuleToggles
// (déjà un objet générique RG-XXX -> booléen, aucune migration nécessaire) et dans la même zone
// "Règles fixes" à l'écran -- juste un libellé de plus, sans configuration, comme les autres.
const RG_035_LABEL = "Pas d'alerte \"interne manquant\" le Jeudi matin (toutes vacations)";

// Renvoie l'ensemble des staffId postés sur au moins une activité de `activityIds` pour ce
// jour+créneau précis -- une case fermée (RG-010) n'est jamais comptée.
function staffAssignedToAnyActivity(activityIds, day, creneauId) {
  const ids = new Set();
  activityIds.forEach((activityId) => {
    const key = cellKey(activityId, day, creneauId);
    if (state.fermetures[key]) return;
    effectiveAssignedIds(key).forEach((id) => ids.add(id));
  });
  return ids;
}

function validateFixedFamilyRules() {
  const recommendations = [];

  Object.entries(FIXED_RULE_FAMILIES).forEach(([rg, { activityIds, messageSuffix }]) => {
    if (!state.fixedRuleToggles[rg]) return; // décochée -- rien à vérifier.
    DAYS.forEach((day) => {
      const morningIds = staffAssignedToAnyActivity(activityIds, day, "matin");
      const afternoonIds = staffAssignedToAnyActivity(activityIds, day, "apres-midi");
      morningIds.forEach((staffId) => {
        if (!afternoonIds.has(staffId)) return;
        const person = staffById(staffId);
        if (!person) return;
        recommendations.push({ rg, message: `${day} : ${person.prenom} ${person.nom} est ${messageSuffix}.` });
      });
    });
  });

  return { violations: [], recommendations };
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
// Violations triées par `severity` décroissante (11/08/2026, demande de Samir) -- une case à 0
// sénior sur 2 exigés doit remonter avant une case à 1 manquant sur 2. Tri STABLE (comportement
// standard de Array.prototype.sort dans tous les navigateurs ciblés) : à `severity` égale (y compris
// les violations sans magnitude -- absence/exclusivité/spécialité/RG-028, `severity` absente = traitée
// comme 0), l'ordre relatif d'origine (regroupé par RG) est conservé, pas de mélange arbitraire.
function runValidation() {
  const results = [validateCompositionRules(), validateAbsences(), validateGardes(), validateActivityExclusivity(), validateAstreinteExclusivity(), validateGlobalPostingExclusions(), validateFixedFamilyRules()];
  const violations = results.flatMap((r) => r.violations).sort((a, b) => (b.severity || 0) - (a.severity || 0));
  return {
    violations,
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

