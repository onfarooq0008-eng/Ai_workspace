import assert from "node:assert";
import { test } from "node:test";
import { parseWorkerJson, parsePlannerJson } from "../jsonParsing";

test("parses clean worker JSON", () => {
  const r = parseWorkerJson('{"status":"completed","summary":"did it","files_changed":["a.ts"],"errors":[],"next_steps":[],"tool_calls":[]}');
  assert.strictEqual(r.status, "completed");
  assert.strictEqual(r.summary, "did it");
  assert.deepStrictEqual(r.files_changed, ["a.ts"]);
});

test("strips markdown fences", () => {
  const r = parseWorkerJson('```json\n{"status":"failed","summary":"nope","errors":["bad"]}\n```');
  assert.strictEqual(r.status, "failed");
  assert.deepStrictEqual(r.errors, ["bad"]);
});

test("parses tool_calls", () => {
  const r = parseWorkerJson('{"status":"in_progress","summary":"reading","tool_calls":[{"tool":"read_file","args":{"path":"a.ts"}}]}');
  assert.strictEqual(r.status, "in_progress");
  assert.strictEqual(r.tool_calls.length, 1);
  assert.strictEqual(r.tool_calls[0].tool, "read_file");
  assert.deepStrictEqual(r.tool_calls[0].args, { path: "a.ts" });
});

test("falls back to plain text summary when JSON is garbage", () => {
  const r = parseWorkerJson("I did the thing, no JSON here");
  assert.strictEqual(r.status, "completed");
  assert.strictEqual(r.summary, "I did the thing, no JSON here");
  assert.deepStrictEqual(r.tool_calls, []);
});

test("ignores malformed tool_calls entries instead of crashing", () => {
  const r = parseWorkerJson('{"status":"completed","summary":"ok","tool_calls":[{"bad":"entry"},{"tool":"git_status"}]}');
  assert.strictEqual(r.tool_calls.length, 1);
  assert.strictEqual(r.tool_calls[0].tool, "git_status");
});

test("parses a valid planner response", () => {
  const tasks = parsePlannerJson(`{
    "tasks": [
      {"id":"t1","title":"Write code","description":"d","role":"coder","depends_on":[]},
      {"id":"t2","title":"Review it","description":"d2","role":"reviewer","depends_on":["t1"]}
    ]
  }`);
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[1].depends_on[0], "t1");
});

test("planner: unknown role falls back to coder", () => {
  const tasks = parsePlannerJson('{"tasks":[{"id":"t1","title":"x","description":"d","role":"bogus_role","depends_on":[]}]}');
  assert.strictEqual(tasks[0].role, "coder");
});

test("planner: duplicate task ids throw", () => {
  assert.throws(() =>
    parsePlannerJson('{"tasks":[{"id":"t1","title":"a","description":"d","role":"coder"},{"id":"t1","title":"b","description":"d","role":"coder"}]}')
  );
});

test("planner: missing tasks array throws", () => {
  assert.throws(() => parsePlannerJson('{"foo":"bar"}'));
});

test("planner: non-JSON input throws", () => {
  assert.throws(() => parsePlannerJson("not json at all"));
});
