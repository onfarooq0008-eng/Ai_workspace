import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Simple forward-only migration system ---
// Each migration is a numbered SQL block. Applied migrations are tracked in
// the `migrations` table so re-running on an existing DB is always safe and
// never touches existing data (per spec: never modify prod schema manually).

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "init",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL, -- openai_compatible | anthropic | google | openrouter | custom
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.3,
        max_tokens INTEGER NOT NULL DEFAULT 4096,
        role TEXT NOT NULL DEFAULT 'any', -- manager|worker|reviewer|coder|researcher|any
        capabilities TEXT NOT NULL DEFAULT '[]', -- JSON array
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 100,
        requests_per_minute INTEGER,
        tokens_per_minute INTEGER,
        daily_limit INTEGER,
        monthly_budget REAL,
        last_status TEXT, -- connected|error|rate_limited|invalid_key|model_unavailable|untested
        last_error TEXT,
        last_latency_ms INTEGER,
        last_checked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        instructions TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New Chat',
        mode TEXT NOT NULL DEFAULT 'chat', -- chat|agent|team|developer|research|autonomous
        manager_provider_id TEXT REFERENCES providers(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL, -- user|assistant|manager|worker|tool|system|error
        agent_name TEXT,
        content TEXT NOT NULL,
        provider_id TEXT REFERENCES providers(id),
        input_tokens INTEGER,
        output_tokens INTEGER,
        request_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE usage_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        provider_id TEXT REFERENCES providers(id),
        project_id TEXT REFERENCES projects(id),
        chat_id TEXT REFERENCES chats(id),
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        latency_ms INTEGER,
        status TEXT, -- ok|error|timeout|rate_limited
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor TEXT,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_messages_chat ON messages(chat_id);
      CREATE INDEX idx_usage_provider ON usage_events(provider_id);
      CREATE INDEX idx_usage_created ON usage_events(created_at);
    `,
  },
  {
    id: 2,
    name: "task_engine",
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL, -- groups all tasks created by one planning run
        title TEXT NOT NULL,
        description TEXT,
        role TEXT NOT NULL, -- planner|manager|coder|researcher|reviewer|tester|security_reviewer|ui_designer|documentation|debugger
        status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|RUNNING|WAITING|COMPLETED|FAILED|RETRYING|CANCELLED
        assigned_provider_id TEXT REFERENCES providers(id),
        input TEXT,   -- JSON: context passed to the worker
        output TEXT,  -- JSON: structured worker result {status, summary, files_changed, errors, next_steps}
        errors TEXT,  -- JSON array of error strings across attempts
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, depends_on_task_id)
      );

      CREATE INDEX idx_tasks_chat ON tasks(chat_id);
      CREATE INDEX idx_tasks_plan ON tasks(plan_id);
      CREATE INDEX idx_task_deps_task ON task_dependencies(task_id);
    `,
  },
  {
    id: 3,
    name: "tools_security_sessions",
    sql: `
      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        permission_level TEXT NOT NULL, -- SAFE|NORMAL|SENSITIVE|DANGEROUS
        args TEXT, -- JSON, secrets redacted
        result TEXT, -- JSON, secrets redacted
        exit_code INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL, -- ok|error|denied|blocked
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        permission_level TEXT NOT NULL,
        args TEXT, -- JSON, secrets redacted
        status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|denied|timed_out
        decided_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        decided_at TEXT
      );

      CREATE TABLE git_checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id),
        label TEXT NOT NULL,
        commit_hash TEXT,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Persistent session store so logins survive a server restart (Phase 11)
      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX idx_tool_calls_task ON tool_calls(task_id);
      CREATE INDEX idx_approvals_status ON approvals(status);
      CREATE INDEX idx_checkpoints_project ON git_checkpoints(project_id);
    `,
  },
  {
    id: 4,
    name: "full_webui_features",
    sql: `
      CREATE TABLE role_configs (
        role TEXT PRIMARY KEY,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        temperature REAL,
        max_tokens INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        extra_instructions TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL, -- project|user
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE chat_summaries (
        chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        upto_rowid INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE project_allowlist (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        allow_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, allow_key)
      );

      CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
      );

      CREATE TABLE backups (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        size_bytes INTEGER,
        include_keys INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE providers ADD COLUMN input_price_per_1k REAL;
      ALTER TABLE providers ADD COLUMN output_price_per_1k REAL;
      ALTER TABLE usage_events ADD COLUMN agent TEXT;
      ALTER TABLE usage_events ADD COLUMN task_id TEXT;
      ALTER TABLE usage_events ADD COLUMN tokens_estimated INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX idx_memories_scope ON memories(scope, project_id);
      CREATE INDEX idx_usage_project ON usage_events(project_id);
    `,
  },
];

function applyMigrations() {
  const applied = new Set(
    (db.prepare("SELECT id FROM migrations").all() as { id: number }[]).map((r) => r.id)
  );
  const insertMigration = db.prepare("INSERT INTO migrations (id, name) VALUES (?, ?)");
  for (const m of migrations.sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    const runMigration = db.transaction(() => {
      db.exec(m.sql);
      insertMigration.run(m.id, m.name);
    });
    runMigration();
    console.log(`[db] applied migration ${m.id}_${m.name}`);
  }
}

applyMigrations();

// Ensure data directory exists for the sqlite file itself
fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
