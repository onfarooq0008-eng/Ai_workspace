import { addMessage, getProject, listMessages } from "../db/chats";
import {
  createPlan, dependenciesBlocked, dependenciesSatisfied, getDependencyIds, getTask, listTasksByPlan,
  resetTasksForResume, TaskRow, updateTaskStatus,
} from "../db/tasks";
import { latestCheckpoint } from "../db/checkpoints";
import { getRoleConfig } from "../db/roleConfigs";
import { getProjectContext } from "../db/memory";
import { getSetting } from "../runtimeConfig";
import { buildPlannerPrompt, buildWorkerSystemPrompt } from "./prompts";
import { callModelForRole, parsePlannerJson, parseWorkerJson } from "./callModel";
import { ALL_WORKER_ROLES } from "./jsonParsing";
import { runAgentLoop } from "./agentLoop";
import { eventBus } from "./eventBus";
import { CancelledError, clearCancel, isCancelled } from "./cancel";
import { listDirectoryTool } from "../tools/filesystem";
import { redactSecrets } from "../crypto/encryption";
import { log } from "../logger";

interface ChatLike {
  id: string;
  project_id: string | null;
  manager_provider_id: string | null;
}

export interface RunOptions {
  workerProviderId?: string;
}

type Emit = (event: string, data: Record<string, unknown>) => void;

interface RunEnv {
  chat: ChatLike;
  workspaceRoot: string;
  emit: Emit;
  opts: RunOptions;
  ctx: { projectId?: string; chatId?: string };
}

const MAX_TASKS_PER_PLAN = 20;
const STATUS_ICON: Record<string, string> = { PENDING: "○", WAITING: "○", RUNNING: "●", RETRYING: "●", COMPLETED: "✓", FAILED: "✕", CANCELLED: "⊘" };
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

const activeRuns = new Map<string, { startedAt: number; planId?: string }>();
export const isRunActive = (chatId: string) => activeRuns.has(chatId);
export const listActiveRuns = () => [...activeRuns.entries()].map(([chatId, v]) => ({ chatId, ...v }));

function makeEmit(chat: ChatLike): Emit {
  return (event, data) => {
    const payload = { ...data, chatId: chat.id, projectId: chat.project_id };
    eventBus.publish(event, payload);
  };
}

function makeEnv(chat: ChatLike, opts: RunOptions): RunEnv {
  const project = chat.project_id ? (getProject(chat.project_id) as any) : undefined;
  if (!project?.workspace_path) throw new Error("This chat has no project workspace attached.");
  return { chat, workspaceRoot: project.workspace_path, emit: makeEmit(chat), opts, ctx: { projectId: chat.project_id ?? undefined, chatId: chat.id } };
}

/** Starts a team run in the background (it keeps running even if the browser disconnects). */
export function startTeamRun(chat: ChatLike, userContent: string, opts: RunOptions = {}): { started: boolean; reason?: string } {
  if (activeRuns.has(chat.id)) return { started: false, reason: "This chat already has a run in progress." };
  let env: RunEnv;
  try {
    env = makeEnv(chat, opts);
  } catch (e) {
    return { started: false, reason: (e as Error).message };
  }
  activeRuns.set(chat.id, { startedAt: Date.now() });
  clearCancel(chat.id);
  env.emit("run_started", { mode: "team" });
  runTeamTask(env, userContent)
    .catch((err) => {
      const message = redactSecrets((err as Error).message);
      log("error", "team_run_crashed", { chat_id: chat.id, error: message });
      addMessage({ chatId: chat.id, role: "error", agentName: "manager", content: `The run stopped unexpectedly: ${message}` });
      env.emit("fatal_error", { error: message });
    })
    .finally(() => {
      activeRuns.delete(chat.id);
      clearCancel(chat.id);
      env.emit("run_finished", {});
    });
  return { started: true };
}

export function startResume(chat: ChatLike, planId: string, opts: RunOptions = {}): { started: boolean; reason?: string } {
  if (activeRuns.has(chat.id)) return { started: false, reason: "This chat already has a run in progress." };
  let env: RunEnv;
  try {
    env = makeEnv(chat, opts);
  } catch (e) {
    return { started: false, reason: (e as Error).message };
  }
  activeRuns.set(chat.id, { startedAt: Date.now(), planId });
  clearCancel(chat.id);
  env.emit("run_started", { mode: "resume", planId });
  (async () => {
    const reset = resetTasksForResume(planId);
    const tasks = listTasksByPlan(planId);
    env.emit("plan_created", { planId, resumed: true, tasks: tasks.map((t) => ({ id: t.id, title: t.title, role: t.role, status: t.status })) });
    addMessage({ chatId: chat.id, role: "manager", agentName: "manager", content: `Resuming the plan - ${reset} task(s) re-queued.` });
    env.emit("agent_status", { agent: "manager", status: "supervising" });
    await executeWorkflow(planId, env);
    await finishRun(planId, env, "Resumed plan");
  })()
    .catch((err) => {
      addMessage({ chatId: chat.id, role: "error", agentName: "manager", content: `Resume failed: ${redactSecrets((err as Error).message)}` });
      env.emit("fatal_error", { error: redactSecrets((err as Error).message) });
    })
    .finally(() => {
      activeRuns.delete(chat.id);
      clearCancel(chat.id);
      env.emit("run_finished", {});
    });
  return { started: true };
}

function enabledRoles(): string[] {
  return ALL_WORKER_ROLES.filter((r) => getRoleConfig(r).enabled);
}

function recentConversation(chatId: string): string {
  const msgs = (listMessages(chatId) as any[]).filter((m) => m.role === "user" || m.role === "manager").slice(-7, -1);
  return msgs.map((m) => `${m.role}: ${String(m.content).slice(0, 500)}`).join("\n");
}

function workspaceListing(root: string): string {
  try {
    const entries = listDirectoryTool(root, ".").slice(0, 40);
    return entries.length ? entries.map((e) => (e.type === "directory" ? `${e.name}/` : e.name)).join(", ") : "(empty workspace)";
  } catch {
    return "(unreadable)";
  }
}

/**
 * The full agent loop for one request (spec section 37): load context → plan → execute the task graph with bounded
 * concurrency, retries and debugger-assisted self-correction → verify → report.
 */
async function runTeamTask(env: RunEnv, userContent: string): Promise<void> {
  const { chat, emit, ctx } = env;
  emit("agent_status", { agent: "manager", status: "planning" });

  const roles = enabledRoles();
  if (roles.length === 0) throw new Error("All worker roles are disabled on the Agents page.");

  const projectCtx = getProjectContext(chat.project_id);
  const recent = recentConversation(chat.id);
  const plannerInput = [
    projectCtx && `Project context:\n${projectCtx}`,
    `Files currently in the project workspace: ${workspaceListing(env.workspaceRoot)}`,
    recent && `Recent conversation:\n${recent}`,
    `User request:\n${userContent}`,
  ].filter(Boolean).join("\n\n");

  let planTasks;
  let lastErr = "";
  for (let attempt = 1; attempt <= 2 && !planTasks; attempt++) {
    try {
      const planRaw = await callModelForRole(
        "planner",
        [
          { role: "system", content: buildPlannerPrompt(roles) },
          { role: "user", content: attempt === 1 ? plannerInput : `${plannerInput}\n\nYour previous reply could not be parsed (${lastErr}). Reply with ONLY the JSON object.` },
        ],
        { ...ctx, agent: "manager" },
        chat.manager_provider_id ?? undefined
      );
      planTasks = parsePlannerJson(planRaw.content);
    } catch (err) {
      lastErr = (err as Error).message;
      if (/All providers|No enabled provider|budget|limits/i.test(lastErr)) break;
    }
  }
  if (!planTasks) {
    addMessage({ chatId: chat.id, role: "error", agentName: "manager", content: `Planning failed: ${lastErr}` });
    emit("fatal_error", { error: `Planning failed: ${lastErr}` });
    return;
  }

  planTasks = planTasks.slice(0, MAX_TASKS_PER_PLAN).map((t) => ({ ...t, role: t.role === "planner" || roles.includes(t.role) ? t.role : roles[0] }));

  const { planId, tasks: createdTasks } = createPlan({
    chatId: chat.id,
    projectId: chat.project_id ?? undefined,
    maxAttempts: Math.max(1, Number(getSetting("max_retries")) || 3),
    tasks: planTasks.map((t) => ({ localId: t.id, title: t.title, description: t.description, role: t.role, dependsOn: t.depends_on })),
  });
  activeRuns.set(chat.id, { startedAt: activeRuns.get(chat.id)?.startedAt ?? Date.now(), planId });

  emit("plan_created", { planId, tasks: createdTasks.map((t) => ({ id: t.id, title: t.title, role: t.role, status: t.status })) });
  addMessage({
    chatId: chat.id, role: "manager", agentName: "manager",
    content: `Planning complete - ${createdTasks.length} task(s):\n` + createdTasks.map((t) => `- [${t.role}] ${t.title}`).join("\n"),
  });
  emit("agent_status", { agent: "manager", status: "supervising" });

  await executeWorkflow(planId, env);
  await finishRun(planId, env, userContent);
}

async function finishRun(planId: string, env: RunEnv, request: string): Promise<void> {
  const { chat, emit } = env;
  emit("agent_status", { agent: "manager", status: "reporting" });
  const final = listTasksByPlan(planId);
  const completed = final.filter((t) => t.status === "COMPLETED");
  const failed = final.filter((t) => t.status === "FAILED");
  const cancelled = final.filter((t) => t.status === "CANCELLED");

  const parse = (t: TaskRow): any => { try { return t.output ? JSON.parse(t.output) : {}; } catch { return {}; } };
  const files = [...new Set(completed.flatMap((t) => (parse(t).files_changed as string[]) || []))];
  const tests = final.filter((t) => t.role === "tester");
  const everErrored = final.filter((t) => { try { return t.errors && JSON.parse(t.errors).length > 0; } catch { return false; } });
  const fixed = everErrored.filter((t) => t.status === "COMPLETED");
  const remaining = final.filter((t) => t.status === "FAILED" || t.status === "CANCELLED");
  const project = chat.project_id ? (getProject(chat.project_id) as any) : undefined;
  const ckpt = chat.project_id ? (latestCheckpoint(chat.project_id) as any) : undefined;
  const wasCancelled = isCancelled(chat.id);

  const headline = wasCancelled ? "TASK STOPPED" : failed.length ? "TASK COMPLETED WITH ISSUES" : "TASK COMPLETED";
  const lines = [
    headline,
    "",
    `Request: ${request.slice(0, 200)}`,
    `Tasks: ${completed.length}/${final.length} completed${failed.length ? `, ${failed.length} failed` : ""}${cancelled.length ? `, ${cancelled.length} cancelled` : ""}`,
    "",
    ...final.map((t) => `${STATUS_ICON[t.status]} [${t.role}] ${t.title}`),
    "",
    `Files changed: ${files.length}${files.length ? "\n" + files.slice(0, 25).map((f) => `  - ${f}`).join("\n") : ""}`,
    `Tests performed: ${tests.length ? tests.map((t) => `${t.status === "COMPLETED" ? "✓" : "✕"} ${t.title}`).join("; ") : "none"}`,
    `Issues found: ${everErrored.length}`,
    `Issues fixed: ${fixed.length}`,
    `Remaining issues: ${remaining.length ? remaining.map((t) => t.title).join("; ") : "none detected"}`,
    project ? `Project location: ${project.workspace_path}` : "",
    ckpt ? `Git checkpoint: ${ckpt.label} (${String(ckpt.commit_hash || "").slice(0, 8)})` : "",
  ].filter((l) => l !== "");
  const summary = lines.join("\n");

  addMessage({ chatId: chat.id, role: "manager", agentName: "manager", content: summary });
  emit("team_done", { planId, summary, completed: completed.length, failed: failed.length, cancelled: cancelled.length, total: final.length, stopped: wasCancelled });
}

/** Bounded-concurrency scheduler over the task dependency graph (spec sections 13-14, 56). */
async function executeWorkflow(planId: string, env: RunEnv): Promise<void> {
  const running = new Map<string, Promise<void>>();

  const cancelRemaining = (reason: string) => {
    for (const t of listTasksByPlan(planId)) {
      if (TERMINAL.has(t.status) || running.has(t.id)) continue;
      updateTaskStatus(t.id, "CANCELLED", { appendError: reason });
      env.emit("task_status", { taskId: t.id, planId, title: t.title, role: t.role, status: "CANCELLED" });
    }
  };

  let stagnant = 0;
  while (true) {
    if (isCancelled(env.chat.id)) cancelRemaining("Cancelled by user");

    for (const task of listTasksByPlan(planId)) {
      if (running.has(task.id) || TERMINAL.has(task.status) || task.status === "RUNNING") continue;
      if (running.size >= Math.max(1, Number(getSetting("max_concurrent_workers")) || 2)) break;
      if (dependenciesBlocked(task.id)) {
        updateTaskStatus(task.id, "CANCELLED", { appendError: "Blocked: a dependency failed or was cancelled" });
        env.emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "CANCELLED" });
        continue;
      }
      if (!dependenciesSatisfied(task.id)) continue;
      const p = runSingleTask(task, planId, env).finally(() => running.delete(task.id));
      running.set(task.id, p);
    }

    const unresolved = listTasksByPlan(planId).filter((t) => !TERMINAL.has(t.status));
    if (unresolved.length === 0 && running.size === 0) break;

    if (running.size > 0) {
      stagnant = 0;
      await Promise.race(running.values());
    } else {
      if (++stagnant > 3) {
        for (const t of unresolved) {
          updateTaskStatus(t.id, "CANCELLED", { appendError: "Scheduling deadlock (likely a dependency cycle) - cancelled" });
          env.emit("task_status", { taskId: t.id, planId, title: t.title, role: t.role, status: "CANCELLED" });
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

async function runSingleTask(task: TaskRow, planId: string, env: RunEnv): Promise<void> {
  const { chat, emit, ctx } = env;
  const attempt = task.attempts + 1;
  updateTaskStatus(task.id, "RUNNING", { attempts: attempt });
  emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "RUNNING", attempt });
  emit("agent_status", { agent: task.role, status: "working", task: task.title, taskId: task.id });

  const depSummaries = getDependencyIds(task.id).map((depId) => {
    const dep = getTask(depId);
    let output: any = {};
    try { output = dep?.output ? JSON.parse(dep.output) : {}; } catch { output = {}; }
    return { title: dep?.title, role: dep?.role, summary: output.summary, files_changed: output.files_changed, next_steps: output.next_steps };
  });

  let guidance: string | undefined;
  try { guidance = task.input ? JSON.parse(task.input).debugger_guidance : undefined; } catch { guidance = undefined; }

  const projectCtx = getProjectContext(chat.project_id, 2500);
  const payload = {
    task: { title: task.title, description: task.description },
    dependency_results: depSummaries,
    ...(projectCtx ? { project_context: projectCtx } : {}),
    ...(guidance ? { guidance_from_previous_failed_attempt: guidance } : {}),
  };

  let timedOut = false;
  const taskIsCancelled = () => timedOut || isCancelled(chat.id);
  let timer: NodeJS.Timeout | undefined;

  try {
    const timeoutMs = Number(getSetting("task_timeout_ms"));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error(`Task exceeded the ${Math.round(timeoutMs / 1000)}s task timeout`)); }, timeoutMs);
    });

    const loop = await Promise.race([
      runAgentLoop(
        task.role,
        payload,
        { workspaceRoot: env.workspaceRoot, taskId: task.id, projectId: chat.project_id ?? undefined, role: task.role, send: (e, d) => emit(e, d as any), isCancelled: taskIsCancelled },
        { ...ctx, taskId: task.id },
        {
          overrideProviderId: env.opts.workerProviderId || undefined,
          onIteration: (info) => emit("agent_iteration", { taskId: task.id, role: task.role, iteration: info.iteration, status: info.output.status, thought: info.output.summary?.slice(0, 160) }),
          onTool: (t) => {
            const brief = t.tool === "run_command" ? `$ ${t.args?.command}` : `${t.tool}${t.args?.path ? " " + t.args.path : ""}`;
            addMessage({ chatId: chat.id, role: "tool", agentName: task.role, content: `${brief}${t.ok ? "" : `\n✕ ${t.error ?? "failed"}`}` });
          },
        }
      ),
      timeout,
    ]);

    const parsed = loop.final;
    if (parsed.status === "failed") throw new Error(parsed.errors.join("; ") || "Worker reported failure without a stated reason");

    updateTaskStatus(task.id, "COMPLETED", { assignedProviderId: loop.providerId, output: parsed });
    emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "COMPLETED" });
    emit("worker_output", { taskId: task.id, role: task.role, title: task.title, summary: parsed.summary, filesChanged: parsed.files_changed });
    addMessage({ chatId: chat.id, role: "worker", agentName: task.role, content: parsed.summary, providerId: loop.providerId });
  } catch (err) {
    if (err instanceof CancelledError || (isCancelled(chat.id) && !timedOut)) {
      updateTaskStatus(task.id, "CANCELLED", { appendError: "Cancelled by user" });
      emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "CANCELLED" });
      return;
    }
    const message = redactSecrets((err as Error).message);
    const fresh = getTask(task.id)!;
    if (fresh.attempts < fresh.max_attempts) {
      // Self-correction (spec section 15): route the real error through the Debugger before retrying.
      let advice: string | undefined;
      if (task.role !== "debugger" && task.role !== "planner" && enabledRoles().includes("debugger")) {
        emit("agent_status", { agent: "debugger", status: "working", task: `Diagnosing: ${task.title}`, taskId: task.id });
        try {
          const dbg = await callModelForRole(
            "debugger",
            [
              { role: "system", content: buildWorkerSystemPrompt("debugger", [], getRoleConfig("debugger").extra_instructions) },
              { role: "user", content: JSON.stringify({ task: { title: `Diagnose failure in: ${task.title}`, description: task.description }, dependency_results: [], failed_role: task.role, error_output: message }) },
            ],
            { ...ctx, agent: "debugger", taskId: task.id },
            env.opts.workerProviderId || undefined
          );
          advice = parseWorkerJson(dbg.content).summary;
          emit("worker_output", { taskId: task.id, role: "debugger", title: `Diagnosis for ${task.title}`, summary: `Diagnosis for retry: ${advice}` });
        } catch {
          advice = undefined;
        }
        emit("agent_status", { agent: "debugger", status: "idle" });
      }
      updateTaskStatus(task.id, "PENDING", { appendError: message, input: advice ? { debugger_guidance: advice } : undefined });
      emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "RETRYING", error: message, attempt });
    } else {
      updateTaskStatus(task.id, "FAILED", { appendError: message });
      emit("task_status", { taskId: task.id, planId, title: task.title, role: task.role, status: "FAILED", error: message, attempt });
      addMessage({ chatId: chat.id, role: "error", agentName: task.role, content: `Task "${task.title}" failed after ${fresh.attempts} attempt(s): ${message}` });
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
