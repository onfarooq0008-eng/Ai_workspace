import { nanoid } from "nanoid";
import { db } from "./index";
import { redactSecrets } from "../crypto/encryption";

export function logToolCall(opts: {
  taskId?: string;
  projectId?: string;
  toolName: string;
  permissionLevel: string;
  args: unknown;
  result: unknown;
  exitCode?: number | null;
  durationMs?: number;
  status: "ok" | "error" | "denied" | "blocked";
}): void {
  const id = `tc_${nanoid(10)}`;
  db.prepare(
    `INSERT INTO tool_calls (id, task_id, project_id, tool_name, permission_level, args, result, exit_code, duration_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.taskId ?? null,
    opts.projectId ?? null,
    opts.toolName,
    opts.permissionLevel,
    redactSecrets(JSON.stringify(opts.args ?? {})),
    redactSecrets(JSON.stringify(opts.result ?? {})).slice(0, 20_000),
    opts.exitCode ?? null,
    opts.durationMs ?? null,
    opts.status
  );
}

export function listToolCallsForTask(taskId: string) {
  return db.prepare("SELECT * FROM tool_calls WHERE task_id = ? ORDER BY created_at ASC").all(taskId);
}

export function listRecentToolCalls(projectId: string, limit = 100) {
  return db
    .prepare("SELECT * FROM tool_calls WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit);
}
