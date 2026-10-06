async function loadProjects() {
  state.projects = await api("/projects");
  renderProjects(); renderProjectSelect();
}
function renderProjectSelect() {
  const sel = el("project-select");
  const cur = sel.value;
  sel.innerHTML = `<option value="">No project</option>` + state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function renderProjects() {
  const grid = el("projects-list");
  grid.innerHTML = state.projects.length ? "" : `<p class="subtle">No projects yet.</p>`;
  for (const p of state.projects) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>📁 ${escapeHtml(p.name)}</h3>
      <p class="subtle">${p.chat_count || 0} chat(s) · ${p.task_count || 0} task(s)</p>
      <p class="subtle">${escapeHtml(p.workspace_path)}</p>
      <label class="subtle">Instructions<textarea data-instr rows="2" style="font-size:0.78rem;">${escapeHtml(p.instructions || "")}</textarea></label>
      <div class="card-actions">
        <button class="secondary-btn" data-open="${p.id}">Open in chat</button>
        <button class="secondary-btn" data-save="${p.id}">Save</button>
        <button class="secondary-btn" data-delete="${p.id}">Delete</button>
      </div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { el("project-select").value = b.dataset.open; el("project-select").dispatchEvent(new Event("change")); switchView("chat"); }));
  grid.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest(".card");
    await api(`/projects/${b.dataset.save}`, { method: "PATCH", body: JSON.stringify({ instructions: card.querySelector("[data-instr]").value }) });
    toast("Saved.");
  }));
  grid.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete project?", "This permanently deletes the project's workspace files, tasks, and chats. This cannot be undone."))) return;
    await api(`/projects/${b.dataset.delete}?confirm=true`, { method: "DELETE" });
    await loadProjects();
  }));
}
el("add-project-btn").addEventListener("click", async () => {
  const name = prompt("Project name:");
  if (!name) return;
  await api("/projects", { method: "POST", body: JSON.stringify({ name }) });
  await loadProjects();
});
