import { listProviders, ProviderPublic } from "../providers/store";
import { getRoleConfig } from "../db/roleConfigs";
import { getSetting } from "../runtimeConfig";
import { orderByStrategy, Strategy } from "./loadBalancePure";
import { providerStats } from "./limits";

/** Advisory capability hints per role (spec section 40). A provider with no capabilities set is still a valid candidate. */
const ROLE_PREFERRED_CAPABILITIES: Record<string, string[]> = {
  manager: ["reasoning"],
  coder: ["coding"],
  researcher: ["research", "long_context"],
  reviewer: ["review", "reasoning"],
  tester: ["coding", "reasoning"],
  security_reviewer: ["review", "reasoning"],
  ui_designer: ["coding"],
  documentation: ["fast_response"],
  debugger: ["coding", "reasoning"],
  devops: ["coding"],
  database: ["coding", "reasoning"],
  api_designer: ["coding", "reasoning"],
  performance_optimizer: ["coding", "reasoning"],
  accessibility_reviewer: ["review"],
  localization: ["fast_response"],
  planner: ["reasoning"],
};

const rrCounters = new Map<string, number>();

/**
 * Ordered candidate list for a role. Precedence: explicit override (user picked a worker) → role assignment from the
 * Agents page → default worker setting → capability/role scoring with load balancing among ties. The remainder is
 * ordered by the configured fallback list first, then by score, so failover follows the user's priorities (spec 29/41).
 */
export function selectCandidateProviders(role: string, overrideProviderId?: string): ProviderPublic[] {
  const enabled = listProviders().filter((p) => p.enabled);
  if (enabled.length === 0) return [];
  const byId = new Map(enabled.map((p) => [p.id, p]));

  const preferredCaps = ROLE_PREFERRED_CAPABILITIES[role] || [];
  const score = (p: ProviderPublic): number => {
    let s = 0;
    if (p.role === role) s += 100;
    else if (p.role === "any" || p.role === "worker") s += 10;
    else s -= 50;
    s += p.capabilities.filter((c) => preferredCaps.includes(c)).length * 5;
    return s;
  };

  const forced: ProviderPublic[] = [];
  const pushForced = (id?: string | null) => {
    const p = id ? byId.get(id) : undefined;
    if (p && !forced.includes(p)) forced.push(p);
  };
  pushForced(overrideProviderId);
  pushForced(getRoleConfig(role).provider_id);
  if (role !== "manager" && role !== "planner") pushForced(getSetting("default_worker_provider_id") || undefined);
  if (role === "manager" || role === "planner") pushForced(getSetting("default_manager_provider_id") || undefined);

  const rest = enabled.filter((p) => !forced.includes(p));
  let ordered: ProviderPublic[];
  if (forced.length === 0 && rest.length > 0) {
    // balance among providers that tie for the best score
    const scored = rest.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s || a.p.priority - b.p.priority);
    const top = scored[0].s;
    const tied = scored.filter((x) => x.s === top).map((x) => x.p);
    const stats = providerStats(tied.map((p) => p.id));
    const strategy = (getSetting("load_balance_strategy") || "priority") as Strategy;
    const rr = rrCounters.get(role) ?? 0;
    rrCounters.set(role, rr + 1);
    const balanced = orderByStrategy(
      tied.map((p) => ({ p, id: p.id, priority: p.priority, avgLatencyMs: stats[p.id].avgLatencyMs, requests24h: stats[p.id].requests24h })),
      strategy,
      rr
    ).map((x) => x.p);
    ordered = [...balanced, ...scored.filter((x) => x.s !== top).map((x) => x.p)];
  } else {
    ordered = [...rest].sort((a, b) => score(b) - score(a) || a.priority - b.priority);
  }

  const fallbackIds: string[] = getSetting("fallback_provider_ids") || [];
  const fbRank = (p: ProviderPublic) => { const i = fallbackIds.indexOf(p.id); return i === -1 ? 1e9 : i; };
  const head = ordered.slice(0, forced.length === 0 ? 1 : 0);
  const tail = ordered.slice(head.length).sort((a, b) => fbRank(a) - fbRank(b));
  return [...forced, ...head, ...tail];
}
