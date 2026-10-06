import { nanoid } from "nanoid";
import { db } from "./index";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING"
  | "CANCELLED";

export interface TaskRow {
  id: string;
  chat_id: string | null;
  project_id: string | null;
  plan_id: string;
  title: string;
  description: string | null;
  role: string;
  status: TaskStatus;
  assigned_provider_id: string | null;
  input: string | null;
  output: string | null;
  errors: string | null;
  attempts: number;
  max_attempts: number;
  sequence: number;
  created_at: string;
  updated_at: string;
}

export interface NewTaskSpec {
  localId: string; // planner-assigned id, e.g. "t1" - used only to resolve dependsOn
  title: string;
  description?: string;
  role: string;
  dependsOn?: string[]; // local ids
}

/**
 * Inserts a full plan (tasks + dependency edges) in one transaction, mapping
 * the planner's local task ids ("t1", "t2"...) to real generated ids.
 */
export function createPlan(opts: {
  chatId?: string;
  projectId?: string;
  planId?: string;
  maxAttempts?: number;
  tasks: NewTaskSpec[];
}): { planId: string; tasks: TaskRow[] } {
  const planId = opts.planId || `plan_${nanoid(10)}`;
  const localToReal = new Map<string, string>();

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, chat_id, project_id, plan_id, title, description, role, max_attempts, sequence)
     VALUES (@id, @chat_id, @project_id, @plan_id, @title, @description, @role, @max_attempts, @sequence)`
  );
  const insertDep = db.prepare(
    `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`
  );

  const run = db.transaction(() => {
    opts.tasks.forEach((t, idx) => {
      const id = `task_${nanoid(10)}`;
      localToReal.set(t.localId, id);
      insertTask.run({
        id,
        chat_id: opts.chatId ?? null,
        project_id: opts.projectId ?? null,
        plan_id: planId,
        title: t.title,
        description: t.description ?? null,
        role: t.role,
        max_attempts: opts.maxAttempts ?? 3,
        sequence: idx,
      });
    });
    for (const t of opts.tasks) {
      const taskId = localToReal.get(t.localId)!;
      for (const dep of t.dependsOn || []) {
        const depId = localToReal.get(dep);
        if (depId) insertDep.run(taskId, depId);
      }
    }
  });
  run();

  return { planId, tasks: listTasksByPlan(planId) };
}

export function listTasksByPlan(planId: string): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY sequence ASC").all(planId) as TaskRow[];
}

export function listTasksByChat(chatId: string): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE chat_id = ? ORDER BY sequence ASC").all(chatId) as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function getDependencyIds(taskId: string): string[] {
  const rows = db
    .prepare("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?")
    .all(taskId) as { depends_on_task_id: string }[];
  return rows.map((r) => r.depends_on_task_id);
}

export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  fields?: Partial<{
    assignedProviderId: string;
    input: unknown;
    output: unknown;
    appendError: string;
    attempts: number;
  }>
) {
  const existing = getTask(id);
  if (!existing) return;

  let errorsArr: string[] = [];
  try {
    errorsArr = existing.errors ? JSON.parse(existing.errors) : [];
  } catch {
    errorsArr = [];
  }
  if (fields?.appendError) errorsArr.push(fields.appendError);

  db.prepare(
    `UPDATE tasks SET
      status = ?,
      assigned_provider_id = COALESCE(?, assigned_provider_id),
      input = COALESCE(?, input),
      output = COALESCE(?, output),
      errors = ?,
      attempts = COALESCE(?, attempts),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    status,
    fields?.assignedProviderId ?? null,
    fields?.input !== undefined ? JSON.stringify(fields.input) : null,
    fields?.output !== undefined ? JSON.stringify(fields.output) : null,
    JSON.stringify(errorsArr),
    fields?.attempts ?? null,
    id
  );
}

/** Returns true once every task this task depends on has reached COMPLETED. */
export function dependenciesSatisfied(taskId: string): boolean {
  const depIds = getDependencyIds(taskId);
  if (depIds.length === 0) return true;
  return depIds.every((depId) => getTask(depId)?.status === "COMPLETED");
}

/** True if any dependency has permanently failed or was cancelled - this task can never run. */
export function dependenciesBlocked(taskId: string): boolean {
  const depIds = getDependencyIds(taskId);
  return depIds.some((depId) => {
    const s = getTask(depId)?.status;
    return s === "FAILED" || s === "CANCELLED";
  });
}

/** Most recent plan id for a chat (plans are groups of tasks created by one planning run). */
export function latestPlanId(chatId: string): string | undefined {
  const r = db.prepare("SELECT plan_id FROM tasks WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as { plan_id: string } | undefined;
  return r?.plan_id;
}

/** Makes FAILED / CANCELLED / interrupted tasks eligible to run again (Task resumption, spec section 14). */
export function resetTasksForResume(planId: string): number {
  return db
    .prepare("UPDATE tasks SET status = 'PENDING', attempts = 0, input = NULL, updated_at = datetime('now') WHERE plan_id = ? AND status IN ('FAILED', 'CANCELLED', 'RUNNING', 'RETRYING', 'WAITING')")
    .run(planId).changes;
}

/** After a crash/restart, anything left RUNNING can never finish: mark it failed so it can be resumed. */
export function recoverOrphans(): number {
  db.prepare("UPDATE approvals SET status = 'timed_out', decided_at = datetime('now') WHERE status = 'pending'").run();
  return db
    .prepare("UPDATE tasks SET status = 'FAILED', errors = json_insert(COALESCE(errors, '[]'), '$[#]', 'Server restarted while this task was running'), updated_at = datetime('now') WHERE status = 'RUNNING'")
    .run().changes;
}

export function listActiveTasks() {
  return db
    .prepare("SELECT t.id, t.chat_id, t.project_id, t.plan_id, t.title, t.role, t.status, t.attempts, t.updated_at FROM tasks t WHERE t.status IN ('RUNNING', 'RETRYING') ORDER BY t.updated_at DESC")
    .all();
}

export function cancelTaskRow(id: string) {
  db.prepare("UPDATE tasks SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ? AND status IN ('PENDING', 'WAITING', 'RETRYING', 'FAILED')").run(id);
}

export function retryTaskRow(id: string) {
  db.prepare("UPDATE tasks SET status = 'PENDING', attempts = 0, input = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('FAILED', 'CANCELLED')").run(id);
}
