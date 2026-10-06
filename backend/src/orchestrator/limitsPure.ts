export interface ProviderLimits {
  requests_per_minute: number | null;
  tokens_per_minute: number | null;
  daily_limit: number | null; // requests per day
  monthly_budget: number | null; // cost per month
}

export interface UsageSnapshot {
  requestsLastMinute: number;
  tokensLastMinute: number;
  requestsToday: number;
  costThisMonth: number;
}

/** Returns ok=false with a human reason as soon as any configured limit is reached (spec section 32). */
export function evaluateLimits(l: ProviderLimits, u: UsageSnapshot): { ok: boolean; reason?: string } {
  if (l.requests_per_minute && u.requestsLastMinute >= l.requests_per_minute)
    return { ok: false, reason: `requests/minute limit reached (${u.requestsLastMinute}/${l.requests_per_minute})` };
  if (l.tokens_per_minute && u.tokensLastMinute >= l.tokens_per_minute)
    return { ok: false, reason: `tokens/minute limit reached (${u.tokensLastMinute}/${l.tokens_per_minute})` };
  if (l.daily_limit && u.requestsToday >= l.daily_limit)
    return { ok: false, reason: `daily request limit reached (${u.requestsToday}/${l.daily_limit})` };
  if (l.monthly_budget && u.costThisMonth >= l.monthly_budget)
    return { ok: false, reason: `monthly budget reached (${u.costThisMonth.toFixed(4)}/${l.monthly_budget})` };
  return { ok: true };
}
