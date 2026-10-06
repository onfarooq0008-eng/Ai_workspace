import { nanoid } from "nanoid";
import { db } from "./index";

export function recordCheckpoint(opts: { projectId: string; taskId?: string; label: string; commitHash: string | null; message?: string }) {
  const id = `ckpt_${nanoid(10)}`;
  db.prepare("INSERT INTO git_checkpoints (id, project_id, task_id, label, commit_hash, message) VALUES (?, ?, ?, ?, ?, ?)").run(id, opts.projectId, opts.taskId ?? null, opts.label, opts.commitHash, opts.message ?? null);
  return db.prepare("SELECT * FROM git_checkpoints WHERE id = ?").get(id);
}

export function listCheckpoints(projectId: string) {
  return db.prepare("SELECT * FROM git_checkpoints WHERE project_id = ? ORDER BY created_at DESC, rowid DESC").all(projectId);
}

export function countCheckpoints(projectId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM git_checkpoints WHERE project_id = ?").get(projectId) as any).n;
}

export function nextCheckpointLabel(projectId: string): string {
  return `checkpoint-${String(countCheckpoints(projectId) + 1).padStart(3, "0")}`;
}

export function latestCheckpoint(projectId: string): any {
  return db.prepare("SELECT * FROM git_checkpoints WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(projectId);
}
