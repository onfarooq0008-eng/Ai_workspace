/** Global live event stream (SSE). Drives chat progress, the Office View, approvals, and activity in real time. */
function connectEventStream() {
  if (state.eventSource) state.eventSource.close();
  const es = new EventSource(API + "/events/stream" + (state.lastEventId ? `?since=${state.lastEventId}` : ""));
  state.eventSource = es;
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    state.lastEventId = ev.id || state.lastEventId;
    if (ev.event === "hello") return;
    routeEvent(ev.event, ev.data || {});
  };
  es.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
}

function routeEvent(event, data) {
  officeHandleEvent(event, data);
  if (data.chatId && data.chatId === state.currentChatId) chatHandleEvent(event, data);
  if (event === "task_status" || event === "plan_created") {
    if (el("view-tasks").classList.contains("active") && data.chatId === state.currentChatId) loadTasks();
  }
  if (event === "approval_required") maybeShowApprovalToast(data);
  if (event === "run_started" || event === "run_finished") updateRunBanner();
}
