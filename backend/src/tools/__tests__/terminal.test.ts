import assert from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCommand } from "../terminal";

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
}

test("runs a normal command and captures stdout", async () => {
  const ws = freshWorkspace();
  const result = await runCommand(ws, "echo hello-world", 5000);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes("hello-world"));
});

test("cwd is actually the workspace, not the server root", async () => {
  const ws = freshWorkspace();
  fs.writeFileSync(path.join(ws, "marker.txt"), "x");
  const result = await runCommand(ws, "ls", 5000);
  assert.ok(result.stdout.includes("marker.txt"));
});

test("blocked command never actually executes", async () => {
  const ws = freshWorkspace();
  const result = await runCommand(ws, "sudo rm -rf /", 5000);
  assert.strictEqual(result.exitCode, null);
  assert.ok(result.stderr.includes("blocked"));
});

test("nonzero exit code is captured, not thrown", async () => {
  const ws = freshWorkspace();
  const result = await runCommand(ws, "exit 7", 5000);
  assert.strictEqual(result.exitCode, 7);
});

test("timeout is enforced on a hanging command", async () => {
  const ws = freshWorkspace();
  const start = Date.now();
  const result = await runCommand(ws, "sleep 5", 300);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `expected early timeout, took ${elapsed}ms`);
  assert.notStrictEqual(result.exitCode, 0);
});
