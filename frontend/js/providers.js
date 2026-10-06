let providerMeta = { provider_types: [], capabilities: [] };
let editingProviderId = null;

async function loadProviders() {
  const [list, meta] = await Promise.all([api("/providers"), api("/providers/meta")]);
  state.providers = list; providerMeta = meta;
  renderProviders(); renderManagerSelect();
  renderCapabilityChecks();
}
function renderCapabilityChecks() {
  el("capabilities-checks").innerHTML = providerMeta.capabilities.map((c) => `<label><input type="checkbox" name="cap" value="${c}" />${c}</label>`).join("");
}
function renderProviders() {
  const grid = el("providers-list");
  if (!state.providers) return;
  grid.innerHTML = state.providers.length ? "" : `<p class="subtle">No providers configured yet. Click "+ Add AI Provider".</p>`;
  for (const p of state.providers) {
    const status = p.last_status || "untested";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(p.name)} <span class="badge ${status}">${status.replace("_", " ")}</span>${p.enabled ? "" : ` <span class="badge disabled">disabled</span>`}</h3>
      <p class="subtle">${escapeHtml(p.provider_type)} · ${escapeHtml(p.model)}</p>
      <p class="subtle">Key: ${escapeHtml(p.api_key_masked)} · Role: ${p.role} · Priority: ${p.priority}</p>
      ${p.capabilities.length ? `<p class="subtle">${p.capabilities.map((c) => `<span class="badge untested">${c}</span>`).join(" ")}</p>` : ""}
      ${p.last_latency_ms ? `<p class="subtle">Latency: ${p.last_latency_ms}ms${p.last_checked_at ? " · " + fmtTime(p.last_checked_at) : ""}</p>` : ""}
      ${p.last_error ? `<p class="subtle" style="color:var(--danger)">${escapeHtml(p.last_error)}</p>` : ""}
      <div class="card-actions">
        <button class="secondary-btn" data-test="${p.id}">Test</button>
        <button class="secondary-btn" data-edit="${p.id}">Edit</button>
        <button class="secondary-btn" data-dup="${p.id}">Duplicate</button>
        <button class="secondary-btn" data-toggle="${p.id}">${p.enabled ? "Disable" : "Enable"}</button>
        <button class="secondary-btn" data-delete="${p.id}">Delete</button>
      </div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => testProvider(b.dataset.test)));
  grid.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openProviderModal(b.dataset.edit)));
  grid.querySelectorAll("[data-dup]").forEach((b) => b.addEventListener("click", async () => { await api(`/providers/${b.dataset.dup}/duplicate`, { method: "POST" }); await loadProviders(); toast("Duplicated (disabled by default)."); }));
  grid.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => toggleProvider(b.dataset.toggle)));
  grid.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteProviderUi(b.dataset.delete)));
}
function renderManagerSelect() {
  const sel = el("manager-select");
  const cur = sel.value;
  const enabled = state.providers.filter((p) => p.enabled);
  sel.innerHTML = enabled.length ? `<option value="">Auto</option>` + enabled.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("") : `<option value="">No providers enabled</option>`;
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function testProvider(id) {
  const result = await api(`/providers/${id}/test`, { method: "POST" });
  await loadProviders();
  toast(`Test result: ${result.status}${result.error ? " — " + result.error : ""}`, result.status !== "connected");
  if (editingProviderId === id) el("provider-test-result").textContent = `${result.status}${result.error ? " — " + result.error : ""}`;
}
async function toggleProvider(id) {
  const p = state.providers.find((p) => p.id === id);
  await api(`/providers/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: !p.enabled }) });
  await loadProviders();
}
async function deleteProviderUi(id) {
  if (!(await confirmDialog("Delete provider?", "This removes the saved API key and configuration. This cannot be undone."))) return;
  await api(`/providers/${id}`, { method: "DELETE" });
  await loadProviders();
}

function openProviderModal(id) {
  editingProviderId = id || null;
  const form = el("provider-form");
  form.reset();
  el("provider-test-result").textContent = "";
  el("model-suggestions").style.display = "none";
  el("provider-modal-title").textContent = id ? "Edit AI Provider" : "Add AI Provider";
  renderCapabilityChecks();
  if (id) {
    const p = state.providers.find((x) => x.id === id);
    form.name.value = p.name; form.provider_type.value = p.provider_type; form.base_url.value = p.base_url;
    form.model.value = p.model; form.role.value = p.role; form.temperature.value = p.temperature; form.max_tokens.value = p.max_tokens;
    form.priority.value = p.priority; form.enabled.checked = p.enabled;
    form.requests_per_minute.value = p.requests_per_minute ?? ""; form.tokens_per_minute.value = p.tokens_per_minute ?? "";
    form.daily_limit.value = p.daily_limit ?? ""; form.monthly_budget.value = p.monthly_budget ?? "";
    form.input_price_per_1k.value = p.input_price_per_1k ?? ""; form.output_price_per_1k.value = p.output_price_per_1k ?? "";
    form.querySelectorAll('input[name="cap"]').forEach((c) => { c.checked = p.capabilities.includes(c.value); });
    form.api_key.placeholder = `Current: ${p.api_key_masked} (leave blank to keep)`;
  } else {
    form.api_key.placeholder = "";
  }
  el("provider-modal").style.display = "flex";
}
el("add-provider-btn").addEventListener("click", () => openProviderModal(null));
el("provider-cancel-btn").addEventListener("click", () => { el("provider-modal").style.display = "none"; });

el("discover-models-btn").addEventListener("click", async () => {
  const form = el("provider-form");
  const box = el("model-suggestions");
  try {
    let models;
    if (editingProviderId && !form.api_key.value) models = (await api(`/providers/${editingProviderId}/models`)).models;
    else models = (await api("/providers/discover-models", { method: "POST", body: JSON.stringify({ provider_type: form.provider_type.value, base_url: form.base_url.value, api_key: form.api_key.value }) })).models;
    box.innerHTML = models.length ? models.map((m) => `<div class="cmd-row" data-m="${escapeHtml(m)}">${escapeHtml(m)}</div>`).join("") : `<div class="cmd-row">No models returned</div>`;
    box.style.display = "block";
    box.querySelectorAll("[data-m]").forEach((row) => row.addEventListener("click", () => { form.model.value = row.dataset.m; box.style.display = "none"; }));
  } catch (e) { toast(e.message, true); }
});

el("provider-test-btn").addEventListener("click", async () => {
  if (editingProviderId) return testProvider(editingProviderId);
  toast("Save the provider first, then use Test on its card.");
});

el("provider-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get("name"), provider_type: fd.get("provider_type"), base_url: fd.get("base_url") || "", model: fd.get("model"),
    role: fd.get("role"), temperature: parseFloat(fd.get("temperature")), max_tokens: parseInt(fd.get("max_tokens"), 10),
    priority: parseInt(fd.get("priority"), 10), enabled: fd.get("enabled") === "on",
    capabilities: [...e.target.querySelectorAll('input[name="cap"]:checked')].map((c) => c.value),
  };
  for (const [k, num] of [["requests_per_minute", true], ["tokens_per_minute", true], ["daily_limit", true], ["monthly_budget", false], ["input_price_per_1k", false], ["output_price_per_1k", false]]) {
    const v = fd.get(k);
    payload[k] = v === "" || v === null ? null : (num ? parseInt(v, 10) : parseFloat(v));
  }
  const apiKey = fd.get("api_key");
  if (apiKey) payload.api_key = apiKey;
  try {
    if (editingProviderId) await api(`/providers/${editingProviderId}`, { method: "PATCH", body: JSON.stringify(payload) });
    else { if (!apiKey) return toast("API key is required for a new provider.", true); await api("/providers", { method: "POST", body: JSON.stringify(payload) }); }
    el("provider-modal").style.display = "none";
    await loadProviders();
    toast("Provider saved.");
  } catch (err) { toast(err.message, true); }
});
