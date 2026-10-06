async function loadSettings() {
  state.settings = await api("/settings");
  renderSettings();
  renderTokens();
  renderUserMemory();
  renderBackups();
}
function controlFor(def, value) {
  if (def.type === "boolean") return `<input type="checkbox" data-key="${def.key}" ${value ? "checked" : ""} />`;
  if (def.type === "select") return `<select data-key="${def.key}">${def.options.map((o) => `<option value="${o}" ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  if (def.type === "providerSelect") return `<select data-key="${def.key}"><option value="">(none)</option>${state.providers.map((p) => `<option value="${p.id}" ${p.id === value ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select>`;
  if (def.type === "providerMulti") return `<select data-key="${def.key}" multiple size="3">${state.providers.map((p) => `<option value="${p.id}" ${(value || []).includes(p.id) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select>`;
  if (def.type === "number") return `<input type="number" data-key="${def.key}" value="${value}" min="${def.min ?? ""}" max="${def.max ?? ""}" />`;
  return `<input type="text" data-key="${def.key}" value="${escapeHtml(String(value ?? ""))}" />`;
}
function renderSettings() {
  const groups = {};
  for (const d of state.settings.definitions) (groups[d.group] ||= []).push(d);
  el("settings-groups").innerHTML = Object.entries(groups).map(([name, defs]) => `
    <div class="settings-group"><h3>${escapeHtml(name)}</h3>
      ${defs.map((d) => `<div class="setting-row"><span class="label">${escapeHtml(d.label)}${d.help ? `<span class="help">${escapeHtml(d.help)}</span>` : ""}</span><span class="control">${controlFor(d, state.settings.values[d.key])}</span></div>`).join("")}
      ${name === "Research" ? `<div class="setting-row"><span class="label">Search API key<span class="help">${state.settings.search_api_key_set ? "A key is currently set." : "No key set."}</span></span><span class="control"><input type="password" id="search-api-key-input" placeholder="leave blank to keep" /></span></div>` : ""}
    </div>`).join("");
}
el("save-settings-btn").addEventListener("click", async () => {
  const values = {};
  for (const input of el("settings-groups").querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    if (input.type === "checkbox") values[key] = input.checked;
    else if (input.multiple) values[key] = [...input.selectedOptions].map((o) => o.value);
    else if (input.type === "number") values[key] = Number(input.value);
    else values[key] = input.value;
  }
  const body = { values };
  const keyInput = el("search-api-key-input");
  if (keyInput && keyInput.value) body.search_api_key = keyInput.value;
  try { await api("/settings", { method: "PUT", body: JSON.stringify(body) }); toast("Settings saved."); loadSettings(); }
  catch (e) { toast(e.message, true); }
});

async function renderTokens() {
  const tokens = await api("/tokens");
  el("tokens-list").innerHTML = tokens.length ? tokens.map((t) => `<div class="setting-row"><span class="label">${escapeHtml(t.name)}<span class="help">created ${fmtTime(t.created_at)}${t.last_used_at ? " · last used " + fmtTime(t.last_used_at) : ""}</span></span><button class="secondary-btn" data-del-token="${t.id}" style="width:auto;">Revoke</button></div>`).join("") : `<p class="subtle">No tokens yet.</p>`;
  el("tokens-list").querySelectorAll("[data-del-token]").forEach((b) => b.addEventListener("click", async () => { await api(`/tokens/${b.dataset.delToken}`, { method: "DELETE" }); renderTokens(); }));
}
el("create-token-btn").addEventListener("click", async () => {
  const name = prompt("Token name (e.g. 'my laptop CLI'):") || "API token";
  const t = await api("/tokens", { method: "POST", body: JSON.stringify({ name }) });
  await confirmDialog("Copy your token now", `${t.token}\n\nThis is shown only once.`);
  renderTokens();
});

async function renderUserMemory() {
  const mems = await api("/memory?scope=user");
  el("user-memory-list").innerHTML = mems.length ? mems.map((m) => `<div class="setting-row"><span class="label">${escapeHtml(m.content)}</span><button class="secondary-btn" data-del-mem="${m.id}" style="width:auto;">Remove</button></div>`).join("") : `<p class="subtle">No preferences saved yet.</p>`;
  el("user-memory-list").querySelectorAll("[data-del-mem]").forEach((b) => b.addEventListener("click", async () => { await api(`/memory/${b.dataset.delMem}`, { method: "DELETE" }); renderUserMemory(); }));
}
el("add-memory-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("add-memory-input");
  if (!input.value.trim()) return;
  await api("/memory", { method: "POST", body: JSON.stringify({ scope: "user", content: input.value.trim() }) });
  input.value = ""; renderUserMemory();
});

async function renderBackups() {
  const list = await api("/admin/backups");
  el("backups-list").innerHTML = list.length ? list.map((b) => `<div class="setting-row"><span class="label">${escapeHtml(b.filename)}<span class="help">${Math.round((b.size_bytes || 0) / 1024)} KB · ${b.include_keys ? "includes API keys" : "keys excluded"} · ${fmtTime(b.created_at)}</span></span><a class="secondary-btn" style="width:auto;text-decoration:none;" href="${API}/admin/backups/${b.id}/download">Download</a></div>`).join("") : `<p class="subtle">No backups yet.</p>`;
}
async function makeBackup(includeKeys) {
  try { await api("/admin/backups", { method: "POST", body: JSON.stringify({ includeKeys }) }); toast("Backup created."); renderBackups(); }
  catch (e) { toast(e.message, true); }
}
el("backup-btn").addEventListener("click", () => makeBackup(false));
el("backup-keys-btn").addEventListener("click", async () => { if (await confirmDialog("Include API keys?", "The backup will contain your encrypted provider API keys. Store it somewhere safe.")) makeBackup(true); });
el("retention-btn").addEventListener("click", async () => { const r = await api("/admin/maintenance/retention", { method: "POST" }); toast(`Removed ${r.usage + r.toolCalls + r.audit} old rows (older than ${r.days} days).`); });
el("change-password-btn").addEventListener("click", async () => {
  const current = prompt("Current password:"); if (!current) return;
  const next = prompt("New password (min 10 characters):"); if (!next) return;
  try { await api("/admin/password", { method: "POST", body: JSON.stringify({ current, next }) }); toast("Password changed."); } catch (e) { toast(e.message, true); }
});
