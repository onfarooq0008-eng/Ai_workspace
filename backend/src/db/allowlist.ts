import { db } from "./index";

export function isAllowlisted(projectId: string | undefined, key: string): boolean {
  if (!projectId) return false;
  return !!db.prepare("SELECT 1 FROM project_allowlist WHERE project_id = ? AND allow_key = ?").get(projectId, key);
}
export function addAllowlist(projectId: string, key: string) {
  db.prepare("INSERT OR IGNORE INTO project_allowlist (project_id, allow_key) VALUES (?, ?)").run(projectId, key);
}
export function listAllowlist(projectId: string) {
  return db.prepare("SELECT * FROM project_allowlist WHERE project_id = ? ORDER BY created_at").all(projectId);
}
export function removeAllowlist(projectId: string, key: string) {
  db.prepare("DELETE FROM project_allowlist WHERE project_id = ? AND allow_key = ?").run(projectId, key);
}
