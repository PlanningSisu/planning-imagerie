// ---------- Import trame personnel (Off / Bureau / Temps Partiel), 25/07/2026 ----------
// Texte libre collé par Samir (liste RH type "Off le mercredi" / "Bureau le mardi après-midi" /
// "Présent(e) le lundi matin"), à ne pas confondre avec l'extract ARI ci-dessus (fichier .xlsx,
// congés/gardes). Écrit dans state.trame (Off/Bureau, RG-017) et state.tempsPartiel (RG-020).

const DAY_NAME_RE = /(lundi|mardi|mercredi|jeudi|vendredi)/i;

// Isole le nom de jour (n'importe où dans le fragment -- inutile de retirer "le"/"la"/"les" avant,
// la regex le trouve directement) et ce qui suit ("après-midi", "toute la journée"...).
function describeDayFragment(fragment) {
  const m = DAY_NAME_RE.exec(fragment);
  if (!m) return null;
  const day = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const rest = fragment.slice(m.index + m[0].length).trim();
  return { day, slotText: rest, hasExplicitSlot: rest.length > 0 };
}

// "" ou "toute la journée" -> jour entier ; "après-midi"/"après midi"/"apres-midi" (tolérant à
// l'absence de tiret, rencontrée dans le texte réel) -> après-midi seul ; "matin" -> matin seul.
function slotTextToCreneaux(slotText) {
  const norm = normalizeToken(slotText || "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (!norm || norm.includes("toute")) return ["matin", "apres-midi"];
  if (norm.includes("apres") && norm.includes("midi")) return ["apres-midi"];
  if (norm.includes("matin")) return ["matin"];
  return ["matin", "apres-midi"]; // texte non reconnu -- jour entier par défaut plutôt que rien.
}

// Analyse un texte de jours/créneaux ("le mardi après-midi et vendredi matin", "mardi toute la
// journée", "lundi et mardi toute la journée"...) en une liste de {day, creneauId}. Cas particulier :
// "jourA et jourB <suffixe>" où seul jourB porte un suffixe explicite (matin/après-midi/toute la
// journée) -- ce suffixe s'applique alors AUSSI à jourA (ex. "lundi et mardi toute la journée" = les
// deux jours entiers), distinct du cas où les deux jours ont chacun leur propre suffixe (ex. "jeudi
// matin et vendredi toute la journée", traités indépendamment).
function parseDaySlotsText(text) {
  const result = [];
  const addFragment = (desc) => {
    if (!desc) return;
    slotTextToCreneaux(desc.slotText).forEach((creneauId) => result.push({ day: desc.day, creneauId }));
  };

  String(text || "").split(/\s*,\s*/).forEach((commaPart) => {
    const etParts = commaPart.split(/\s+et\s+/i);
    if (etParts.length === 2) {
      const a = describeDayFragment(etParts[0]);
      const b = describeDayFragment(etParts[1]);
      if (a && b && !a.hasExplicitSlot) {
        addFragment({ day: a.day, slotText: b.slotText });
        addFragment(b);
      } else {
        addFragment(a);
        addFragment(b);
      }
    } else {
      addFragment(describeDayFragment(commaPart));
    }
  });
  return result;
}

// En-têtes de section reconnus dans le texte collé -- tout ce qui précède le premier en-tête
// reconnu est ignoré (pas de section active). "Temps pleins"/"CCA" partagent le même format
// (Off + Bureau, multi-lignes par personne) ; "Temps partiel" a son propre format (1 ligne par
// personne, "Prénom Nom Présent(e) ...").
const TRAME_IMPORT_SECTION_RE = /^(temps\s*plein|cca|temps\s*partiel)s?$/i;

function parseTrameImportText(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fullEntries = []; // { rawName, offSlots: [...], bureauSlots: [...] }
  const tpEntries = []; // { rawName, presentSlots: [...] }

  let section = null; // "full" | "tp"
  let current = null; // entrée "full" en cours (rattache les lignes "Off"/"Bureau" suivantes)

  lines.forEach((line) => {
    if (TRAME_IMPORT_SECTION_RE.test(line)) {
      section = /partiel/i.test(line) ? "tp" : "full";
      current = null;
      return;
    }
    if (!section) return;

    if (section === "tp") {
      const m = /^(.+?)\s+Pr[ée]sente?\s+(.+)$/i.exec(line);
      if (m) tpEntries.push({ rawName: m[1].trim(), presentSlots: parseDaySlotsText(m[2].trim()) });
      return;
    }

    const offMatch = /^Off\s+(.+)$/i.exec(line);
    const bureauMatch = /^Bureau\s+(.+)$/i.exec(line);
    if (offMatch && current) {
      current.offSlots = parseDaySlotsText(offMatch[1].trim());
    } else if (bureauMatch && current) {
      current.bureauSlots = parseDaySlotsText(bureauMatch[1].trim());
    } else {
      current = { rawName: line, offSlots: [], bureauSlots: [] };
      fullEntries.push(current);
    }
  });

  return { fullEntries, tpEntries };
}

// Rapprochement tolérant aux fautes -- réutilise matchAriNameToStaff() (générique malgré son nom,
// compare simplement un nom brut à state.staff par ensemble de mots normalisés), même pattern
// exact/fuzzy/non-reconnu que l'import ARI.
function buildTrameImportPreview(parsed) {
  const exact = [];
  const fuzzy = [];
  const unrecognized = [];

  parsed.fullEntries.forEach((entry) => {
    const match = matchAriNameToStaff(entry.rawName);
    if (match.status === "none") { unrecognized.push({ rawName: entry.rawName }); return; }
    const item = { kind: "full", rawName: entry.rawName, person: match.person, offSlots: entry.offSlots, bureauSlots: entry.bureauSlots };
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  parsed.tpEntries.forEach((entry) => {
    const match = matchAriNameToStaff(entry.rawName);
    if (match.status === "none") { unrecognized.push({ rawName: entry.rawName }); return; }
    const item = { kind: "tp", rawName: entry.rawName, person: match.person, presentSlots: entry.presentSlots };
    (match.status === "exact" ? exact : fuzzy).push(item);
  });

  return { exact, fuzzy, unrecognized };
}

function clearTrameActivitiesForSlot(staffId, day, creneauId) {
  state.activities.forEach((activity) => {
    const key = trameKey(activity.id, day, creneauId);
    if (state.trame[key]) state.trame[key] = state.trame[key].filter((id) => id !== staffId);
  });
}

// Idempotent, comme l'import ARI : ré-appliquer le même texte (ou un texte mis à jour) ne laisse
// jamais de trace de l'ancien horaire -- pour "full", ajoute simplement (sans dupliquer) ; pour
// "tp", recalcule les 10 créneaux (5 jours x matin/après-midi) en entier à chaque fois (les
// créneaux "présents" redeviennent normaux, les autres repassent/restent Temps Partiel).
function applyTrameImportItems(items) {
  items.forEach((item) => {
    if (item.kind === "full") {
      item.offSlots.forEach(({ day, creneauId }) => {
        const key = trameKey("off", day, creneauId);
        if (!state.trame[key]) state.trame[key] = [];
        if (!state.trame[key].includes(item.person.id)) state.trame[key].push(item.person.id);
      });
      item.bureauSlots.forEach(({ day, creneauId }) => {
        const key = trameKey("bureau", day, creneauId);
        if (!state.trame[key]) state.trame[key] = [];
        if (!state.trame[key].includes(item.person.id)) state.trame[key].push(item.person.id);
      });
    } else {
      const presentSet = new Set(item.presentSlots.map(({ day, creneauId }) => `${day}|${creneauId}`));
      DAYS.forEach((day) => {
        ["matin", "apres-midi"].forEach((creneauId) => {
          const flagKey = tpKey(item.person.id, day, creneauId);
          if (presentSet.has(`${day}|${creneauId}`)) {
            delete state.tempsPartiel[flagKey];
          } else {
            clearTrameActivitiesForSlot(item.person.id, day, creneauId);
            state.tempsPartiel[flagKey] = true;
          }
        });
      });
    }
  });
  saveState();
  render();
}

function trameImportSlotsLabel(slots) {
  return slots.map((s) => `${s.day} ${s.creneauId === "matin" ? "matin" : "après-midi"}`).join(", ");
}

function trameImportItemLabel(item) {
  const who = `${item.person.prenom} ${item.person.nom}`;
  if (item.kind === "full") {
    const parts = [];
    if (item.offSlots.length) parts.push(`Off : ${trameImportSlotsLabel(item.offSlots)}`);
    if (item.bureauSlots.length) parts.push(`Bureau : ${trameImportSlotsLabel(item.bureauSlots)}`);
    return `${who} — ${parts.join(" · ") || "rien à appliquer"}`;
  }
  return `${who} — Temps Partiel (présent : ${trameImportSlotsLabel(item.presentSlots) || "aucun créneau"})`;
}

function openTrameImportModal() {
  document.getElementById("trameImportModal").classList.remove("hidden");
  document.getElementById("trameImportModalBody").innerHTML = `
    <p class="bulk-hint">Colle le texte listant Off / Bureau (Temps pleins, CCA) et Temps partiel, puis clique sur Analyser.</p>
    <textarea id="trameImportTextarea" rows="14" style="width:100%;box-sizing:border-box;"></textarea>
    <button type="button" id="btnTrameImportParse" class="btn-primary" style="margin-top:8px;">Analyser</button>
  `;
  document.getElementById("btnTrameImportParse").addEventListener("click", () => {
    const text = document.getElementById("trameImportTextarea").value;
    const preview = buildTrameImportPreview(parseTrameImportText(text));
    renderTrameImportPreview(preview);
  });
}

function closeTrameImportModal() {
  document.getElementById("trameImportModal").classList.add("hidden");
}

function renderTrameImportPreview(preview) {
  const body = document.getElementById("trameImportModalBody");
  body.innerHTML = "";

  if (preview.exact.length === 0 && preview.fuzzy.length === 0) {
    body.innerHTML = '<p class="bulk-hint">Rien de reconnu dans ce texte (vérifie le format, ou tout le monde est déjà à jour).</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "bulk-hint";
  summary.textContent = `${plural(preview.exact.length, "personne")} reconnue${preview.exact.length > 1 ? "s" : ""} automatiquement.`;
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
    info.textContent = `"${item.rawName}" → ${trameImportItemLabel(item)}`;
    row.appendChild(info);
    list.appendChild(row);
  });

  preview.exact.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bulk-preview-row bulk-preview-duplicate";
    const info = document.createElement("span");
    info.className = "bulk-preview-info";
    info.textContent = trameImportItemLabel(item);
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
    pre.textContent = preview.unrecognized.map((it) => it.rawName).join("\n");
    details.appendChild(pre);
    body.appendChild(details);
  }

  updateConfirmLabel();
  confirmBtn.addEventListener("click", () => {
    applyTrameImportItems(allItems.filter((it) => it.include));
    closeTrameImportModal();
  });
  body.appendChild(confirmBtn);
}

document.getElementById("btnImportTrame").addEventListener("click", openTrameImportModal);
document.getElementById("trameImportModalClose").addEventListener("click", closeTrameImportModal);
document.getElementById("trameImportModal").addEventListener("click", (e) => {
  if (e.target.id === "trameImportModal") closeTrameImportModal();
});

