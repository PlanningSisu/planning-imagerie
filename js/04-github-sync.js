// ---------- Synchro GitHub (23/07/2026, remplace le fichier sur drive) ----------
// Remplace le localStorage comme SOURCE DE VÉRITÉ : les données vivent dans un fichier JSON du
// dépôt PRIVÉ planning-imagerie-data, lu/écrit directement via l'API GitHub (pas de File System
// Access API, pas de fichier local, pas de limite Chrome-only -- fonctionne sur tout navigateur).
// Le localStorage reste en place comme cache de démarrage rapide + filet de secours si aucun jeton
// n'est encore renseigné -- jamais comme source de vérité une fois connecté.
//
// Le jeton d'accès (PAT) n'est JAMAIS écrit dans ce fichier (qui est publié publiquement sur
// GitHub Pages) : l'utilisateur le colle une fois dans la modale, stocké uniquement dans le
// localStorage de son navigateur. Un jeton fine-grained scope au SEUL dépôt privé, permission
// "Contents: Read and write", limite le risque en cas de fuite.

const GITHUB_OWNER = "PlanningSisu";
const GITHUB_REPO = "planning-imagerie-data";
const GITHUB_FILE_PATH = "planning-imagerie.json";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN_KEY = "planningAppGitHubToken";

let githubFileSha = null; // sha du blob actuellement connu -- exigé par l'API pour toute écriture (évite d'écraser une modif faite ailleurs entre-temps).
let fileWriteTimer = null;
let fileWriteInFlight = false;
let fileWritePending = false; // une modif est arrivée PENDANT une écriture déjà en cours -- à rejouer une fois celle-ci terminée.
// Bug réel remonté par Samir le 24/07/2026 : "Réinitialiser le planning" (ou toute action utilisant
// confirm()) faisait réapparaître les affectations juste effacées. Cause -- confirm()/alert() sont
// des dialogues natifs qui déclenchent un blur/focus de la fenêtre ; l'événement "focus" (voir plus
// bas) ne peut s'exécuter qu'une fois le code synchrone du clic terminé (JS mono-thread), donc APRÈS
// que saveState() ait DÉJÀ programmé une écriture différée (scheduleFileSave()) -- mais
// fileWriteInFlight/fileWritePending sont encore tous les deux `false` à ce moment précis (l'écriture
// n'a pas encore DÉMARRÉ). Le focus déclenchait donc un reloadFromGitHub() qui relisait l'ANCIEN
// contenu (pas encore écrasé par notre reset, toujours dans le debounce d'attente) et l'appliquait
// par-dessus l'état tout juste réinitialisé. `hasUnflushedChange` comble ce trou : positionné de
// façon SYNCHRONE dès qu'un changement est programmé (avant que le focus différé ait pu s'exécuter),
// et retiré seulement après une écriture réussie ET sans changement plus récent en attente derrière.
let hasUnflushedChange = false;
let fileSyncStatus = "disconnected"; // "disconnected" | "ok" | "saving" | "error" | "invalid-token" | "conflict"

function getGitHubToken() {
  return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
}

function setGitHubToken(token) {
  localStorage.setItem(GITHUB_TOKEN_KEY, token);
}

function clearGitHubToken() {
  localStorage.removeItem(GITHUB_TOKEN_KEY);
}

// L'API GitHub encode le contenu en base64 -- atob()/btoa() seuls ne gèrent que du Latin1, pas
// l'UTF-8 (accents des noms de famille, ex. "Léodagan") -- passer par TextEncoder/TextDecoder pour
// un aller-retour fidèle.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function githubContentsRequest(method, body) {
  const token = getGitHubToken();
  return fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Distingue un vrai jeton invalide/sans accès (401, ou 403 de permission) d'un 403 de LIMITE DE
// TAUX GitHub (11/08/2026, bug réel remonté par Samir : "turbo click" sur les flèches ←/→ de
// navigation -- chaque clic déclenche une sauvegarde, voir js/14-navigation-semaine.js -- assez de
// clics rapprochés dépasse la limite secondaire de GitHub, qui renvoie AUSSI un 403, avec un message
// distinct ("You have exceeded a secondary rate limit...") d'un vrai problème de jeton). Sans cette
// distinction, l'appli affichait à tort "Jeton invalide" alors que le jeton fonctionne très bien --
// confusant et alarmant pour rien. `retryAfterMs` (en-tête `Retry-After` s'il est présent, sinon 60s
// par défaut) pilote la nouvelle tentative automatique, voir flushFileSave().
async function githubErrorFromResponse(res) {
  if (res.status === 401) return { code: "invalid-token", message: "Jeton invalide ou sans accès à ce dépôt." };
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if ((body.message || "").toLowerCase().includes("rate limit")) {
      const retryAfterHeader = res.headers.get("retry-after");
      return {
        code: "rate-limited",
        message: "Trop de sauvegardes rapprochées (limite GitHub) -- nouvelle tentative automatique dans quelques instants.",
        retryAfterMs: retryAfterHeader ? Number(retryAfterHeader) * 1000 : 60000,
      };
    }
    return { code: "invalid-token", message: "Jeton invalide ou sans accès à ce dépôt." };
  }
  return null;
}

async function readStateFromGitHub() {
  const res = await githubContentsRequest("GET");
  const ghErr = await githubErrorFromResponse(res);
  if (ghErr) throw Object.assign(new Error(ghErr.message), { code: ghErr.code, retryAfterMs: ghErr.retryAfterMs });
  if (!res.ok) throw new Error(`Lecture impossible (HTTP ${res.status}).`);
  const data = await res.json();
  githubFileSha = data.sha;
  return JSON.parse(base64ToUtf8(data.content));
}

async function writeStateToGitHub() {
  const body = {
    message: `Mise à jour du planning (${new Date().toISOString()})`,
    content: utf8ToBase64(JSON.stringify(buildPersistedState(), null, 2)),
    branch: GITHUB_BRANCH,
  };
  if (githubFileSha) body.sha = githubFileSha;
  const res = await githubContentsRequest("PUT", body);
  const ghErr = await githubErrorFromResponse(res);
  if (ghErr) throw Object.assign(new Error(ghErr.message), { code: ghErr.code, retryAfterMs: ghErr.retryAfterMs });
  if (res.status === 409) throw Object.assign(new Error("Le fichier a été modifié ailleurs entre-temps."), { code: "conflict" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Écriture impossible (HTTP ${res.status}).`);
  }
  const data = await res.json();
  githubFileSha = data.content.sha;
}

function fileSyncStatusLabel() {
  switch (fileSyncStatus) {
    case "ok": return "à jour";
    case "saving": return "enregistrement...";
    case "error": return "erreur d'enregistrement";
    case "invalid-token": return "jeton invalide";
    case "conflict": return "conflit -- recharger";
    case "rate-limited": return "trop de sauvegardes rapprochées -- nouvelle tentative automatique";
    default: return "non connecté";
  }
}

// Libellé court pour la pastille de la topbar (24/07/2026, demande de Samir : "Synchro :
// erreur d'enregistrement" prenait trop de place). fileSyncStatusLabel() reste la version complète
// -- utilisée dans la modale "Synchro GitHub" (`Statut : ...`), qui n'a pas cette contrainte de place.
function fileSyncStatusShortLabel() {
  switch (fileSyncStatus) {
    case "ok": return "À jour";
    case "saving": return "Enregistrement";
    case "error": return "Erreur";
    case "invalid-token": return "Jeton invalide";
    case "conflict": return "Conflit";
    case "rate-limited": return "Nouvel essai...";
    default: return "Non connecté";
  }
}

function setFileSyncStatus(status) {
  fileSyncStatus = status;
  const el = document.getElementById("fileSyncStatus");
  if (!el) return;
  el.textContent = fileSyncStatusShortLabel();
  // Le préfixe "Synchro" a disparu du texte visible (trop long) mais reste accessible au survol,
  // avec le libellé complet -- pour ne pas perdre le contexte "c'est le statut de synchro GitHub".
  el.title = `Synchro GitHub : ${fileSyncStatusLabel()}`;
  el.className = "file-sync-status file-sync-" + status;
}

// Annotation de semaine (08/08/2026) : "Semaine du..." change de couleur (`.week-label-annotated`)
// et porte l'annotation en `title` (survol) dès que `state.weekNotes` a du texte pour la semaine
// ACTUELLEMENT AFFICHÉE -- mise à jour à chaque rendu (comme renderWeekLockButton()) puisque
// naviguer d'une semaine à l'autre change ce qu'il faut montrer. Appelée aussi directement (sans
// passer par tout render()) à chaque frappe dans le popover d'annotation, voir
// renderWeekNotePopoverContent() -- un render() complet à chaque caractère tapé serait excessif.
function renderWeekLabel() {
  const label = document.getElementById("weekLabel");
  label.textContent = currentWeekLabel();
  const note = state.weekNotes[weekKey(getMonday(state.weekOffset))];
  label.classList.toggle("week-label-annotated", !!note);
  label.title = note || "Cliquer pour ajouter une annotation à cette semaine";
}

// Verrouillage des semaines (29/07/2026) : icône à côté du statut de synchro -- reflète TOUJOURS la
// semaine ACTUELLEMENT AFFICHÉE (state.weekOffset), mise à jour à chaque rendu (appelée depuis
// render()) puisque naviguer d'une semaine à l'autre change ce qu'elle doit montrer. Le clic
// (toggleCurrentWeekLock()) est le SEUL moyen de déverrouiller une semaine passée, ou de verrouiller
// une semaine actuelle/future à la main -- voir isWeekLocked().
function renderWeekLockButton() {
  const btn = document.getElementById("btnWeekLock");
  if (!btn) return;
  const wk = weekKey(getMonday(state.weekOffset));
  const locked = isWeekLocked(wk);
  btn.textContent = locked ? "🔒" : "🔓";
  btn.className = "week-lock-btn" + (locked ? " week-lock-active" : "");
  btn.title = locked
    ? "Semaine verrouillée -- rien ne peut la modifier. Cliquer pour déverrouiller."
    : "Semaine non verrouillée -- cliquer pour verrouiller.";
}

// Debounce (~1200ms après la dernière modif -- augmenté depuis 400ms le 11/08/2026, voir le commentaire
// juste en dessous) pour ne pas écrire à chaque action individuelle, + garde
// fileWriteInFlight/fileWritePending pour ne jamais avoir deux écritures concurrentes (une modif
// arrivant pendant une écriture en cours est rejouée juste après, jamais perdue).
// ⚠️ 400ms -> 1200ms (11/08/2026, bug réel remonté par Samir : "j'ai des erreurs quand je turbo click
// sur les flèches" ←/→) : chaque clic de navigation de semaine appelle saveState() (voir
// js/14-navigation-semaine.js), donc un "turbo click" pouvait déclencher plusieurs écritures GitHub
// distinctes en quelques secondes (confirmé dans l'historique des commits : rafales de 4 à 10 en
// quelques secondes) -- assez pour dépasser la limite secondaire de GitHub. Un debounce plus long
// absorbe une rafale de clics rapprochés en UNE seule écriture (celle qui suit le DERNIER clic),
// sans changer le comportement pour un usage normal (imperceptible à l'échelle humaine).
function scheduleFileSave() {
  if (!getGitHubToken()) return; // pas connecté -- localStorage seul, rien à faire ici.
  hasUnflushedChange = true; // positionné en synchrone, avant même le délai de 1200ms -- voir plus haut.
  clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(flushFileSave, 1200);
}

async function flushFileSave() {
  if (!getGitHubToken()) return;
  if (fileWriteInFlight) {
    fileWritePending = true;
    return;
  }
  fileWriteInFlight = true;
  setFileSyncStatus("saving");
  try {
    await writeStateToGitHub();
    setFileSyncStatus("ok");
    // Ne retire le "changement non sauvegardé" que si rien de plus récent n'attend déjà derrière
    // (sinon la relance juste en dessous s'en chargera à SA propre réussite).
    if (!fileWritePending) hasUnflushedChange = false;
  } catch (err) {
    console.error("Échec de l'écriture vers GitHub :", err);
    setFileSyncStatus(err.code || "error");
    // hasUnflushedChange reste `true` : l'échec laisse un changement local toujours pas persisté,
    // un rechargement au focus ne doit surtout pas l'écraser avec l'ancien contenu.
    // Limite de taux (11/08/2026) : jamais un vrai échec définitif -- nouvelle tentative automatique
    // après le délai indiqué par GitHub (ou 60s par défaut), sans que Samir ait à recliquer sur quoi
    // que ce soit. Planifiée à PART de fileWritePending/finally ci-dessous (qui ne rejoue
    // qu'immédiatement) pour ne pas retenter tout de suite contre la même limite.
    if (err.code === "rate-limited") {
      setTimeout(() => {
        if (getGitHubToken()) flushFileSave();
      }, err.retryAfterMs || 60000);
    }
  } finally {
    fileWriteInFlight = false;
    if (fileWritePending) {
      fileWritePending = false;
      flushFileSave();
    }
  }
}

// Connexion initiale : valide le jeton en tentant une lecture, puis remplace le state en mémoire
// par le contenu du dépôt -- ne JAMAIS écrire avant d'avoir lu, pour ne jamais écraser une version
// plus récente posée par un autre poste avant même de l'avoir consultée. Se nettoie elle-même en
// cas d'échec (retire le jeton invalide) plutôt que de compter sur l'appelant pour le faire.
async function connectGitHubToken(token) {
  setGitHubToken(token);
  try {
    const data = await readStateFromGitHub();
    applyPersistedState(data);
    setFileSyncStatus("ok");
    render();
  } catch (e) {
    clearGitHubToken();
    setFileSyncStatus("disconnected");
    throw e;
  }
}

function disconnectGitHub() {
  clearGitHubToken();
  githubFileSha = null;
  setFileSyncStatus("disconnected");
}

// Relit le contenu GitHub et remplace le state en mémoire -- pur rechargement, n'écrit jamais.
// Utilisé au démarrage (tryAutoConnectGitHub()), par le bouton "Recharger" de la modale, et
// automatiquement quand l'onglet reprend le focus (voir plus bas).
async function reloadFromGitHub() {
  if (!getGitHubToken()) return;
  const data = await readStateFromGitHub();
  applyPersistedState(data);
  render();
}

// Au démarrage : si un jeton a été enregistré lors d'une session précédente, tente une lecture
// silencieuse -- contrairement à l'ancien système de fichier local, aucun geste utilisateur n'est
// nécessaire ici (un simple jeton HTTP, pas une permission de navigateur), donc ça peut se faire
// automatiquement au chargement de la page, sans clic.
async function tryAutoConnectGitHub() {
  if (!getGitHubToken()) return;
  try {
    const data = await readStateFromGitHub();
    applyPersistedState(data);
    setFileSyncStatus("ok");
    render();
  } catch (e) {
    console.error("Impossible de lire le planning depuis GitHub.", e);
    setFileSyncStatus(e.code || "error");
  }
}

// Re-tente une lecture silencieuse quand l'onglet reprend le focus -- utile si l'autre poste a
// modifié le fichier pendant que cet onglet restait ouvert en arrière-plan. Ignoré si une écriture
// locale est en cours/en attente/programmée (hasUnflushedChange, voir sa déclaration plus haut --
// bug réel corrigé le 24/07/2026 : confirm()/alert() déclenchent un focus dont le traitement était
// jusque-là plus rapide que le début effectif de l'écriture différée).
window.addEventListener("focus", () => {
  if (!getGitHubToken() || fileWriteInFlight || fileWritePending || hasUnflushedChange) return;
  reloadFromGitHub().catch((e) => console.warn("Rechargement au focus impossible.", e));
});

function openFileSyncModal() {
  document.getElementById("fileSyncModal").classList.remove("hidden");
  renderFileSyncModal();
}

function closeFileSyncModal() {
  document.getElementById("fileSyncModal").classList.add("hidden");
}

// Formulaire de saisie du jeton, réutilisé pour la première connexion ET pour le cas "jeton
// invalide" (23/07/2026) -- avant cette factorisation, un jeton expiré/révoqué affichait quand même
// l'écran "Connecté" (basé uniquement sur la présence d'un jeton en storage, pas sur sa validité
// réelle), ce qui était trompeur : impossible de recoller un nouveau jeton sans d'abord cliquer
// "Déconnecter". Le message affiché est le seul élément qui change entre les deux cas.
function renderTokenForm(body, message) {
  body.innerHTML = `
    <p>${message}</p>
    <input type="password" id="githubTokenInput" placeholder="github_pat_..." style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid var(--border);font-size:13px;margin-bottom:10px;">
    <button type="button" id="btnConnectGitHub" class="btn-primary">Connecter</button>
  `;
  document.getElementById("btnConnectGitHub").addEventListener("click", async () => {
    const input = document.getElementById("githubTokenInput");
    const token = input.value.trim();
    if (!token) return;
    try {
      await connectGitHubToken(token);
    } catch (e) {
      alert("Connexion impossible : " + e.message);
    }
    renderFileSyncModal();
  });
}

function renderFileSyncModal() {
  const body = document.getElementById("fileSyncModalBody");
  const hasToken = !!getGitHubToken();

  if (hasToken && fileSyncStatus === "invalid-token") {
    renderTokenForm(body, `Le jeton enregistré ne fonctionne plus (expiré ou révoqué) -- colle-en un nouveau pour reconnecter le dépôt <strong>${GITHUB_REPO}</strong>.`);
    return;
  }

  if (hasToken) {
    body.innerHTML = `
      <p>Connecté au dépôt <strong>${GITHUB_OWNER}/${GITHUB_REPO}</strong>.</p>
      <p>Statut : ${fileSyncStatusLabel()}</p>
      <button type="button" id="btnReloadFile" class="btn-primary btn-outline">Recharger depuis GitHub</button>
      <button type="button" id="btnDisconnectFile" class="btn-primary btn-outline">Déconnecter (retirer le jeton)</button>
    `;
    document.getElementById("btnReloadFile").addEventListener("click", async () => {
      try {
        await reloadFromGitHub();
        setFileSyncStatus("ok");
      } catch (e) {
        setFileSyncStatus(e.code || "error");
        alert("Impossible de recharger : " + e.message);
      }
      renderFileSyncModal();
    });
    document.getElementById("btnDisconnectFile").addEventListener("click", () => {
      disconnectGitHub();
      renderFileSyncModal();
    });
    return;
  }

  renderTokenForm(body, `Colle ici ton jeton d'accès personnel GitHub (fine-grained, limité au dépôt <strong>${GITHUB_REPO}</strong>, permission "Contents: Read and write"). Il reste uniquement dans ce navigateur, jamais dans le code de l'appli.`);
}

