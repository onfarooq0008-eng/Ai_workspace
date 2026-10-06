import assert from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gitInit, gitStatus, createCheckpoint, gitLog, gitCommit, gitAdd } from "../git";

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
}

test("gitInit creates a repo", async () => {
  const ws = freshWorkspace();
  await gitInit(ws);
  assert.ok(fs.existsSync(path.join(ws, ".git")));
});

test("createCheckpoint commits current state and returns a hash", async () => {
  const ws = freshWorkspace();
  fs.writeFileSync(path.join(ws, "a.txt"), "hello");
  const { hash, output } = await createCheckpoint(ws, "checkpoint-001");
  assert.ok(hash && hash.length === 40, `expected a 40-char hash, got: ${hash}`);
});

test("gitLog reflects checkpoints in order", async () => {
  const ws = freshWorkspace();
  fs.writeFileSync(path.join(ws, "a.txt"), "v1");
  await createCheckpoint(ws, "checkpoint-001");
  fs.writeFileSync(path.join(ws, "a.txt"), "v2");
  await createCheckpoint(ws, "checkpoint-002");
  const log = await gitLog(ws, 10);
  assert.ok(log.includes("checkpoint-002"));
  assert.ok(log.includes("checkpoint-001"));
});
