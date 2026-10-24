// ---------- Import extract ARI (absences), 23/07/2026 ----------
// ARI est le vrai logiciel de planning de l'hôpital (pas d'accès direct, aucune RG codée dedans) --
// Samir y recopie à la main ce qu'il construit ici. Cet import fait le chemin inverse pour UNE
// seule chose : récupérer les congés annuels et gardes déjà connus côté ARI (via son onglet
// "Absences"), pour ne pas avoir à les ressaisir à la main dans cet outil.
//
// Robustesse volontaire face à un futur fichier "pas pile poil le même" (demande explicite de
// Samir, qui ne sera pas toujours là pour corriger) :
// - Les colonnes sont retrouvées par MOT-CLÉ dans l'en-tête (pas par position fixe) -- résiste à un
//   réordonnancement de colonnes par un futur export ARI.
// - Le nom "Prénom Nom" d'ARI est en réalité incohérent (parfois "NOM Prénom" en majuscules, parfois
//   "Prénom Nom" en casse normale, espaces parasites) -- la comparaison se fait par ENSEMBLE de mots
//   normalisés (accents retirés, casse ignorée), insensible à l'ordre.
// - Un nom qui ne correspond à personne EXACTEMENT est comparé par distance d'édition (Levenshtein)
//   à tout le personnel connu ; une correspondance proche (typo, accent manquant non résolu par la
//   normalisation) est proposée à la confirmation plutôt qu'appliquée silencieusement ou ignorée.

// Distance de Levenshtein classique (nombre minimal d'insertions/suppressions/substitutions pour
// passer d'une chaîne à l'autre) -- utilisée uniquement pour détecter les noms "proches mais mal
// écrits", jamais pour une correspondance exacte (voir tokenSetsEqual()).
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Normalise une chaîne pour comparaison de noms : accents retirés/casse ignorée via normalizeToken()
// (déjà utilisée par le parseur d'import en masse, voir plus haut) + ponctuation/chiffres remplacés
// par des espaces (garde les tirets, significatifs dans les prénoms/noms composés).
function normalizeAriToken(s) {
  return normalizeToken(s || "")
    .replace(/[^a-z\s-]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Ensemble de mots normalisés (espace ET tiret comme séparateurs) -- rend la comparaison insensible
// à l'ordre "NOM Prénom" vs "Prénom Nom" ET à la présence/absence de tiret (Jean-Paul / Jean Paul).
function ariNameTokenSet(s) {
  return new Set(normalizeAriToken(s).split(/[\s-]+/).filter(Boolean));
}

function tokenSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

// Nombre de mots qui diffèrent entre deux ensembles (dans un sens ou dans l'autre) -- contrairement
// à une distance de Levenshtein sur la chaîne entière, un mot ENTIER en trop (ex. nom de mariage/
// double nom de famille : "HUYNH CHARLIER Isabelle" vs "Isabelle Huynh") ne coûte qu'1 ici, pas la
// longueur du mot en caractères -- retrouvé le 23/07/2026 après un vrai cas manqué par la seule
// distance de Levenshtein (trop chère pour un mot ajouté, même si la personne est évidemment la même).
function tokenSetDiffSize(a, b) {
  let diff = 0;
  for (const t of a) if (!b.has(t)) diff++;
  for (const t of b) if (!a.has(t)) diff++;
  return diff;
}

// Cherche la personne de state.staff correspondant à un nom brut venu d'ARI. "exact" = mêmes mots,
// peu importe l'ordre/la casse/les accents/les tirets. "fuzzy" = rien d'exact mais une personne est
// assez proche pour être proposée à confirmation -- soit par mot(s) entier(s) en trop/manquant(s)
// (nom de mariage, second nom de famille...), soit par une petite distance d'édition classique
// (typo). "none" = rien d'assez proche, ignoré silencieusement (juste listé pour information).
function matchAriNameToStaff(ariRawName) {
  const ariTokens = ariNameTokenSet(ariRawName);
  if (ariTokens.size === 0) return { status: "none" };

  for (const person of state.staff) {
    if (tokenSetsEqual(ariTokens, ariNameTokenSet(`${person.prenom} ${person.nom}`))) {
      return { status: "exact", person };
    }
  }

  const ariSorted = [...ariTokens].sort().join(" ");
  let best = null;
  state.staff.forEach((person) => {
    const personTokens = ariNameTokenSet(`${person.prenom} ${person.nom}`);
    const tokenDiff = tokenSetDiffSize(ariTokens, personTokens);
    const charDist = levenshteinDistance(ariSorted, [...personTokens].sort().join(" "));
    // Le raccourci "mot(s) entier(s) en trop/manquant(s)" n'est fiable que si les DEUX noms ont au
    // moins 2 mots distincts -- sinon un nom réduit à un seul mot unique (ex. doublon prénom/nom
    // "Virginie Virginie", une erreur de saisie déjà présente dans le personnel) matcherait à tort
    // n'importe quel nom ARI contenant ce seul mot. Faux positif réel trouvé en testant le
    // 23/07/2026 ("Guyenne Virginie" matchait "Virginie Virginie") -- corrigé par ce garde-fou.
    const minTokenCount = Math.min(ariTokens.size, personTokens.size);
    const tokenScore = minTokenCount >= 2 ? tokenDiff * 2 : Infinity;
    // Un mot entier en trop/manquant compte pour 2 points de "distance équivalente" (arbitraire mais
    // volontairement moins cher qu'un mot de 6+ lettres en Levenshtein) -- le score retenu est le
    // meilleur des deux angles, pour capter aussi bien un mot ajouté qu'une simple faute de frappe.
    const score = Math.min(tokenScore, charDist);
    if (!best || score < best.score) best = { person, score, tokenDiff, charDist };
  });
  if (best && best.score <= 2) return { status: "fuzzy", person: best.person, distance: best.charDist, tokenDiff: best.tokenDiff };
  return { status: "none" };
}

function ariStripHtmlTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

// Convertit une date au format ARI "JJ/MM/AAAA" vers le format interne "AAAA-MM-JJ".
function ariDateToIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Retrouve une colonne par mot-clé dans la ligne d'en-tête plutôt que par position fixe -- résiste
// à un futur export ARI qui réordonnerait ses colonnes (demande explicite de Samir).
function findAriColumn(headerRow, keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeAriToken(String(headerRow[i] || ""));
    if (keywords.every((kw) => norm.includes(kw))) return i;
  }
  return -1;
}

// Lit le classeur ARI (déjà parsé par SheetJS) et n'extrait QUE ce qui intéresse Samir : congés
// annuels et repos de garde (voir CLAUDE.md/regles-gestion.md) -- les autres types d'absence
// (formation, réunion, "autre motif"...) rencontrés dans l'export réel sont ignorés volontairement.
function parseAriWorkbook(workbook) {
  const sheetName = workbook.SheetNames.find((n) => /absence/i.test(n)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { conges: [], gardes: [], error: "Aucune feuille lisible dans ce fichier." };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return { conges: [], gardes: [], error: `La feuille "${sheetName}" est vide.` };

  const header = rows[0];
  const typeCol = findAriColumn(header, ["type"]);
  const debutCol = findAriColumn(header, ["commenc"]);
  const finCol = findAriColumn(header, ["termine"]);
  const nomCol = findAriColumn(header, ["nom"]);
  if (typeCol === -1 || debutCol === -1 || finCol === -1 || nomCol === -1) {
    return { conges: [], gardes: [], error: `Colonnes attendues introuvables dans la feuille "${sheetName}" -- structure du fichier trop différente de celle prévue.` };
  }

  const conges = [];
  const gardes = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = normalizeAriToken(ariStripHtmlTags(row[typeCol]));
    const ariName = row[nomCol];
    const dateDebut = ariDateToIso(row[debutCol]);
    const dateFin = ariDateToIso(row[finCol]);
    if (!ariName || !dateDebut || !dateFin) continue;

    if (type.includes("conge") && type.includes("annuel")) {
      conges.push({ ariName, dateDebut, dateFin });
    } else if (type.includes("repos") && type.includes("garde")) {
      gardes.push({ ariName, date: dateDebut }); // toujours 1 seul jour côté ARI (dateDebut === dateFin) -- voir RG-013.
    }
  }
  return { conges, gardes, error: null };
}

// Croise les lignes extraites avec state.staff (matchAriNameToStaff()) et state.conges/state.gardes
// (déduplication -- un import répété du même fichier ne doit rien dupliquer). RG-013 : une ligne
// "Repos de garde" côté ARI pour le jour J devient une GARDE le jour J-1 dans notre modèle (le repos
// de garde n'est jamais stocké directement, toujours dérivé -- voir CLAUDE.md §4.9).
function buildAriImportPreview(parsed) {
  const exact = [];
  const fuzzy = [];
  const unrecognized = [];
  let alreadyPresentCount = 0;

  parsed.conges.forEach((row) => {
    const match = matchAriNameToStaff(row.ariName);
    if (match.status === "none") { unrecognized.push({ kind: "conge", ...row }); return; }
    const item = { kind: "conge", ...row, person: match.person, matchStatus: match.status, distance: match.distance };
    const exists = state.conges.some((c) => c.staffId === match.person.id && c.dateDebut === row.dateDebut && c.dateFin === row.dateFin);
    if (exists) { alreadyPresentCount++; return; }
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  parsed.gardes.forEach((row) => {
    const match = matchAriNameToStaff(row.ariName);
    if (match.status === "none") { unrecognized.push({ kind: "garde", ...row }); return; }
    const gardeDate = isoAddDays(row.date, -1);
    const item = { kind: "garde", ...row, gardeDate, person: match.person, matchStatus: match.status, distance: match.distance };
    if (isOnGardeDay(match.person.id, gardeDate)) { alreadyPresentCount++; return; }
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  return { exact, fuzzy, unrecognized, alreadyPresentCount };
}

function applyAriImportItems(items) {
  items.forEach((item) => {
    if (item.kind === "conge") {
      state.conges.push({ id: generateId(), staffId: item.person.id, dateDebut: item.dateDebut, dateFin: item.dateFin });
      // RG-014 : une plage ARI peut couvrir plusieurs jours ouvrés -- dépostage de chacun d'eux
      // (isoWeekdaysInRange() donne directement les jours ouvrés de la plage, week-ends exclus).
      isoWeekdaysInRange(item.dateDebut, item.dateFin).forEach(({ iso }) => depostAssignmentsForDay(item.person.id, iso));
    } else {
      state.gardes.push({ id: generateId(), staffId: item.person.id, date: item.gardeDate });
      depostAssignmentsForReposGardeDay(item.person.id, item.gardeDate); // RG-013/014, voir sa déclaration.
    }
  });
  saveState();
  render();
}

function ariItemLabel(item) {
  const who = `${item.person.prenom} ${item.person.nom}`;
  if (item.kind === "conge") return `${who} — congé du ${item.dateDebut} au ${item.dateFin}`;
  return `${who} — garde le ${item.gardeDate} (repos de garde ARI le ${item.date})`;
}

function openAriImportModal() {
  document.getElementById("ariImportModal").classList.remove("hidden");
  document.getElementById("ariImportModalBody").innerHTML = `
    <p>Choisis le fichier extract ARI (.xlsx) tel quel, sans modification.</p>
    <button type="button" id="btnAriPickFile" class="btn-primary">Choisir le fichier</button>
  `;
  document.getElementById("btnAriPickFile").addEventListener("click", () => {
    document.getElementById("ariFileInput").click();
  });
}

function closeAriImportModal() {
  document.getElementById("ariImportModal").classList.add("hidden");
}

function renderAriImportPreview(preview) {
  const body = document.getElementById("ariImportModalBody");
  body.innerHTML = "";

  if (preview.exact.length === 0 && preview.fuzzy.length === 0) {
    body.innerHTML = '<p class="bulk-hint">Rien de nouveau à importer (déjà à jour, ou fichier non reconnu).</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "bulk-hint";
  summary.textContent = `${plural(preview.exact.length, "élément")} reconnu${preview.exact.length > 1 ? "s" : ""} automatiquement.` +
    (preview.alreadyPresentCount > 0 ? ` ${preview.alreadyPresentCount} déjà présent(s), ignoré(s).` : "");
  body.appendChild(summary);

  if (preview.fuzzy.length > 0) {
    const fuzzyTitle = document.createElement("p");
    fuzzyTitle.className = "bulk-hint";
    fuzzyTitle.textContent = "Noms proches mais pas identiques -- à vérifier avant import (décoche si erroné) :";
    body.appendChild(fuzzyTitle);
  }

  const list = document.createElement("div");
  list.className = "bulk-preview-list";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn-primary";

  const allItems = [...preview.exact, ...preview.fuzzy];
  allItems.forEach((item) => { item.include = true; });

  const updateConfirmLabel = () => {
    const n = allItems.filter((it) => it.include).length;
    confirmBtn.textContent = `Confirmer l'import (${n})`;
    confirmBtn.disabled = n === 0;
  };

  preview.fuzzy.forEach((item) => {
    const row = document.createElement("label");
    row.className = "bulk-preview-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => { item.include = cb.checked; updateConfirmLabel(); });
    row.appendChild(cb);
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = `ARI : "${item.ariName.trim()}" → ${ariItemLabel(item)}`;
    row.appendChild(info);
    list.appendChild(row);
  });

  preview.exact.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bulk-preview-row bulk-preview-duplicate";
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = ariItemLabel(item);
    row.appendChild(info);
    list.appendChild(row);
  });

  body.appendChild(list);

  if (preview.unrecognized.length > 0) {
    const details = document.createElement("details");
    details.className = "bulk-ignored";
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = `${plural(preview.unrecognized.length, "nom")} non reconnu${preview.unrecognized.length > 1 ? "s" : ""}, ignoré${preview.unrecognized.length > 1 ? "s" : ""}`;
    details.appendChild(summaryEl);
    const pre = document.createElement("pre");
    pre.textContent = preview.unrecognized.map((it) => it.ariName.trim()).join("\n");
    details.appendChild(pre);
    body.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    applyAriImportItems(allItems.filter((it) => it.include));
    closeAriImportModal();
  });
  body.appendChild(confirmBtn);
}

document.getElementById("btnImportAri").addEventListener("click", openAriImportModal);
document.getElementById("ariImportModalClose").addEventListener("click", closeAriImportModal);
document.getElementById("ariImportModal").addEventListener("click", (e) => {
  if (e.target.id === "ariImportModal") closeAriImportModal();
});

document.getElementById("ariFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const workbook = XLSX.read(new Uint8Array(reader.result), { type: "array" });
      const parsed = parseAriWorkbook(workbook);
      if (parsed.error) {
        document.getElementById("ariImportModalBody").innerHTML = `<p class="bulk-hint">${parsed.error}</p>`;
        return;
      }
      const preview = buildAriImportPreview(parsed);
      renderAriImportPreview(preview);
    } catch (err) {
      document.getElementById("ariImportModalBody").innerHTML = `<p class="bulk-hint">Fichier illisible : ${err.message}</p>`;
    }
  };
  reader.readAsArrayBuffer(file);
});

// ---------- Import gardes (24/10/2026) ----------
// Demande de Samir : un bouton "Importer gardes" qui lit un export de planning de gardes (.xlsx --
// feuille "Gardes", colonnes Date / demie garde / Garde) et AJOUTE les nouvelles gardes. Deux règles
// explicites : (1) on n'ajoute que des gardes nouvelles, on ne touche JAMAIS à une garde existante
// (aucun retrait, aucune modification, même si elle a disparu du fichier) ; (2) une personne inconnue
// est ignorée (listée pour info, jamais créée). La colonne "demie garde" est volontairement ignorée
// (tranché avec Samir : notre modèle n'a pas de notion de demi-garde, une garde = journée entière +
// repos de garde le lendemain, RG-013). Reconnaissance des noms : matchAriNameToStaff() (même
// triptyque exact/proche/inconnu que l'import ARI), plus un cas "initiales" -- l'export abrège parfois
// un prénom composé ("Pl Mercier" pour Pierre-Loup Mercier).

// "Pl Mercier" -> Pierre-Loup Mercier : un mot de 2-3 lettres égal aux initiales du prénom composé,
// le reste des mots identique au nom. Uniquement si UNE SEULE personne correspond (sinon ambigu -> inconnu).
function matchGardeNameByInitials(rawName) {
  const tokens = normalizeAriToken(rawName).split(/\s+/).filter(Boolean);
  const candidates = state.staff.filter((person) => {
    const prenomParts = normalizeAriToken(person.prenom).split(/[\s-]+/).filter(Boolean);
    if (prenomParts.length < 2) return false;
    const initials = prenomParts.map((p) => p[0]).join("");
    const nomTokens = ariNameTokenSet(person.nom);
    const rest = tokens.filter((t) => t !== initials);
    return rest.length === tokens.length - 1 && rest.length === nomTokens.size && rest.every((t) => nomTokens.has(t));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function matchGardeNameToStaff(rawName) {
  const match = matchAriNameToStaff(rawName);
  if (match.status === "exact") return match;
  const byInitials = matchGardeNameByInitials(rawName);
  if (byInitials) return { status: "exact", person: byInitials };
  return match;
}

// Date de cellule -> "AAAA-MM-JJ". SheetJS lu en `raw: true` : une vraie date Excel arrive en numéro
// de série (jours depuis 1899-12-30), converti en UTC pour ne jamais glisser d'un jour selon le
// fuseau (même famille de piège que weekKey(), §6.43bis). Accepte aussi "JJ/MM/AAAA" et "AAAA-MM-JJ".
function gardeCellToIso(value) {
  if (typeof value === "number" && isFinite(value)) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(value || "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseGardeWorkbook(workbook) {
  const sheetName = workbook.SheetNames.find((n) => /garde/i.test(n)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], error: "Aucune feuille lisible dans ce fichier." };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (rows.length < 2) return { rows: [], error: `La feuille "${sheetName}" est vide.` };

  const header = rows[0].map((h) => normalizeAriToken(String(h || "")));
  const dateCol = header.findIndex((h) => h.includes("date"));
  // "Garde" mais pas "demie garde" -- colonne de la garde complète uniquement.
  const gardeCol = header.findIndex((h) => h.includes("garde") && !/\bdemi/.test(h));
  if (dateCol === -1 || gardeCol === -1) {
    return { rows: [], error: `Colonnes "Date" et "Garde" introuvables dans la feuille "${sheetName}".` };
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const iso = gardeCellToIso(rows[i][dateCol]);
    const name = String(rows[i][gardeCol] || "").trim();
    if (iso && name) out.push({ date: iso, name });
  }
  return { rows: out, error: null };
}

function buildGardeImportPreview(parsed) {
  const exact = [];
  const fuzzy = [];
  const unrecognized = new Map(); // nom brut -> nombre de lignes
  const seen = new Set();
  let alreadyPresentCount = 0;

  parsed.rows.forEach((row) => {
    const match = matchGardeNameToStaff(row.name);
    if (match.status === "none") {
      unrecognized.set(row.name, (unrecognized.get(row.name) || 0) + 1);
      return;
    }
    const dedupeKey = `${match.person.id}|${row.date}`;
    if (seen.has(dedupeKey)) return; // doublon à l'intérieur du fichier lui-même
    seen.add(dedupeKey);
    if (isOnGardeDay(match.person.id, row.date)) { alreadyPresentCount++; return; }
    const item = { ...row, person: match.person, matchStatus: match.status };
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  const byDate = (a, b) => a.date.localeCompare(b.date);
  exact.sort(byDate);
  fuzzy.sort(byDate);
  return { exact, fuzzy, unrecognized, alreadyPresentCount, total: parsed.rows.length };
}

// Ajout pur (règle n°1) -- même chemin qu'une garde posée à la main (toggleGardeDay()) côté effets :
// repos de garde automatique le lendemain (RG-013, dérivé, rien à stocker) et dépostage de ce jour de
// repos (RG-014, depostAssignmentsForReposGardeDay()). Jamais de retrait : isOnGardeDay() est revérifié
// juste avant chaque ajout.
function applyGardeImportItems(items) {
  let added = 0;
  items.forEach((item) => {
    if (isOnGardeDay(item.person.id, item.date)) return;
    state.gardes.push({ id: generateId(), staffId: item.person.id, date: item.date });
    depostAssignmentsForReposGardeDay(item.person.id, item.date);
    added++;
  });
  saveState();
  render();
  return added;
}

function gardeItemLabel(item) {
  const d = new Date(`${item.date}T00:00:00`);
  const dayName = d.toLocaleDateString("fr-FR", { weekday: "short" });
  return `${dayName} ${formatShort(d)}/${d.getFullYear()} — ${item.person.prenom} ${item.person.nom}`;
}

function openGardeImportModal() {
  document.getElementById("gardeImportModal").classList.remove("hidden");
  document.getElementById("gardeImportModalBody").innerHTML = `
    <p>Choisis le fichier de gardes (.xlsx). Seules les <strong>nouvelles</strong> gardes sont ajoutées : rien de ce qui existe déjà n'est modifié ni retiré, et les personnes inconnues sont ignorées.</p>
    <button type="button" id="btnGardePickFile" class="btn-primary">Choisir le fichier</button>
  `;
  document.getElementById("btnGardePickFile").addEventListener("click", () => {
    document.getElementById("gardeFileInput").click();
  });
}

function closeGardeImportModal() {
  document.getElementById("gardeImportModal").classList.add("hidden");
}

function renderGardeImportPreview(preview) {
  const body = document.getElementById("gardeImportModalBody");
  body.innerHTML = "";

  const summary = document.createElement("p");
  summary.className = "bulk-hint";
  const unknownLines = [...preview.unrecognized.values()].reduce((a, b) => a + b, 0);
  summary.textContent = `${preview.total} ligne(s) lue(s) : ${preview.exact.length + preview.fuzzy.length} nouvelle(s) garde(s)` +
    `, ${preview.alreadyPresentCount} déjà présente(s) (ignorée(s))` +
    (unknownLines ? `, ${unknownLines} ligne(s) avec une personne inconnue (ignorée(s))` : "") + ".";
  body.appendChild(summary);

  const allItems = [...preview.fuzzy, ...preview.exact];
  allItems.forEach((item) => { item.include = true; });

  if (allItems.length > 0) {
    if (preview.fuzzy.length > 0) {
      const fuzzyTitle = document.createElement("p");
      fuzzyTitle.className = "bulk-hint";
      fuzzyTitle.textContent = "Noms proches mais pas identiques — à vérifier (décoche si erroné) :";
      body.appendChild(fuzzyTitle);
    }
    const list = document.createElement("div");
    list.className = "bulk-preview-list";
    preview.fuzzy.forEach((item) => {
      const row = document.createElement("label");
      row.className = "bulk-preview-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.addEventListener("change", () => { item.include = cb.checked; updateConfirmLabel(); });
      const info = document.createElement("span");
      info.className = "bulk-preview-info";
      info.textContent = `Fichier : "${item.name}" → ${gardeItemLabel(item)}`;
      row.append(cb, info);
      list.appendChild(row);
    });
    preview.exact.forEach((item) => {
      const row = document.createElement("div");
      row.className = "bulk-preview-row bulk-preview-duplicate";
      const info = document.createElement("span");
      info.className = "bulk-preview-info";
      info.textContent = gardeItemLabel(item);
      row.appendChild(info);
      list.appendChild(row);
    });
    body.appendChild(list);
  } else {
    const none = document.createElement("p");
    none.className = "bulk-hint";
    none.textContent = "Rien de nouveau à importer.";
    body.appendChild(none);
  }

  if (preview.unrecognized.size > 0) {
    const details = document.createElement("details");
    details.className = "bulk-ignored";
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = `${plural(preview.unrecognized.size, "personne")} inconnue${preview.unrecognized.size > 1 ? "s" : ""}, ignorée${preview.unrecognized.size > 1 ? "s" : ""}`;
    details.appendChild(summaryEl);
    const pre = document.createElement("pre");
    pre.textContent = [...preview.unrecognized.entries()].map(([name, n]) => `${name} (${n} garde${n > 1 ? "s" : ""})`).join("\n");
    details.appendChild(pre);
    body.appendChild(details);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn-primary";
  const updateConfirmLabel = () => {
    const n = allItems.filter((it) => it.include).length;
    confirmBtn.textContent = `Importer ${plural(n, "garde")}`;
    confirmBtn.disabled = n === 0;
  };
  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    const added = applyGardeImportItems(allItems.filter((it) => it.include));
    body.innerHTML = `<p class="bulk-hint">${plural(added, "garde")} ajoutée${added > 1 ? "s" : ""}.</p>`;
  });
  if (allItems.length > 0) body.appendChild(confirmBtn);
}

document.getElementById("btnImportGardes").addEventListener("click", openGardeImportModal);
document.getElementById("gardeImportModalClose").addEventListener("click", closeGardeImportModal);
document.getElementById("gardeImportModal").addEventListener("click", (e) => {
  if (e.target.id === "gardeImportModal") closeGardeImportModal();
});

document.getElementById("gardeFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const body = document.getElementById("gardeImportModalBody");
    try {
      const workbook = XLSX.read(new Uint8Array(reader.result), { type: "array" });
      const parsed = parseGardeWorkbook(workbook);
      if (parsed.error) { body.innerHTML = `<p class="bulk-hint">${parsed.error}</p>`; return; }
      renderGardeImportPreview(buildGardeImportPreview(parsed));
    } catch (err) {
      body.innerHTML = `<p class="bulk-hint">Fichier illisible : ${err.message}</p>`;
    }
  };
  reader.readAsArrayBuffer(file);
});
