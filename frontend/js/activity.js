async function loadActivity() {
  const [summary, events, audit] = await Promise.all([api("/activity/usage/summary"), api("/activity/events?limit=80"), api("/activity/audit-log?limit=40")]);
  const today = summary.today || {}, week = summary.week || {}, month = summary.month || {};
  const fmtCost = (c) => (c == null ? "—" : `$${Number(c).toFixed(4)}`);
  el("activity-summary").innerHTML = `
    <div class="card"><h3>Today</h3><p class="subtle">Requests: ${today.requests || 0}</p><p class="subtle">Tokens: ${(today.input_tokens || 0) + (today.output_tokens || 0)}</p><p class="subtle">Cost: ${fmtCost(today.cost)}</p></div>
    <div class="card"><h3>This week</h3><p class="subtle">Requests: ${week.requests || 0}</p><p class="subtle">Tokens: ${week.tokens || 0}</p><p class="subtle">Cost: ${fmtCost(week.cost)}</p></div>
    <div class="card"><h3>This month</h3><p class="subtle">Requests: ${month.requests || 0}</p><p class="subtle">Tokens: ${month.tokens || 0}</p><p class="subtle">Cost: ${fmtCost(month.cost)}</p></div>
    <div class="card"><h3>By provider</h3>${(summary.byProvider || []).map((p) => `<p class="subtle">${escapeHtml(p.provider_name || "unknown")}: ${p.requests} req, ${fmtCost(p.estimated_cost)}${p.errors ? `, ${p.errors} err` : ""}</p>`).join("") || '<p class="subtle">—</p>'}</div>
    <div class="card"><h3>By agent (7d)</h3>${(summary.byAgent || []).map((a) => `<p class="subtle">${escapeHtml(a.agent)}: ${a.requests} req, ${a.tokens} tok</p>`).join("") || '<p class="subtle">—</p>'}</div>
  `;
  drawUsageChart(summary.daily || []);
  const tbody = document.querySelector("#activity-table tbody");
  tbody.innerHTML = events.map((e) => `<tr><td>${fmtTime(e.created_at)}</td><td>${escapeHtml(e.agent || "-")}</td><td>${escapeHtml(e.provider_name || "-")}</td><td>${escapeHtml(e.model || "-")}</td><td>${e.input_tokens || 0}</td><td>${e.output_tokens || 0}</td><td>${fmtCost(e.estimated_cost)}</td><td>${e.latency_ms ?? "-"}ms</td><td>${e.status}</td></tr>`).join("");
  const atbody = document.querySelector("#audit-table tbody");
  atbody.innerHTML = audit.map((a) => `<tr><td>${fmtTime(a.created_at)}</td><td>${escapeHtml(a.event)}</td><td>${escapeHtml(a.actor || "-")}</td><td>${escapeHtml((a.detail || "").slice(0, 80))}</td></tr>`).join("");
}
function drawUsageChart(daily) {
  const canvas = el("usage-chart");
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.clientWidth || 600), h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!daily.length) return;
  const max = Math.max(1, ...daily.map((d) => d.requests || 0));
  const bw = w / daily.length;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6d87ff";
  ctx.fillStyle = accent;
  daily.forEach((d, i) => {
    const barH = ((d.requests || 0) / max) * (h - 20);
    ctx.fillRect(i * bw + 3, h - barH, bw - 6, barH);
  });
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-subtle").trim() || "#999";
  ctx.font = "10px sans-serif";
  daily.forEach((d, i) => ctx.fillText(d.day.slice(5), i * bw + 2, h - 2));
}
