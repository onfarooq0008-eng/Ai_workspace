async function loadAgents() {
  state.agents = await api("/agents");
  state.roleMeta = Object.fromEntries(state.agents.map((a) => [a.role, a]));
  return state.agents;
}
function renderAgents() {
  const grid = el("agents-list");
  grid.innerHTML = "";
  for (const a of state.agents) {
    const cfg = a.config;
    const card = document.createElement("div");
    card.className = "card";
    const isManagerLike = a.role === "manager" || a.role === "planner";
    card.innerHTML = `
      <h3>${a.avatar} ${escapeHtml(a.label)}${!cfg.enabled ? ` <span class="badge disabled">disabled</span>` : ""}</h3>
      <p class="subtle">${escapeHtml(a.description)}</p>
      <label class="subtle">Model override
        <select data-field="provider_id">
          <option value="">Auto (best match)</option>
          ${state.providers.map((p) => `<option value="${p.id}" ${cfg.provider_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
      <p class="subtle">Currently resolves to: ${a.effective_provider ? escapeHtml(a.effective_provider.name) : "—"}</p>
      <div class="row-2">
        <label class="subtle">Temp <input data-field="temperature" type="number" step="0.1" min="0" max="2" value="${cfg.temperature ?? ""}" placeholder="default" /></label>
        <label class="subtle">Max tokens <input data-field="max_tokens" type="number" value="${cfg.max_tokens ?? ""}" placeholder="default" /></label>
      </div>
      <label class="subtle">Extra instructions <textarea data-field="extra_instructions" rows="2" style="font-size:0.78rem;">${escapeHtml(cfg.extra_instructions || "")}</textarea></label>
      <p class="subtle">Tools: ${a.tools.length ? a.tools.join(", ") : "none"}</p>
      <div class="card-actions">
        ${!isManagerLike ? `<button class="secondary-btn" data-toggle-enabled="${a.role}">${cfg.enabled ? "Disable" : "Enable"}</button>` : ""}
        <button class="secondary-btn" data-save="${a.role}">Save</button>
      </div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => saveAgentCard(b.dataset.save, b.closest(".card"))));
  grid.querySelectorAll("[data-toggle-enabled]").forEach((b) => b.addEventListener("click", () => toggleAgentEnabled(b.dataset.toggleEnabled)));
}
async function saveAgentCard(role, card) {
  const providerId = card.querySelector('[data-field="provider_id"]').value;
  const temp = card.querySelector('[data-field="temperature"]').value;
  const maxTok = card.querySelector('[data-field="max_tokens"]').value;
  const extra = card.querySelector('[data-field="extra_instructions"]').value;
  try {
    await api(`/agents/${role}`, { method: "PUT", body: JSON.stringify({ provider_id: providerId || null, temperature: temp === "" ? null : parseFloat(temp), max_tokens: maxTok === "" ? null : parseInt(maxTok, 10), extra_instructions: extra }) });
    await loadAgents(); renderAgents();
    toast(`${role} saved.`);
  } catch (e) { toast(e.message, true); }
}
async function toggleAgentEnabled(role) {
  const cfg = state.roleMeta[role].config;
  await api(`/agents/${role}`, { method: "PUT", body: JSON.stringify({ enabled: !cfg.enabled }) });
  await loadAgents(); renderAgents();
}
