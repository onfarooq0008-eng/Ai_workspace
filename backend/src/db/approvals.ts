import { nanoid } from "nanoid";
import { db } from "./index";

export interface ApprovalRow {
  id: string;
  task_id: string | null;
  project_id: string | null;
  tool_name: string;
  permission_level: string;
  args: string | null;
  status: "pending" | "approved" | "denied" | "timed_out";
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

export function createApproval(opts: {
  taskId?: string;
  projectId?: string;
  toolName: string;
  permissionLevel: string;
  args: unknown;
}): ApprovalRow {
  const id = `appr_${nanoid(10)}`;
  db.prepare(
    `INSERT INTO approvals (id, task_id, project_id, tool_name, permission_level, args)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, opts.taskId ?? null, opts.projectId ?? null, opts.toolName, opts.permissionLevel, JSON.stringify(opts.args));
  return getApproval(id)!;
}

export function getApproval(id: string): ApprovalRow | undefined {
  return db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
}

export function listPendingApprovals(): ApprovalRow[] {
  return db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC").all() as ApprovalRow[];
}

export function decideApproval(id: string, approve: boolean, decidedBy: string): ApprovalRow | undefined {
  db.prepare(
    `UPDATE approvals SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'`
  ).run(approve ? "approved" : "denied", decidedBy, id);
  return getApproval(id);
}

export function timeoutApproval(id: string): void {
  db.prepare(`UPDATE approvals SET status = 'timed_out', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(id);
}
