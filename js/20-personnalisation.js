// ---------- Personnalisation (25/07/2026) ----------
// Quelques couleurs éditables depuis l'appli sans passer par un changement de code (demande de
// Samir, suite aux allers-retours sur la couleur du séparateur de jour, §6.28) -- voir
// CUSTOM_COLOR_FIELDS/applyCustomColors() plus haut (state.customColors, persistée comme le reste).

function openCustomizeModal() {
  document.getElementById("customizeModal").classList.remove("hidden");
  renderCustomizeModalBody();
}

function closeCustomizeModal() {
  document.getElementById("customizeModal").classList.add("hidden");
}

function renderCustomizeModalBody() {
  const body = document.getElementById("customizeModalBody");
  body.innerHTML = '<p class="bulk-hint">Ajuste quelques couleurs de l\'appli -- appliqué immédiatement, sans recharger.</p>';

  CUSTOM_COLOR_FIELDS.forEach(({ key, cssVar, label, widthKey, widthVar }) => {
    const row = document.createElement("div");
    row.className = "customize-row";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = "color";
    // Valeur actuelle = state.customColors[key] si personnalisée, sinon la valeur par défaut
    // définie dans :root (style.css) -- un <input type="color"> exige toujours une vraie valeur.
    input.value = state.customColors[key] || getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    input.addEventListener("input", () => {
      state.customColors[key] = input.value;
      applyCustomColors();
      saveState();
    });
    row.appendChild(input);

    // Réglage d'épaisseur (25/07/2026, demande de Samir) : seul le séparateur de jour en a un.
    if (widthKey) {
      const defaultWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue(widthVar), 10) || 2;
      const widthInput = document.createElement("input");
      widthInput.type = "range";
      widthInput.min = "1";
      widthInput.max = "6";
      widthInput.step = "1";
      widthInput.className = "customize-width-input";
      widthInput.title = "Épaisseur du trait";
      widthInput.value = state.customColors[widthKey] || defaultWidth;
      widthInput.addEventListener("input", () => {
        state.customColors[widthKey] = widthInput.value;
        applyCustomColors();
        saveState();
      });
      row.appendChild(widthInput);
    }

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "customize-reset-btn";
    resetBtn.textContent = "Réinitialiser";
    resetBtn.addEventListener("click", () => {
      delete state.customColors[key];
      if (widthKey) delete state.customColors[widthKey];
      applyCustomColors();
      saveState();
      renderCustomizeModalBody();
    });
    row.appendChild(resetBtn);

    body.appendChild(row);
  });
}

document.getElementById("btnCustomize").addEventListener("click", openCustomizeModal);
document.getElementById("customizeModalClose").addEventListener("click", closeCustomizeModal);
document.getElementById("customizeModal").addEventListener("click", (e) => {
  if (e.target.id === "customizeModal") closeCustomizeModal();
});

