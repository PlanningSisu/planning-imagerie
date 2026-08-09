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
//
// Règle transverse (20/07/2026, rétroactive et applicable à toute RG de composition, pas propre à
// une seule RG) : un sénior au-delà du minimum requis peut couvrir un manque d'interne sans que ça
// remonte en violation — mais on le signale en recommandation ("X pourrait être remplacé par un
// interne") plutôt que de le compter comme un simple excédent, car le remplacement inverse (interne
// -> sénior) n'est jamais imposé nulle part, c'est bien à sens unique.
function checkComposition(nbSeniors, nbInternes, comp, rg, label, violations, recommendations) {
  const extraSeniors = Math.max(0, nbSeniors - comp.seniorMin);
  const interneShortfall = comp.interneMin !== null ? Math.max(0, comp.interneMin - nbInternes) : 0;
  const substitutable = Math.min(extraSeniors, interneShortfall); // séniors en trop utilisés pour couvrir le manque d'interne
  const seniorsAfterSubstitution = nbSeniors - substitutable; // ce qu'il reste de séniors une fois la substitution "appliquée"

  const seniorShort = nbSeniors < comp.seniorMin;
  const interneShort = comp.interneMin !== null && nbInternes + substitutable < comp.interneMin;

  if (seniorShort || interneShort) {
    let interneText = null;
    if (comp.interneMin !== null) {
      interneText =
        comp.interneMax !== null && comp.interneMax !== comp.interneMin
          ? `${comp.interneMin} à ${plural(comp.interneMax, "interne")}`
          : plural(comp.interneMin, "interne");
    }
    const expected = interneText ? `${plural(comp.seniorMin, "sénior")} + ${interneText}` : plural(comp.seniorMin, "sénior");
    const found = comp.interneMin !== null ? `${plural(nbSeniors, "sénior")} + ${plural(nbInternes, "interne")}` : plural(nbSeniors, "sénior");
    const totalMin = comp.seniorMin + (comp.interneMin || 0);
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
    excessParts.push(plural(seniorsAfterSubstitution - comp.seniorMax, "sénior"));
  }
  if (comp.interneMax !== null && nbInternes > comp.interneMax) {
    excessParts.push(plural(nbInternes - comp.interneMax, "interne"));
  }
  if (excessParts.length > 0) {
    recommendations.push({ rg, message: `${label} : ${excessParts.join(" et ")} en trop.` });
  }
}

// RG-002 / RG-003 / RG-007 / RG-012 : composition attendue de Scan U selon jour/créneau.
function validateScanU() {
  const violations = [];
  const recommendations = [];
  const activity = state.activities.find((a) => a.id === "scan-u");
  if (!activity) return { violations, recommendations };

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      const key = cellKey(activity.id, day, creneau.id);
      if (state.fermetures[key]) return; // RG-010 : vacation fermée cette semaine, aucune composition attendue.
      if (isVacationCellOs(activity, day, creneau)) return; // RG-011 : vacation Os, jamais staffée (RG-024 : exception de semaine incluse).
      const assigned = effectiveAssignedIds(key).map(staffById).filter(Boolean);
      const nbSeniors = assigned.filter((p) => p.grade === "senior").length;
      const internes = assigned.filter((p) => p.grade !== "senior");
      const nbInternes = internes.length;
      const label = `Scan U, ${day} ${creneau.label}`;

      if (creneau.id === "astreinte") {
        // RG-012 : composition dédiée à l'astreinte, pas via checkComposition() -- distinction
        // interne "socle" (0 spécialité) vs interne spécialisé, que le helper générique ne connaît pas.
        const nbSocle = internes.filter((p) => (p.specialites || []).length === 0).length;
        if (nbInternes === 0) {
          violations.push({ rg: "RG-012", message: `${label} : ${plural(1, "interne")} attendu, trouvé 0.` });
        }
        if (nbSeniors > 0) {
          recommendations.push({
            rg: "RG-012",
            message: `${label} : ${plural(nbSeniors, "sénior")} en trop (l'astreinte n'accueille que des internes).`,
          });
        }
        if (nbInternes >= 1 && nbInternes < 2 && nbSocle === 0) {
          recommendations.push({
            rg: "RG-012",
            message: `${label} : un interne socle pourrait être ajouté en renfort de l'interne déjà présent.`,
          });
        }
        return;
      }

      if (creneau.id === "matin" && day === "Jeudi") {
        // RG-007 : exception du jeudi matin — 2 séniors minimum, remplace RG-002 ce jour précis.
        // Les internes ne sont pas réglementés par cette RG (ni exigés, ni interdits).
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 2, seniorMax: 2, interneMin: null, interneMax: null },
          "RG-007", label, violations, recommendations
        );
      } else if (creneau.id === "matin") {
        // RG-002 : Scan U le matin (hors jeudi) — 1 sénior + 2 internes minimum.
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2 },
          "RG-002", label, violations, recommendations
        );
      } else {
        // RG-003 : Scan U l'après-midi — 2 séniors minimum + 1 interne minimum. Monter à 2 internes
        // est recommandé mais pas obligatoire (encourageInterneGrowth, même logique que RG-009).
        checkComposition(
          nbSeniors, nbInternes,
          { seniorMin: 2, seniorMax: 2, interneMin: 1, interneMax: 2, encourageInterneGrowth: true },
          "RG-003", label, violations, recommendations
        );
      }
    });
  });

  return { violations, recommendations };
}

// RG-009 : composition attendue de Scan A — même règle tous les jours, matin et après-midi.
function validateScanA() {
  const violations = [];
  const recommendations = [];
  const activity = state.activities.find((a) => a.id === "scan-a");
  if (!activity) return { violations, recommendations };

  DAYS.forEach((day) => {
    CRENEAUX.forEach((creneau) => {
      if (!isCreneauApplicable(activity.id, creneau.id)) return; // RG-012 : astreinte non applicable à Scan A.
      const key = cellKey(activity.id, day, creneau.id);
      if (state.fermetures[key]) return; // RG-010 : vacation fermée cette semaine, aucune composition attendue.
      if (isVacationCellOs(activity, day, creneau)) return; // RG-011 : vacation Os, jamais staffée (RG-024 : exception de semaine incluse).
      const assigned = effectiveAssignedIds(key).map(staffById).filter(Boolean);
      const nbSeniors = assigned.filter((p) => p.grade === "senior").length;
      const nbInternes = assigned.filter((p) => p.grade !== "senior").length;
      const label = `Scan A, ${day} ${creneau.label}`;

      // RG-009 : 1 sénior + 1 interne minimum. Monter à 2 internes est recommandé mais pas exigé
      // (encourageInterneGrowth) : 1 interne -> "encore 1 pourrait être ajouté", 2 internes -> rien.
      checkComposition(
        nbSeniors, nbInternes,
        { seniorMin: 1, seniorMax: 1, interneMin: 1, interneMax: 2, encourageInterneGrowth: true },
        "RG-009", label, violations, recommendations
      );
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

// RG-015 : composition de la garde -- 1 sénior + 2 internes minimum, par jour. Contrairement aux
// RG de composition de vacation (RG-002/003/007/009/012), il n'y a pas de créneau ni de modalité :
// state.gardes n'a qu'une date par personne, donc une seule composition attendue par jour calendaire
// de la semaine affichée. Réutilise checkComposition() comme RG-002 (mêmes seuils).
function validateGardes() {
  const violations = [];
  const recommendations = [];
  const monday = getMonday(state.weekOffset);

  weekIsoDates(monday).forEach((iso, i) => {
    const onGarde = gardeStaffForDate(iso);
    const nbSeniors = onGarde.filter((p) => p.grade === "senior").length;
    const nbInternes = onGarde.filter((p) => p.grade !== "senior").length;
    checkComposition(
      nbSeniors, nbInternes,
      { seniorMin: 1, seniorMax: 1, interneMin: 2, interneMax: 2 },
      "RG-015", `Garde, ${DAYS[i]}`, violations, recommendations
    );
  });

  return { violations, recommendations };
}

// Point d'entrée unique du moteur : ajouter ici l'appel de toute nouvelle fonction validateXxx().
function runValidation() {
  const results = [validateScanU(), validateScanA(), validateAbsences(), validateGardes(), validateActivityExclusivity()];
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

