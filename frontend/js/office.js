/**
 * Office View: one desk per role, rendered from real agent metadata. Characters only animate when a real
 * agent_status/task_status/tool event says that role is active (spec section 70: never fake agent activity) -
 * idle desks just sit there in grayscale until something real happens.
 */
const officeCharacters = {}; // role -> { el, bubbleEl, statusEl, timer }

function renderOfficeRoom() {
  const room = el("office-room");
  if (!state.agents || state.agents.length === 0) { room.innerHTML = `<p class="subtle">Loading team…</p>`; return; }
  room.innerHTML = `
    <div class="office-deco"><span class="deco-window">🪟</span><span class="deco-clock" id="office-clock">🕒</span><span class="deco-plant">🪴</span><span class="deco-coffee">☕</span><span class="deco-printer">🖨️</span><span class="deco-plant">🪴</span></div>
    <div class="office-desks" id="office-desks"></div>`;
  const desks = el("office-desks");
  for (const a of state.agents) {
    const cfg = a.config;
    const desk = document.createElement("div");
    desk.className = "desk" + (cfg.enabled === false ? " disabled" : "");
    desk.innerHTML = `
      <div class="speech-bubble" id="bubble-${a.role}"></div>
      <div class="character idle" id="char-${a.role}" style="background:${a.color}22;">${a.avatar}</div>
      <div class="monitor" id="mon-${a.role}"></div>
      <div class="desk-surface" style="background:${a.color};"></div>
      <div class="desk-label">${escapeHtml(a.label)}</div>
      <div class="desk-status" id="status-${a.role}">idle</div>
    `;
    desks.appendChild(desk);
    officeCharacters[a.role] = { charEl: desk.querySelector(`#char-${a.role}`), bubbleEl: desk.querySelector(`#bubble-${a.role}`), statusEl: desk.querySelector(`#status-${a.role}`), monEl: desk.querySelector(`#mon-${a.role}`), idleTimer: null };
  }
}

function setCharacterState(role, mood, statusText, bubbleText) {
  const c = officeCharacters[role];
  if (!c) return;
  c.charEl.className = "character " + mood;
  c.monEl.classList.toggle("lit", mood === "working" || mood === "thinking");
  if (statusText !== undefined) c.statusEl.textContent = statusText;
  if (bubbleText) {
    c.bubbleEl.textContent = bubbleText;
    c.bubbleEl.classList.add("show");
    clearTimeout(c.bubbleTimer);
    c.bubbleTimer = setTimeout(() => c.bubbleEl.classList.remove("show"), 4500);
  }
  clearTimeout(c.idleTimer);
  if (mood !== "idle") c.idleTimer = setTimeout(() => setCharacterState(role, "idle", "idle"), 15000);
}

function officeFeedLine(text) {
  const feed = el("office-feed");
  if (!feed) return;
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  feed.appendChild(line);
  while (feed.children.length > 60) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

/** Called from the global event router for every real backend event - this is the only path that moves a character. */
function officeHandleEvent(event, data) {
  if (!officeCharacters.manager) return; // office not rendered yet
  switch (event) {
    case "agent_status": {
      const role = data.agent;
      if (!officeCharacters[role]) return;
      if (data.status === "planning") { setCharacterState("manager", "thinking", "planning…", "Let me break this down…"); officeFeedLine("Manager started planning"); }
      else if (data.status === "supervising") { setCharacterState("manager", "thinking", "supervising"); }
      else if (data.status === "reporting") { setCharacterState("manager", "working", "writing report", "Compiling results…"); }
      else if (data.status === "working") { setCharacterState(role, "working", (data.task || "working").slice(0, 40), data.task ? `Working on: ${data.task.slice(0, 60)}` : undefined); officeFeedLine(`${role} started: ${data.task || ""}`); }
      else if (data.status === "idle") { setCharacterState(role, "idle", "idle"); }
      break;
    }
    case "task_status": {
      const role = data.role;
      if (!officeCharacters[role]) return;
      if (data.status === "COMPLETED") { setCharacterState(role, "idle", "done ✓", `Finished: ${data.title?.slice(0, 50) || ""}`); officeFeedLine(`✓ ${role} completed "${data.title}"`); }
      else if (data.status === "FAILED") { setCharacterState(role, "error", "failed ✕", `Couldn't finish: ${data.title?.slice(0, 50) || ""}`); officeFeedLine(`✕ ${role} failed "${data.title}"`); setTimeout(() => setCharacterState(role, "idle", "idle"), 2000); }
      else if (data.status === "RETRYING") { setCharacterState(role, "thinking", "retrying…"); officeFeedLine(`↻ ${role} retrying "${data.title}"`); }
      else if (data.status === "CANCELLED") { setCharacterState(role, "idle", "cancelled"); }
      break;
    }
    case "worker_output": flyPaper(data.role); break;
    case "agent_iteration": {
      const role = data.role;
      if (officeCharacters[role] && data.thought) setCharacterState(role, "working", `step ${data.iteration}`, data.thought.slice(0, 70));
      break;
    }
    case "tool_started": {
      officeFeedLine(`${data.role || "?"}: ${data.brief || data.toolName}`);
      break;
    }
    case "approval_required": {
      if (officeCharacters[data.role]) setCharacterState(data.role, "thinking", "waiting for approval", "Waiting for your OK…");
      officeFeedLine(`⚠ approval needed: ${data.toolName}`);
      break;
    }
    case "checkpoint_created":
      officeFeedLine(`📌 checkpoint: ${data.label}`);
      break;
    case "plan_created":
      officeFeedLine(`📋 plan created with ${data.tasks?.length || 0} task(s)`);
      break;
    case "team_done":
      officeFeedLine(`🏁 run finished`);
      setCharacterState("manager", "idle", "idle");
      break;
  }
}

/** A paper flies from the worker's desk to the manager's desk when a worker really delivers output. */
function flyPaper(fromRole) {
  const from = officeCharacters[fromRole], to = officeCharacters.manager;
  if (!from || !to || fromRole === "manager") return;
  const a = from.charEl.getBoundingClientRect(), b = to.charEl.getBoundingClientRect();
  const paper = document.createElement("div");
  paper.textContent = "📄";
  paper.style.cssText = `position:fixed;left:${a.left + 16}px;top:${a.top}px;font-size:22px;z-index:60;pointer-events:none;`;
  document.body.appendChild(paper);
  const anim = paper.animate([{ transform: "translate(0,0) rotate(0deg)", opacity: 1 }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) rotate(360deg)`, opacity: 0.9 }], { duration: 1000, easing: "ease-in-out" });
  anim.onfinish = () => { paper.remove(); to.charEl.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 300 }); };
}

async function officeSyncSnapshot() {
  try {
    const snap = await api("/events/snapshot");
    for (const t of snap.activeTasks || []) if (officeCharacters[t.role]) setCharacterState(t.role, "working", (t.title || "working").slice(0, 40), `Working on: ${(t.title || "").slice(0, 60)}`);
    if ((snap.runs || []).length && officeCharacters.manager) setCharacterState("manager", "thinking", "supervising");
  } catch { /* snapshot is best-effort */ }
}

setInterval(() => { const c = el("office-clock"); if (c) c.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 15000);
