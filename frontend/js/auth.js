function showLogin() {
  el("login-screen").style.display = "flex";
  el("app-screen").style.display = "none";
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
}

async function showApp(username) {
  el("login-screen").style.display = "none";
  el("app-screen").style.display = "flex";
  el("whoami").textContent = username || "";
  await fetchCsrfToken();
  applyTheme(localStorage.getItem("aap-theme") || "dark");
  connectEventStream();
  await Promise.all([loadProviders(), loadProjects(), loadAgents(), loadChatList()]);
  if (!state.currentChatId) await startNewChat();
  renderOfficeRoom();
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("login-error").textContent = "";
  try {
    const user = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: el("login-username").value, password: el("login-password").value }) });
    await showApp(user.username);
  } catch (err) {
    el("login-error").textContent = err.message;
  }
});

el("logout-btn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  showLogin();
});

async function checkSession() {
  try {
    const me = await api("/auth/me");
    await showApp(me.username);
  } catch {
    showLogin();
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("aap-theme", theme);
}
el("theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});
