// ---------- Démarrage ----------

loadState();
render();
setFileSyncStatus(fileSyncStatus); // affiche "non connecté" dans la topbar avant même la tentative de connexion auto ci-dessous.
tryAutoConnectGitHub(); // async -- re-render si un jeton est déjà enregistré et valide.
