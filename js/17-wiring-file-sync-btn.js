// ---------- Fichier partagé : câblage des boutons ----------

document.getElementById("btnFileSync").addEventListener("click", openFileSyncModal);
document.getElementById("fileSyncModalClose").addEventListener("click", closeFileSyncModal);
document.getElementById("fileSyncModal").addEventListener("click", (e) => {
  if (e.target.id === "fileSyncModal") closeFileSyncModal();
});

