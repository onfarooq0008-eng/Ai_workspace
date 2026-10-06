document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
function switchView(view) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  el("sidebar").classList.remove("open");
  if (view === "activity") loadActivity();
  if (view === "tasks") loadTasks();
  if (view === "files") loadFilesView();
  if (view === "agents") loadAgents().then(renderAgents);
  if (view === "providers") renderProviders();
  if (view === "settings") loadSettings();
  if (view === "office") renderOfficeRoom();
}
el("sidebar-toggle").addEventListener("click", () => el("sidebar").classList.toggle("open"));
