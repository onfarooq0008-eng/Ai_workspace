import { db } from "../db";
import { evaluateLimits } from "./limitsPure";
import { getSetting } from "../runtimeConfig";

export function providerWithinLimits(providerId: string): { ok: boolean; reason?: string } {
  const p = db.prepare("SELECT requests_per_minute, tokens_per_minute, daily_limit, monthly_budget FROM providers WHERE id = ?").get(providerId) as any;
  if (!p) return { ok: false, reason: "provider not found" };
  if (!p.requests_per_minute && !p.tokens_per_minute && !p.daily_limit && !p.monthly_budget) return { ok: true };
  const minute = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM usage_events WHERE provider_id = ? AND created_at >= datetime('now', '-1 minute')").get(providerId) as any;
  const today = db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE provider_id = ? AND date(created_at) = date('now')").get(providerId) as any;
  const month = db.prepare("SELECT COALESCE(SUM(estimated_cost), 0) AS c FROM usage_events WHERE provider_id = ? AND created_at >= datetime('now', 'start of month')").get(providerId) as any;
  return evaluateLimits(p, { requestsLastMinute: minute.n, tokensLastMinute: minute.t, requestsToday: today.n, costThisMonth: month.c });
}

/** Global token/cost budgets from Settings (spec section 46). */
export function globalBudgetStatus(): { ok: boolean; reason?: string } {
  const tokenBudget = Number(getSetting("daily_token_budget")) || 0;
  if (tokenBudget > 0) {
    const r = db.prepare("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM usage_events WHERE date(created_at) = date('now')").get() as any;
    if (r.t >= tokenBudget) return { ok: false, reason: `Daily token budget reached (${r.t}/${tokenBudget}). Raise it in Settings → Budgets.` };
  }
  const costBudget = Number(getSetting("monthly_cost_budget")) || 0;
  if (costBudget > 0) {
    const r = db.prepare("SELECT COALESCE(SUM(estimated_cost), 0) AS c FROM usage_events WHERE created_at >= datetime('now', 'start of month')").get() as any;
    if (r.c >= costBudget) return { ok: false, reason: `Monthly cost budget reached (${r.c.toFixed(4)}/${costBudget}). Raise it in Settings → Budgets.` };
  }
  return { ok: true };
}

export function providerStats(ids: string[]): Record<string, { avgLatencyMs: number | null; requests24h: number }> {
  const out: Record<string, { avgLatencyMs: number | null; requests24h: number }> = {};
  for (const id of ids) {
    const r = db.prepare("SELECT COUNT(*) AS n, AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS lat FROM usage_events WHERE provider_id = ? AND created_at >= datetime('now', '-1 day')").get(id) as any;
    out[id] = { avgLatencyMs: r.lat ?? null, requests24h: r.n };
  }
  return out;
}
