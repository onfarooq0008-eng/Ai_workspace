const API = "/api";
let csrfToken = null;
const state = {
  currentChatId: null, currentProjectId: null, providers: [], agents: [], projects: [],
  chats: [], settings: null, roleMeta: {}, lastEventId: 0, eventSource: null, chatRunning: false,
};

function el(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTime(s) { try { return new Date(s.endsWith("Z") ? s : s + "Z").toLocaleString(); } catch { return s; } }
function toast(msg, isError) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:${isError ? "var(--danger)" : "var(--accent)"};color:#fff;padding:9px 16px;border-radius:8px;font-size:0.85rem;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function fetchCsrfToken() {
  const r = await fetch(API + "/auth/csrf", { credentials: "include" });
  csrfToken = (await r.json()).csrfToken;
}

async function api(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(API + path, { credentials: "include", headers, ...opts });
  if (res.status === 401) { showLogin(); throw new Error("Not authenticated"); }
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body.error && body.error.includes("CSRF")) await fetchCsrfToken();
    throw new Error(body.error || "Forbidden");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res;
}

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    el("confirm-title").textContent = title;
    el("confirm-body").textContent = body;
    el("confirm-modal").style.display = "flex";
    const done = (v) => { el("confirm-modal").style.display = "none"; cleanup(); resolve(v); };
    const onOk = () => done(true), onCancel = () => done(false);
    function cleanup() { el("confirm-ok-btn").removeEventListener("click", onOk); el("confirm-cancel-btn").removeEventListener("click", onCancel); }
    el("confirm-ok-btn").addEventListener("click", onOk);
    el("confirm-cancel-btn").addEventListener("click", onCancel);
  });
}
