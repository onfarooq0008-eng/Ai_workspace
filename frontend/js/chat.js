const STATUS_ICON = { PENDING: "○", WAITING: "○", RUNNING: "●", RETRYING: "●", COMPLETED: "✓", FAILED: "✕", CANCELLED: "⊘" };

async function loadChatList() {
  state.chats = await api("/chats");
  renderChatList();
  renderChatSelect();
}
function renderChatList(filter) {
  const list = el("chat-list");
  const items = filter ? state.chats.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase())) : state.chats;
  list.innerHTML = items.slice(0, 50).map((c) => `<div class="chat-item ${c.id === state.currentChatId ? "active" : ""}" data-id="${c.id}">${escapeHtml(c.title)}</div>`).join("") || `<div class="subtle" style="padding:6px;">No chats yet</div>`;
  list.querySelectorAll(".chat-item").forEach((row) => row.addEventListener("click", () => openChat(row.dataset.id)));
}
function renderChatSelect() {
  const sel = el("current-chat-select");
  sel.innerHTML = state.chats.map((c) => `<option value="${c.id}" ${c.id === state.currentChatId ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("");
}
el("chat-search").addEventListener("input", (e) => renderChatList(e.target.value));
el("current-chat-select").addEventListener("change", (e) => openChat(e.target.value));

async function openChat(id) {
  const chat = await api(`/chats/${id}`);
  state.currentChatId = id;
  state.currentProjectId = chat.project_id;
  el("mode-select").value = chat.mode || "chat";
  el("project-select").value = chat.project_id || "";
  el("manager-select").value = chat.manager_provider_id || "";
  state.chatRunning = !!chat.running;
  el("messages").innerHTML = "";
  const msgs = await api(`/chats/${id}/messages`);
  for (const m of msgs) renderStoredMessage(m);
  renderChatList();
  renderChatSelect();
  updateRunBanner();
  loadTasks();
  if (state.chatRunning) loadPendingApprovals();
}

async function startNewChat() {
  const chat = await api("/chats", { method: "POST", body: JSON.stringify({ mode: el("mode-select").value, projectId: state.currentProjectId || undefined }) });
  state.chats.unshift(chat);
  state.currentChatId = chat.id;
  state.chatRunning = false;
  el("messages").innerHTML = "";
  renderChatList(); renderChatSelect(); updateRunBanner();
}
el("new-chat-btn").addEventListener("click", startNewChat);

el("project-select").addEventListener("change", async (e) => {
  state.currentProjectId = e.target.value || null;
  if (state.currentChatId) { await api(`/chats/${state.currentChatId}`, { method: "PATCH", body: JSON.stringify({ project_id: state.currentProjectId }) }); loadTasks(); }
});
el("mode-select").addEventListener("change", async (e) => {
  if (state.currentChatId) await api(`/chats/${state.currentChatId}`, { method: "PATCH", body: JSON.stringify({ mode: e.target.value }) });
});
el("manager-select").addEventListener("change", async (e) => {
  if (state.currentChatId) await api(`/chats/${state.currentChatId}`, { method: "PATCH", body: JSON.stringify({ manager_provider_id: e.target.value || null }) });
});

function renderStoredMessage(m) {
  if (m.role === "tool") return appendMessage("tool", m.content, m.agent_name);
  if (m.role === "error") return appendMessage("error", m.content, m.agent_name);
  appendMessage(m.role === "user" ? "user" : "assistant", m.content, m.agent_name || (m.role === "user" ? "" : "Manager AI"));
}

function appendAgentStatus(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg agent-status";
  wrap.textContent = text;
  el("messages").appendChild(wrap);
  el("messages").scrollTop = el("messages").scrollHeight;
  return wrap;
}
function appendMessage(role, text, meta) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""}${escapeHtml(text)}`;
  el("messages").appendChild(wrap);
  el("messages").scrollTop = el("messages").scrollHeight;
  return wrap;
}

function updateRunBanner() {
  const banner = el("run-banner");
  el("stop-btn").style.display = state.chatRunning ? "" : "none";
  el("resume-btn").style.display = !state.chatRunning && TEAM_MODES().includes(el("mode-select").value) ? "" : "none";
  if (state.chatRunning) { banner.style.display = "flex"; banner.innerHTML = `<span class="dot"></span> The team is working… you can leave this page, it keeps running.`; }
  else banner.style.display = "none";
}
function TEAM_MODES() { return ["team", "developer", "research", "autonomous"]; }

el("stop-btn").addEventListener("click", async () => {
  if (!state.currentChatId) return;
  await api(`/chats/${state.currentChatId}/stop`, { method: "POST" });
  toast("Stopping… in-flight step will finish, remaining tasks will be cancelled.");
});
el("resume-btn").addEventListener("click", async () => {
  if (!state.currentChatId) return;
  try { await api(`/chats/${state.currentChatId}/resume`, { method: "POST" }); } catch (e) { toast(e.message, true); }
});
el("chat-clear-btn").addEventListener("click", async () => {
  if (!state.currentChatId) return;
  if (!(await confirmDialog("Clear this chat?", "All messages in this chat will be deleted. This cannot be undone."))) return;
  await api(`/chats/${state.currentChatId}/clear`, { method: "POST" });
  el("messages").innerHTML = "";
});
el("chat-export-btn").addEventListener("click", () => { if (state.currentChatId) window.open(`${API}/chats/${state.currentChatId}/export`, "_blank"); });

el("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("chat-input");
  const text = input.value.trim();
  if (!text || !state.currentChatId) return;
  if (text.startsWith("/")) { input.value = ""; return void handleCommand(text); }
  input.value = ""; input.style.height = "auto";
  hideCmdSuggest();
  appendMessage("user", text);
  const sendBtn = el("send-btn");
  sendBtn.disabled = true;
  try {
    const res = await api(`/chats/${state.currentChatId}/messages`, { method: "POST", body: JSON.stringify({ content: text, providerId: el("manager-select").value || undefined }) });
    if (res.started) {
      state.chatRunning = true;
      updateRunBanner();
      appendAgentStatus("Manager is planning the task…");
    } else if (res.content) {
      appendMessage("assistant", res.content, "Manager AI");
      loadChatList();
    }
  } catch (err) {
    appendMessage("error", err.message);
  } finally {
    sendBtn.disabled = false;
  }
});

function chatHandleEvent(event, data) {
  switch (event) {
    case "assistant_message": break; // already rendered via the POST response for the initiating tab
    case "token": break; // plain-chat mode returns the full reply in one shot now (background-run friendly); no token stream needed
    case "agent_status":
      if (data.status === "planning") appendAgentStatus("Manager is planning the task…");
      else if (data.status === "working") appendAgentStatus(`[${data.agent}] working: ${data.task || ""}`);
      else if (data.status === "supervising") appendAgentStatus("Manager is supervising the team…");
      else if (data.status === "reporting") appendAgentStatus("Manager is compiling the final report…");
      break;
    case "plan_created":
      appendMessage("assistant", (data.resumed ? "Resuming plan - " : "Plan created - ") + `${data.tasks.length} task(s):\n` + data.tasks.map((t) => `${STATUS_ICON[t.status] || "○"} [${t.role}] ${t.title}`).join("\n"), "Manager AI");
      break;
    case "task_status":
      appendAgentStatus(`${STATUS_ICON[data.status] || "○"} [${data.role}] ${data.title}${data.error ? " — " + data.error : ""}`);
      break;
    case "worker_output":
      appendMessage("worker", data.summary, data.role);
      break;
    case "agent_iteration":
      if (data.status === "in_progress" && data.thought) appendAgentStatus(`[${data.role}] step ${data.iteration}: ${data.thought}`);
      break;
    case "tool_started":
      appendMessage("tool", data.brief || data.toolName);
      break;
    case "tool_completed":
      if (!data.ok) appendAgentStatus(`✕ ${data.toolName} failed: ${data.error || ""}`);
      break;
    case "approval_required":
      showApprovalCard(data);
      break;
    case "approval_resolved":
      appendAgentStatus(`Approval ${data.decision}: ${data.toolName}`);
      break;
    case "checkpoint_created":
      appendAgentStatus(`📌 Git checkpoint: ${data.label}${data.hash ? ` (${data.hash.slice(0, 8)})` : ""}`);
      break;
    case "provider_error":
      appendAgentStatus(`⚠ Provider error (trying fallback): ${data.error || ""}`);
      break;
    case "provider_fallback":
      appendAgentStatus(`⚠ Skipping ${data.providerName}: ${data.reason}`);
      break;
    case "team_done":
      appendMessage("assistant", data.summary, "Manager AI");
      state.chatRunning = false;
      updateRunBanner();
      loadTasks();
      loadChatList();
      break;
    case "run_started":
      state.chatRunning = true; updateRunBanner();
      break;
    case "run_finished":
      state.chatRunning = false; updateRunBanner();
      break;
    case "fatal_error":
      appendMessage("error", data.error);
      state.chatRunning = false; updateRunBanner();
      break;
  }
}

// auto-grow + command palette + Enter to send
const input = el("chat-input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
  if (input.value.startsWith("/")) showCmdSuggest(input.value); else hideCmdSuggest();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && el("cmd-suggest").style.display === "none") { e.preventDefault(); el("chat-form").requestSubmit(); }
});
