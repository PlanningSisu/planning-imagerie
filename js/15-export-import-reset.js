// ---------- Export / Import / Reset ----------

document.getElementById("btnExport").addEventListener("click", () => {
  // buildPersistedState() -- exactement ce qui est écrit dans le fichier partagé (staff, congés,
  // gardes, etc., + schemaVersion), jamais `state` brut (qui contiendrait aussi `activities`,
  // piloté par le code). Utile pour une sauvegarde ponctuelle avant une migration de version.
  const blob = new Blob([JSON.stringify(buildPersistedState(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `planning-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnImport").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      applyPersistedState(parsed); // passe par la migration -- accepte aussi bien un export récent qu'un vieux fichier antérieur au versionnement.
      saveState();
      render();
    } catch (err) {
      alert("Fichier JSON invalide : " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// RG-017 (26/07/2026, ⚙ → "Resynchroniser la trame") : rattrape en une fois les ajouts de trame
// faits AVANT que propagateTrameAdditionToTouchedWeeks() n'existe -- purement additif (jamais de
// retrait), donc confirm() en amont est plus une précaution qu'un vrai risque de perte de données.
document.getElementById("btnResyncTrame").addEventListener("click", () => {
  if (!confirm("Resynchroniser la trame vers les semaines déjà touchées ? Chaque personne présente dans la Trame Personnel sera ajoutée sur les semaines actuelle/futures qui ont déjà une affectation différente pour ce créneau précis -- rien n'est jamais retiré ni remplacé.")) return;
  const count = resyncTrameToTouchedWeeks();
  saveState();
  render();
  alert(count > 0 ? `${plural(count, "ajout")} appliqué${count > 1 ? "s" : ""} sur les semaines déjà touchées.` : "Rien à ajouter -- les semaines déjà touchées correspondaient déjà à la trame.");
});

document.getElementById("btnReset").addEventListener("click", () => {
  // Ne touche plus au personnel (devenu une vraie donnée éditée à la main) : uniquement le planning.
  // RG-017 (24/07/2026) : depuis la Trame Personnel, vider state.assignments ne suffit plus à tout
  // effacer visuellement -- les cases jamais touchées cette semaine retombent automatiquement sur
  // la trame (effectiveAssignedIds()), donc réapparaissent aussitôt après ce reset. Confirmé avec
  // Samir le 24/07/2026 que c'est le comportement VOULU (pas un bug) : seul un retrait manuel (×)
  // découple une case précise de la trame. Le texte de confirmation l'explique maintenant
  // explicitement, pour ne plus laisser croire à un reset cassé.
  if (!confirm("Réinitialiser le planning ? Toutes les affectations posées à la main (qui est posté où) et les fermetures de la semaine seront supprimées. Les cases qui suivent la Trame Personnel réapparaîtront automatiquement (retire-les à la main, avec le ×, si tu ne veux pas qu'elles reviennent). Le personnel et les spécialités de vacation ne sont pas concernés. Les semaines verrouillées ne sont jamais touchées.")) return;
  // Verrouillage (29/07/2026) : ce bouton effaçait state.assignments/state.fermetures EN ENTIER,
  // TOUTES semaines confondues (passées ET futures) -- contrairement à ce que son propre texte de
  // confirmation laisse penser ("les fermetures de la semaine"), il n'a jamais été limité à la
  // semaine affichée. Découvert en implémentant le verrouillage, probablement lié aux "modifications
  // reversées sans savoir comment" remontées par Samir le 29/07/2026. Ne conserve désormais que les
  // clés appartenant à une semaine verrouillée -- tout le reste est effacé comme avant.
  const keepAssignment = ([key]) => isWeekLocked(key.split("|")[0]);
  state.assignments = Object.fromEntries(Object.entries(state.assignments).filter(keepAssignment));
  state.fermetures = Object.fromEntries(Object.entries(state.fermetures).filter(keepAssignment));
  saveState();
  render();
});

