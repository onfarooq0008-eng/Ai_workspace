export type Strategy = "priority" | "round_robin" | "lowest_usage" | "fastest" | "random";
export const STRATEGIES: Strategy[] = ["priority", "round_robin", "lowest_usage", "fastest", "random"];

export interface BalanceCandidate {
  id: string;
  priority: number;
  avgLatencyMs: number | null;
  requests24h: number;
}

/** Orders a group of equivalent candidates according to the chosen load-balancing strategy (spec section 30). */
export function orderByStrategy<T extends BalanceCandidate>(group: T[], strategy: Strategy, rrIndex = 0, rand: () => number = Math.random): T[] {
  const byPriority = [...group].sort((a, b) => a.priority - b.priority);
  switch (strategy) {
    case "round_robin": {
      if (byPriority.length === 0) return byPriority;
      const n = rrIndex % byPriority.length;
      return [...byPriority.slice(n), ...byPriority.slice(0, n)];
    }
    case "lowest_usage":
      return [...byPriority].sort((a, b) => a.requests24h - b.requests24h || a.priority - b.priority);
    case "fastest":
      return [...byPriority].sort((a, b) => {
        const la = a.avgLatencyMs ?? Number.POSITIVE_INFINITY;
        const lb = b.avgLatencyMs ?? Number.POSITIVE_INFINITY;
        return la === lb ? a.priority - b.priority : la - lb;
      });
    case "random": {
      const arr = [...byPriority];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    default:
      return byPriority;
  }
}
