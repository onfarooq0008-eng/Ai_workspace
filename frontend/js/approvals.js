const shownApprovalIds = new Set();

function showApprovalCard(data) {
  if (shownApprovalIds.has(data.approvalId)) return;
  shownApprovalIds.add(data.approvalId);
  renderApprovalCard({ id: data.approvalId, tool_name: data.toolName, permission_level: data.level, args: JSON.stringify(data.args || {}), brief: data.brief });
}
function maybeShowApprovalToast(data) {
  if (!state.currentChatId || data.chatId !== state.currentChatId) toast(`Approval needed: ${data.toolName} (${data.level})`);
}

function renderApprovalCard(a) {
  const wrap = document.createElement("div");
  wrap.className = "msg approval-card error";
  let args = {}; try { args = JSON.parse(a.args); } catch {}
  wrap.innerHTML = `
    <strong>⚠ Approval required (${escapeHtml(a.permission_level)}):</strong> ${escapeHtml(a.tool_name)}
    <code>${escapeHtml(JSON.stringify(args).slice(0, 400))}</code>
    <div class="card-actions" style="margin-top:8px;">
      <button class="secondary-btn" data-approve="1">✓ Approve</button>
      <button class="secondary-btn" data-approve-always="1">✓ Always allow this</button>
      <button class="secondary-btn" data-deny="1">✕ Deny</button>
    </div>`;
  el("messages").appendChild(wrap);
  el("messages").scrollTop = el("messages").scrollHeight;
  const finish = (txt) => { wrap.querySelector(".card-actions").outerHTML = `<div class="subtle">${txt}</div>`; };
  wrap.querySelector("[data-approve]").addEventListener("click", async () => { await decide(a.id, true, false); finish("Approved."); });
  wrap.querySelector("[data-approve-always]").addEventListener("click", async () => { await decide(a.id, true, true); finish("Approved (always allow for this project)."); });
  wrap.querySelector("[data-deny]").addEventListener("click", async () => { await decide(a.id, false, false); finish("Denied."); });
}
async function decide(id, approve, always) {
  try { await api(`/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, always }) }); }
  catch (e) { toast(e.message, true); }
}

/** After a refresh, re-show approvals that are still waiting so they can be answered. */
async function loadPendingApprovals() {
  try {
    const pending = await api("/approvals");
    for (const a of pending) {
      if (shownApprovalIds.has(a.id)) continue;
      shownApprovalIds.add(a.id);
      renderApprovalCard(a);
    }
  } catch { /* ignore */ }
}
