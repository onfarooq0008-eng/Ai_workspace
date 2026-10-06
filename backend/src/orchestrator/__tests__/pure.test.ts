import assert from "node:assert";
import { test } from "node:test";
import { evaluateLimits } from "../limitsPure";
import { orderByStrategy } from "../loadBalancePure";
import { computeStages } from "../staging";

const none = { requests_per_minute: null, tokens_per_minute: null, daily_limit: null, monthly_budget: null };
const zero = { requestsLastMinute: 0, tokensLastMinute: 0, requestsToday: 0, costThisMonth: 0 };

test("limits: no limits configured is always ok", () => {
  assert.strictEqual(evaluateLimits(none, { ...zero, requestsLastMinute: 9999 }).ok, true);
});
test("limits: requests per minute", () => {
  const r = evaluateLimits({ ...none, requests_per_minute: 5 }, { ...zero, requestsLastMinute: 5 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason!.includes("requests/minute"));
});
test("limits: below limit is ok", () => {
  assert.strictEqual(evaluateLimits({ ...none, requests_per_minute: 5 }, { ...zero, requestsLastMinute: 4 }).ok, true);
});
test("limits: tokens per minute, daily, monthly", () => {
  assert.strictEqual(evaluateLimits({ ...none, tokens_per_minute: 100 }, { ...zero, tokensLastMinute: 100 }).ok, false);
  assert.strictEqual(evaluateLimits({ ...none, daily_limit: 10 }, { ...zero, requestsToday: 10 }).ok, false);
  assert.strictEqual(evaluateLimits({ ...none, monthly_budget: 1 }, { ...zero, costThisMonth: 1.5 }).ok, false);
});

const c = (id: string, priority: number, lat: number | null, req: number) => ({ id, priority, avgLatencyMs: lat, requests24h: req });
const group = [c("a", 1, 500, 30), c("b", 2, 200, 5), c("c", 3, null, 10)];

test("balance: priority", () => assert.deepStrictEqual(orderByStrategy(group, "priority").map((x) => x.id), ["a", "b", "c"]));
test("balance: round robin rotates", () => {
  assert.deepStrictEqual(orderByStrategy(group, "round_robin", 1).map((x) => x.id), ["b", "c", "a"]);
  assert.deepStrictEqual(orderByStrategy(group, "round_robin", 3).map((x) => x.id), ["a", "b", "c"]);
});
test("balance: lowest usage", () => assert.deepStrictEqual(orderByStrategy(group, "lowest_usage").map((x) => x.id), ["b", "c", "a"]));
test("balance: fastest puts unknown latency last", () => assert.deepStrictEqual(orderByStrategy(group, "fastest").map((x) => x.id), ["b", "a", "c"]));
test("balance: random is a permutation", () => {
  const r = orderByStrategy(group, "random", 0, () => 0.3).map((x) => x.id).sort();
  assert.deepStrictEqual(r, ["a", "b", "c"]);
});

test("stages: linear and parallel", () => {
  const s = computeStages([
    { id: "t1", depends_on: [] },
    { id: "t2", depends_on: [] },
    { id: "t3", depends_on: ["t1", "t2"] },
    { id: "t4", depends_on: ["t3"] },
  ]);
  assert.deepStrictEqual(s, { t1: 0, t2: 0, t3: 1, t4: 2 });
});
test("stages: cycle does not hang", () => {
  const s = computeStages([{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }]);
  assert.ok(typeof s.a === "number" && typeof s.b === "number");
});
test("stages: unknown dependency ignored", () => {
  assert.strictEqual(computeStages([{ id: "a", depends_on: ["zzz"] }]).a, 0);
});
