import { nanoid } from "nanoid";
import { db } from "./index";
import { getProject } from "./chats";

export function addMemory(scope: "project" | "user", content: string, projectId?: string) {
  const id = `mem_${nanoid(10)}`;
  db.prepare("INSERT INTO memories (id, scope, project_id, content) VALUES (?, ?, ?, ?)").run(id, scope, scope === "project" ? projectId ?? null : null, content);
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
}

export function listMemories(scope: "project" | "user", projectId?: string) {
  if (scope === "project") return db.prepare("SELECT * FROM memories WHERE scope = 'project' AND project_id = ? ORDER BY created_at ASC").all(projectId ?? "");
  return db.prepare("SELECT * FROM memories WHERE scope = 'user' ORDER BY created_at ASC").all();
}

export function deleteMemory(id: string): boolean {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}

/**
 * Project instructions + project memory + long-term user preferences, capped in size so it can be
 * handed to the Manager and to workers without blowing up context (spec sections 20-21).
 */
export function getProjectContext(projectId?: string | null, maxChars = 4000): string {
  const parts: string[] = [];
  if (projectId) {
    const p = getProject(projectId) as any;
    if (p?.instructions) parts.push(`Project instructions:\n${p.instructions}`);
    const mems = listMemories("project", projectId) as any[];
    if (mems.length) parts.push(`Project memory:\n${mems.map((m) => `- ${m.content}`).join("\n")}`);
  }
  const prefs = listMemories("user") as any[];
  if (prefs.length) parts.push(`User preferences:\n${prefs.map((m) => `- ${m.content}`).join("\n")}`);
  return parts.join("\n\n").slice(0, maxChars);
}
