export interface StageInput {
  id: string;
  depends_on: string[];
}

/**
 * Computes each task's "stage" = length of its longest dependency chain (0 for tasks with no dependencies).
 * Tasks in the same stage can run in parallel. Cycle-safe: a cycle just yields a bounded depth instead of looping.
 */
export function computeStages(tasks: StageInput[]): Record<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const t = byId.get(id);
    let d = 0;
    for (const dep of t?.depends_on || []) if (byId.has(dep)) d = Math.max(d, depth(dep) + 1);
    visiting.delete(id);
    memo.set(id, d);
    return d;
  }
  const out: Record<string, number> = {};
  for (const t of tasks) out[t.id] = depth(t.id);
  return out;
}
