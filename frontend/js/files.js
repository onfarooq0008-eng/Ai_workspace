let filesCurrentPath = ".";
let filesCurrentFile = null;

async function loadFilesView() {
  const sel = el("files-project-select");
  sel.innerHTML = state.projects.length ? state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("") : `<option value="">No projects yet</option>`;
  if (state.currentProjectId && [...sel.options].some((o) => o.value === state.currentProjectId)) sel.value = state.currentProjectId;
  sel.onchange = () => { filesCurrentPath = "."; browseDirectory(sel.value, "."); loadCheckpoints(sel.value); };
  if (sel.value) { browseDirectory(sel.value, "."); loadCheckpoints(sel.value); }
  else { el("files-list").innerHTML = `<p class="subtle">Create a project first.</p>`; el("checkpoints-list").innerHTML = ""; }
}
function activeProjectId() { return el("files-project-select").value; }

async function browseDirectory(projectId, dirPath) {
  if (!projectId) return;
  filesCurrentPath = dirPath;
  const { entries } = await api(`/files/${projectId}/list?path=${encodeURIComponent(dirPath)}`);
  const list = el("files-list");
  list.innerHTML = "";
  if (dirPath !== ".") {
    const up = document.createElement("div");
    up.className = "entry"; up.textContent = "⬅ ..";
    up.addEventListener("click", () => browseDirectory(projectId, dirPath.split("/").slice(0, -1).join("/") || "."));
    list.appendChild(up);
  }
  for (const entry of entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))) {
    const row = document.createElement("div");
    row.className = "entry";
    row.textContent = (entry.type === "directory" ? "📁 " : "📄 ") + entry.name + (entry.size != null ? ` (${entry.size}B)` : "");
    const childPath = dirPath === "." ? entry.name : `${dirPath}/${entry.name}`;
    row.addEventListener("click", () => entry.type === "directory" ? browseDirectory(projectId, childPath) : previewFile(projectId, childPath));
    list.appendChild(row);
  }
  if (entries.length === 0 && dirPath === ".") list.innerHTML += `<p class="subtle">Empty workspace - a worker will populate this once it writes files.</p>`;
}
async function previewFile(projectId, filePath) {
  filesCurrentFile = filePath;
  try {
    const { content } = await api(`/files/${projectId}/read?path=${encodeURIComponent(filePath)}`);
    el("files-preview").value = content;
    el("files-save-btn").style.display = "";
  } catch (err) {
    el("files-preview").value = `Could not read file: ${err.message}`;
    el("files-save-btn").style.display = "none";
  }
}
el("files-save-btn").addEventListener("click", async () => {
  const projectId = activeProjectId();
  if (!projectId || !filesCurrentFile) return;
  try { await api(`/files/${projectId}/write`, { method: "PUT", body: JSON.stringify({ path: filesCurrentFile, content: el("files-preview").value }) }); toast("Saved."); }
  catch (e) { toast(e.message, true); }
});

el("files-upload-btn").addEventListener("click", () => el("files-upload-input").click());
el("files-upload-input").addEventListener("change", async () => {
  const projectId = activeProjectId();
  const file = el("files-upload-input").files[0];
  if (!projectId || !file) return;
  const targetPath = filesCurrentPath === "." ? file.name : `${filesCurrentPath}/${file.name}`;
  try {
    const res = await fetch(`${API}/files/${projectId}/upload?path=${encodeURIComponent(targetPath)}`, { method: "PUT", credentials: "include", headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/octet-stream" }, body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
    toast(`Uploaded ${file.name}`);
    browseDirectory(projectId, filesCurrentPath);
  } catch (e) { toast(e.message, true); }
  el("files-upload-input").value = "";
});
el("files-export-btn").addEventListener("click", () => { const id = activeProjectId(); if (id) window.open(`${API}/projects/${id}/export`, "_blank"); });

async function loadCheckpoints(projectId) {
  if (!projectId) { el("checkpoints-list").innerHTML = ""; return; }
  const checkpoints = await api(`/git/${projectId}/checkpoints`);
  el("checkpoints-list").innerHTML = checkpoints.length
    ? checkpoints.map((c) => `<div class="setting-row"><span class="label">${fmtTime(c.created_at)} — ${escapeHtml(c.label)} <span class="subtle">(${(c.commit_hash || "").slice(0, 8)})</span></span><button class="secondary-btn" data-restore="${c.id}" style="width:auto;">Restore</button></div>`).join("")
    : `<p class="subtle">No checkpoints yet — created automatically whenever a worker changes a file.</p>`;
  el("checkpoints-list").querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmDialog("Restore checkpoint?", "This resets the project files to this checkpoint. A safety checkpoint of the current state is taken first."))) return;
    try { await api(`/git/${projectId}/restore/${b.dataset.restore}`, { method: "POST" }); toast("Restored."); browseDirectory(projectId, filesCurrentPath); loadCheckpoints(projectId); }
    catch (e) { toast(e.message, true); }
  }));
}
el("git-checkpoint-btn").addEventListener("click", async () => {
  const id = activeProjectId(); if (!id) return;
  await api(`/git/${id}/checkpoints`, { method: "POST" });
  loadCheckpoints(id); toast("Checkpoint created.");
});
el("git-diff-btn").addEventListener("click", async () => {
  const id = activeProjectId(); if (!id) return;
  const { diff } = await api(`/git/${id}/diff`);
  const view = el("git-diff-view");
  view.textContent = diff || "(no uncommitted changes)";
  view.style.display = view.style.display === "none" ? "block" : "none";
});
