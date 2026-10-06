async function loadTasks() {
  if (!state.currentChatId) return;
  const tasks = await api(`/tasks/chat/${state.currentChatId}`);
  const tree = el("task-tree");
  if (tasks.length === 0) { tree.innerHTML = `<p class="subtle">No tasks yet for this chat.</p>`; return; }
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  tree.innerHTML = tasks.map((t) => {
    const depNames = (t.depends_on || []).map((id) => byId[id]?.title || id).join(", ");
    const canCancel = ["PENDING", "WAITING", "RETRYING"].includes(t.status);
    const canRetry = ["FAILED", "CANCELLED"].includes(t.status);
    return `<div class="task-row">
      <span class="task-icon ${t.status}">${STATUS_ICON[t.status] || "○"}</span>
      <span class="task-role">${escapeHtml(t.role)}</span>
      <span class="task-title">${escapeHtml(t.title)}${depNames ? `<br/><span class="subtle" style="font-size:0.72rem;">depends on: ${escapeHtml(depNames)}</span>` : ""}${t.errors && t.errors.length ? `<br/><span class="subtle" style="font-size:0.7rem;color:var(--danger);">${escapeHtml(t.errors[t.errors.length - 1])}</span>` : ""}</span>
      <span class="task-attempts">${t.attempts}/${t.max_attempts}</span>
      <span class="task-actions">${canCancel ? `<button class="secondary-btn" data-cancel="${t.id}">Cancel</button>` : ""}${canRetry ? `<button class="secondary-btn" data-retry="${t.id}">Retry</button>` : ""}</span>
    </div>`;
  }).join("");
  tree.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { await api(`/tasks/${b.dataset.cancel}/cancel`, { method: "POST" }); loadTasks(); }));
  tree.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", async () => { await api(`/tasks/${b.dataset.retry}/retry`, { method: "POST" }); loadTasks(); }));
}
el("refresh-tasks-btn").addEventListener("click", loadTasks);
el("resume-tasks-btn").addEventListener("click", () => el("resume-btn").click());
