import assert from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveSafePath,
  WorkspaceSecurityError,
  writeFileTool,
  readFileTool,
  createFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
} from "../filesystem";

function freshWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
  return dir;
}

test("blocks ../ traversal out of workspace", () => {
  const ws = freshWorkspace();
  assert.throws(() => resolveSafePath(ws, "../../etc/passwd"), WorkspaceSecurityError);
});

test("blocks absolute path escape", () => {
  const ws = freshWorkspace();
  assert.throws(() => resolveSafePath(ws, "/etc/passwd"), WorkspaceSecurityError);
});

test("allows a normal nested relative path", () => {
  const ws = freshWorkspace();
  const resolved = resolveSafePath(ws, "src/main.ts");
  assert.ok(resolved.startsWith(ws));
});

test("write then read roundtrip", () => {
  const ws = freshWorkspace();
  writeFileTool(ws, "hello.txt", "hi there");
  assert.strictEqual(readFileTool(ws, "hello.txt"), "hi there");
});

test("create_file refuses to overwrite existing file", () => {
  const ws = freshWorkspace();
  createFileTool(ws, "a.txt", "one");
  assert.throws(() => createFileTool(ws, "a.txt", "two"));
});

test("edit_file requires a unique match", () => {
  const ws = freshWorkspace();
  writeFileTool(ws, "a.txt", "foo foo");
  assert.throws(() => editFileTool(ws, "a.txt", "foo", "bar", false));
  const r = editFileTool(ws, "a.txt", "foo", "bar", true);
  assert.strictEqual(r.replacements, 2);
  assert.strictEqual(readFileTool(ws, "a.txt"), "bar bar");
});

test("delete_file removes the file", () => {
  const ws = freshWorkspace();
  writeFileTool(ws, "a.txt", "x");
  deleteFileTool(ws, "a.txt");
  assert.throws(() => readFileTool(ws, "a.txt"));
});

test("delete_file cannot escape workspace via traversal", () => {
  const ws = freshWorkspace();
  assert.throws(() => deleteFileTool(ws, "../../../important-file"), WorkspaceSecurityError);
});

test("list_directory lists created files", () => {
  const ws = freshWorkspace();
  writeFileTool(ws, "a.txt", "x");
  writeFileTool(ws, "sub/b.txt", "y");
  const entries = listDirectoryTool(ws, ".");
  const names = entries.map((e) => e.name).sort();
  assert.deepStrictEqual(names, ["a.txt", "sub"]);
});

test("search_files finds matching lines", () => {
  const ws = freshWorkspace();
  writeFileTool(ws, "a.txt", "line one\nTODO fix this\nline three");
  const results = searchFilesTool(ws, "TODO");
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].line, 2);
});
