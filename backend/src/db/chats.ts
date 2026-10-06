import { nanoid } from "nanoid";
import * as path from "path";
import * as fs from "fs";
import { db } from "./index";
import { config } from "../config";

export function createProject(name: string, instructions?: string) {
  const id = `proj_${nanoid(10)}`;
  const workspacePath = path.join(config.workspaceDir, id);
  fs.mkdirSync(workspacePath, { recursive: true });
  db.prepare("INSERT INTO projects (id, name, workspace_path, instructions) VALUES (?, ?, ?, ?)").run(id, name, workspacePath, instructions ?? null);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
}

export function listProjects() {
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
       FROM projects p ORDER BY p.updated_at DESC`
    )
    .all();
}

export function getProject(id: string) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

export function updateProject(id: string, patch: { name?: string; instructions?: string | null }) {
  const cur = getProject(id) as any;
  if (!cur) return undefined;
  db.prepare("UPDATE projects SET name = ?, instructions = ?, updated_at = datetime('now') WHERE id = ?").run(
    patch.name ?? cur.name,
    patch.instructions === undefined ? cur.instructions : patch.instructions,
    id
  );
  return getProject(id);
}

/** Deletes the project row (cascades chats/tasks/etc) and its workspace directory, only if the directory is inside WORKSPACE_DIR. */
export function deleteProject(id: string): boolean {
  const cur = getProject(id) as any;
  if (!cur) return false;
  const root = path.resolve(config.workspaceDir) + path.sep;
  const target = path.resolve(cur.workspace_path);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (target.startsWith(root) && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  return true;
}

export function createChat(opts: { projectId?: string; title?: string; mode?: string; managerProviderId?: string }) {
  const id = `chat_${nanoid(10)}`;
  db.prepare("INSERT INTO chats (id, project_id, title, mode, manager_provider_id) VALUES (?, ?, ?, ?, ?)").run(
    id,
    opts.projectId ?? null,
    opts.title ?? "New Chat",
    opts.mode ?? "chat",
    opts.managerProviderId ?? null
  );
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as any;
}

export function listChats(opts: { projectId?: string; q?: string } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.projectId) { where.push("project_id = ?"); params.push(opts.projectId); }
  if (opts.q) { where.push("title LIKE ?"); params.push(`%${opts.q}%`); }
  return db.prepare(`SELECT * FROM chats ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, rowid DESC LIMIT 200`).all(...params);
}

export function getChat(id: string) {
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as any;
}

export function updateChat(id: string, patch: { title?: string; mode?: string; project_id?: string | null; manager_provider_id?: string | null }) {
  const cur = getChat(id);
  if (!cur) return undefined;
  db.prepare("UPDATE chats SET title = ?, mode = ?, project_id = ?, manager_provider_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    patch.title ?? cur.title,
    patch.mode ?? cur.mode,
    patch.project_id === undefined ? cur.project_id : patch.project_id,
    patch.manager_provider_id === undefined ? cur.manager_provider_id : patch.manager_provider_id,
    id
  );
  return getChat(id);
}

export function deleteChat(id: string): boolean {
  return db.prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
}

export function clearChatMessages(id: string) {
  db.prepare("DELETE FROM messages WHERE chat_id = ?").run(id);
  db.prepare("DELETE FROM chat_summaries WHERE chat_id = ?").run(id);
}

export function touchChat(id: string) {
  db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(id);
}

export function addMessage(opts: {
  chatId: string;
  role: string;
  content: string;
  agentName?: string;
  providerId?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
}) {
  const id = `msg_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, agent_name, content, provider_id, input_tokens, output_tokens, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, opts.chatId, opts.role, opts.agentName ?? null, opts.content, opts.providerId ?? null, opts.inputTokens ?? null, opts.outputTokens ?? null, opts.requestId ?? null);
  touchChat(opts.chatId);
  const chat = getChat(opts.chatId);
  if (chat && chat.title === "New Chat" && opts.role === "user") {
    const title = opts.content.replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
    db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, opts.chatId);
  }
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
}

export function listMessages(chatId: string) {
  return db.prepare("SELECT rowid AS rid, * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC").all(chatId);
}

export function recordUsage(opts: {
  requestId: string;
  providerId?: string;
  projectId?: string;
  chatId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
  latencyMs?: number;
  status: string;
  agent?: string;
  taskId?: string;
  tokensEstimated?: boolean;
}) {
  const id = `usage_${nanoid(12)}`;
  // Cost is only recorded when the user has configured pricing for the provider
  // (spec section 31: never claim an exact cost without pricing information).
  let cost: number | null = opts.estimatedCost ?? null;
  if (cost === null && opts.providerId && (opts.inputTokens || opts.outputTokens)) {
    const p = db.prepare("SELECT input_price_per_1k, output_price_per_1k FROM providers WHERE id = ?").get(opts.providerId) as any;
    if (p && (p.input_price_per_1k != null || p.output_price_per_1k != null)) {
      cost = ((opts.inputTokens || 0) / 1000) * (p.input_price_per_1k || 0) + ((opts.outputTokens || 0) / 1000) * (p.output_price_per_1k || 0);
    }
  }
  db.prepare(
    `INSERT INTO usage_events
      (id, request_id, provider_id, project_id, chat_id, model, input_tokens, output_tokens, estimated_cost, latency_ms, status, agent, task_id, tokens_estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.requestId,
    opts.providerId ?? null,
    opts.projectId ?? null,
    opts.chatId ?? null,
    opts.model ?? null,
    opts.inputTokens ?? 0,
    opts.outputTokens ?? 0,
    cost,
    opts.latencyMs ?? null,
    opts.status,
    opts.agent ?? null,
    opts.taskId ?? null,
    opts.tokensEstimated ? 1 : 0
  );
}
