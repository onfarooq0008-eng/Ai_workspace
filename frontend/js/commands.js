/** Chat slash-commands (spec section 43). */
const COMMANDS = [
  { cmd: "/model", desc: "Switch the Manager AI — /model <provider name>" },
  { cmd: "/agents", desc: "Open the Agents page" },
  { cmd: "/status", desc: "Show current run status" },
  { cmd: "/tasks", desc: "Open the Tasks page" },
  { cmd: "/files", desc: "Open the Files page" },
  { cmd: "/run", desc: "Switch to Team Mode and send" },
  { cmd: "/test", desc: "Switch to Developer Mode and send" },
  { cmd: "/build", desc: "Switch to Developer Mode and send" },
  { cmd: "/git", desc: "Open the Files page (Git section)" },
  { cmd: "/stop", desc: "Stop the current run" },
  { cmd: "/resume", desc: "Resume the last plan" },
  { cmd: "/clear", desc: "Clear this chat's messages" },
  { cmd: "/reset", desc: "Start a brand new chat" },
  { cmd: "/help", desc: "List all commands" },
];

function showCmdSuggest(value) {
  const term = value.slice(1).split(" ")[0].toLowerCase();
  const matches = COMMANDS.filter((c) => c.cmd.slice(1).startsWith(term));
  const box = el("cmd-suggest");
  if (matches.length === 0) return hideCmdSuggest();
  box.innerHTML = matches.map((c) => `<div class="cmd-row" data-cmd="${c.cmd}"><b>${c.cmd}</b><span class="subtle">${escapeHtml(c.desc)}</span></div>`).join("");
  box.style.display = "block";
  box.querySelectorAll(".cmd-row").forEach((row) => row.addEventListener("click", () => { el("chat-input").value = row.dataset.cmd + " "; el("chat-input").focus(); hideCmdSuggest(); }));
}
function hideCmdSuggest() { el("cmd-suggest").style.display = "none"; }

async function handleCommand(raw) {
  const [cmd, ...rest] = raw.trim().split(" ");
  const arg = rest.join(" ").trim();
  switch (cmd) {
    case "/help":
      appendAgentStatus("Commands: " + COMMANDS.map((c) => c.cmd).join(", "));
      return;
    case "/status":
      appendAgentStatus(state.chatRunning ? "A run is currently in progress." : "No run in progress.");
      return;
    case "/agents": return switchView("agents");
    case "/tasks": return switchView("tasks");
    case "/files": case "/git": return switchView("files");
    case "/clear": return el("chat-clear-btn").click();
    case "/reset": return startNewChat();
    case "/stop": return el("stop-btn").click();
    case "/resume": return el("resume-btn").click();
    case "/model": {
      if (!arg) { appendAgentStatus("Providers: " + state.providers.map((p) => p.name).join(", ")); return; }
      const match = state.providers.find((p) => p.name.toLowerCase().includes(arg.toLowerCase()));
      if (!match) return appendAgentStatus(`No provider matching "${arg}".`);
      el("manager-select").value = match.id;
      el("manager-select").dispatchEvent(new Event("change"));
      appendAgentStatus(`Manager AI set to ${match.name}.`);
      return;
    }
    case "/run": el("mode-select").value = "team"; el("mode-select").dispatchEvent(new Event("change")); break;
    case "/test": case "/build": el("mode-select").value = "developer"; el("mode-select").dispatchEvent(new Event("change")); break;
    default:
      appendAgentStatus(`Unknown command ${cmd}. Type /help for a list.`);
      return;
  }
  if (arg) { el("chat-input").value = arg; el("chat-form").requestSubmit(); }
}
