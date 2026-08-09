// ---------- Navigation semaine ----------

document.getElementById("prevWeek").addEventListener("click", () => {
  state.weekOffset -= 1;
  saveState();
  render();
});
document.getElementById("nextWeek").addEventListener("click", () => {
  state.weekOffset += 1;
  saveState();
  render();
});
// Revient à la semaine en cours (weekOffset 0) -- utile pour se retrouver après avoir navigué
// loin dans le temps. Toujours visible dans la topbar (partagée par toutes les vues, 22/07/2026) :
// pas besoin de logique par vue, weekOffset est déjà consulté partout où la semaine affichée compte.
document.getElementById("btnCurrentWeek").addEventListener("click", () => {
  state.weekOffset = 0;
  saveState();
  render();
});

// Verrouillage des semaines (29/07/2026) : voir toggleCurrentWeekLock()/renderWeekLockButton().
document.getElementById("btnWeekLock").addEventListener("click", toggleCurrentWeekLock);

// Annotation de semaine (08/08/2026) : voir openWeekNotePopover()/renderWeekLabel().
document.getElementById("weekLabel").addEventListener("click", (e) => {
  openWeekNotePopover(e.currentTarget);
});

// Titre "Planning Imagerie" devenu bouton (24/07/2026, demande de Samir, remplace l'ancien bouton
// "Retour Planning" séparé -- même comportement, juste porté par le titre) : toujours au même
// endroit dans la topbar (à gauche, avant le statut de synchro), quel que soit l'écran affiché --
// contrairement aux boutons Trame/Congés/Stats, qui ne redeviennent "← Retour au planning" que
// lorsque LEUR PROPRE mode est actif (donc jamais au même endroit selon d'où on revient). Un seul
// clic ici désactive les 3 modes plein-écran d'un coup, peu importe lequel était actif.
document.getElementById("btnPlanningHome").addEventListener("click", () => {
  editingTrame = false;
  editingConges = false;
  editingStats = false;
  editingRules = false;
  resetFullScreenModeButtons(); // aucun exceptId -- remet les 4 boutons à leur libellé/état normal.
  render();
});

