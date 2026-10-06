import { readFileTool, writeFileTool, createFileTool, editFileTool, deleteFileTool, listDirectoryTool, searchFilesTool } from "./filesystem";
import { runCommand } from "./terminal";
import * as git from "./git";
import { classifyCommand, FS_TOOL_PERMISSIONS, GIT_TOOL_PERMISSIONS, SEARCH_TOOL_PERMISSIONS, PermissionLevel, requiresApproval } from "./permissions";
import { activeSearchProvider } from "./search";
import { createApproval, getApproval, timeoutApproval } from "../db/approvals";
import { logToolCall } from "../db/toolCalls";
import { recordCheckpoint, nextCheckpointLabel } from "../db/checkpoints";
import { isAllowlisted } from "../db/allowlist";
import { getSetting } from "../runtimeConfig";
import { redactSecrets } from "../crypto/encryption";
import { log } from "../logger";

export interface ToolContext {
  workspaceRoot: string;
  taskId?: string;
  projectId?: string;
  role?: string;
  send?: (event: string, data: unknown) => void;
  isCancelled?: () => boolean;
}

export interface ToolExecutionResult {
  ok: boolean;
  denied?: boolean;
  blocked?: boolean;
  result?: unknown;
  error?: string;
}

const FS_MUTATING_TOOLS = new Set(["write_file", "edit_file", "create_file", "delete_file"]);

export const ALL_TOOL_NAMES = [
  "read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file", "delete_file",
  "run_command", "web_search", "git_status", "git_diff", "git_log", "git_add", "git_commit", "git_branch", "git_checkout",
] as const;
export type ToolName = (typeof ALL_TOOL_NAMES)[number];

/** Tools made available to each worker role (spec sections 26/39). */
export const ROLE_TOOLS: Record<string, ToolName[]> = {
  coder: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file", "delete_file", "run_command", "git_status", "git_diff", "git_add", "git_commit"],
  tester: ["read_file", "list_directory", "search_files", "run_command", "git_status", "git_diff"],
  debugger: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "run_command", "git_status", "git_diff", "git_log"],
  reviewer: ["read_file", "list_directory", "search_files", "git_status", "git_diff", "git_log"],
  security_reviewer: ["read_file", "list_directory", "search_files", "git_status", "git_diff"],
  ui_designer: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file"],
  documentation: ["read_file", "list_directory", "search_files", "write_file", "create_file", "edit_file"],
  researcher: ["read_file", "list_directory", "search_files", "web_search"],
  devops: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file", "run_command", "git_status", "git_diff", "git_add", "git_commit"],
  database: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file"],
  api_designer: ["read_file", "list_directory", "search_files", "write_file", "edit_file", "create_file"],
  performance_optimizer: ["read_file", "list_directory", "search_files", "run_command"],
  accessibility_reviewer: ["read_file", "list_directory", "search_files"],
  localization: ["read_file", "list_directory", "search_files", "write_file", "edit_file"],
  planner: [],
  manager: ["read_file", "list_directory", "search_files", "git_status", "git_log"],
};

export function permissionLevelFor(toolName: string, args: any, workspaceRoot?: string): PermissionLevel {
  if (toolName === "run_command") {
    const c = classifyCommand(args?.command || "", workspaceRoot);
    return c.level === "BLOCKED" ? "DANGEROUS" : c.level;
  }
  if (toolName in FS_TOOL_PERMISSIONS) return FS_TOOL_PERMISSIONS[toolName];
  if (toolName in GIT_TOOL_PERMISSIONS) return GIT_TOOL_PERMISSIONS[toolName];
  if (toolName in SEARCH_TOOL_PERMISSIONS) return SEARCH_TOOL_PERMISSIONS[toolName];
  return "SENSITIVE"; // unknown tool - fail closed
}

/** Key used for "Always allow for this project" (spec section 25): per tool, and per command prefix for shell commands. */
export function allowKeyFor(toolName: string, args: any): string {
  if (toolName === "run_command") return `run_command:${String(args?.command || "").trim().split(/\s+/).slice(0, 2).join(" ")}`;
  return toolName;
}

function briefOf(toolName: string, args: any): string {
  if (toolName === "run_command") return `$ ${args?.command ?? ""}`;
  if (toolName === "web_search") return `search: ${args?.query ?? ""}`;
  if (args?.path) return `${toolName} ${args.path}`;
  if (toolName === "git_commit") return `git commit: ${args?.message ?? ""}`;
  return toolName;
}

const clip = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + "\n…[truncated]" : s);

/**
 * Executes one tool call on behalf of a worker: classify → (if needed) human approval → run → log → checkpoint.
 * Never throws; always returns a result the caller can feed back to the model.
 */
export async function executeTool(toolName: string, args: any, ctx: ToolContext): Promise<ToolExecutionResult> {
  args = args && typeof args === "object" ? args : {};
  const level = permissionLevelFor(toolName, args, ctx.workspaceRoot);
  const start = Date.now();
  const base = { taskId: ctx.taskId, role: ctx.role, toolName, level, brief: briefOf(toolName, args), command: toolName === "run_command" ? args.command : undefined };

  if (toolName === "run_command") {
    const c = classifyCommand(args.command || "", ctx.workspaceRoot);
    if (c.level === "BLOCKED") {
      logToolCall({ taskId: ctx.taskId, projectId: ctx.projectId, toolName, permissionLevel: "DANGEROUS", args, result: { error: c.reason }, status: "blocked" });
      ctx.send?.("tool_completed", { ...base, ok: false, blocked: true, error: c.reason, exitCode: null });
      return { ok: false, blocked: true, error: `Command blocked and was not executed: ${c.reason}` };
    }
  }

  const alwaysAllowed = level === "SENSITIVE" && isAllowlisted(ctx.projectId, allowKeyFor(toolName, args));
  const needsApproval = requiresApproval(level) && !alwaysAllowed && (level === "DANGEROUS" || getSetting<boolean>("require_approval"));
  if (needsApproval) {
    const approval = createApproval({ taskId: ctx.taskId, projectId: ctx.projectId, toolName, permissionLevel: level, args: JSON.parse(redactSecrets(JSON.stringify(args))) });
    ctx.send?.("approval_required", { approvalId: approval.id, toolName, level, args, brief: base.brief, taskId: ctx.taskId, role: ctx.role });
    const decision = await waitForApprovalDecision(approval.id, Number(getSetting("approval_timeout_ms")), ctx.isCancelled);
    ctx.send?.("approval_resolved", { approvalId: approval.id, toolName, decision, taskId: ctx.taskId, role: ctx.role });
    if (decision !== "approved") {
      logToolCall({ taskId: ctx.taskId, projectId: ctx.projectId, toolName, permissionLevel: level, args, result: { decision }, status: "denied" });
      return { ok: false, denied: true, error: `Action was ${decision.replace("_", " ")} and was not performed.` };
    }
  }

  ctx.send?.("tool_started", base);
  try {
    const result = await runTool(toolName, args, ctx);
    const durationMs = Date.now() - start;
    const r: any = result;
    logToolCall({ taskId: ctx.taskId, projectId: ctx.projectId, toolName, permissionLevel: level, args, result, exitCode: r?.exitCode ?? null, durationMs, status: "ok" });
    ctx.send?.("tool_completed", {
      ...base, ok: true, exitCode: r?.exitCode ?? 0, durationMs,
      stdout: r?.stdout ? clip(redactSecrets(String(r.stdout))) : undefined,
      stderr: r?.stderr ? clip(redactSecrets(String(r.stderr))) : undefined,
    });

    if (FS_MUTATING_TOOLS.has(toolName) && ctx.projectId) {
      try {
        const label = nextCheckpointLabel(ctx.projectId);
        const { hash } = await git.createCheckpoint(ctx.workspaceRoot, `${label}: after ${toolName}`);
        recordCheckpoint({ projectId: ctx.projectId, taskId: ctx.taskId, label, commitHash: hash, message: `after ${toolName} ${args.path ?? ""}` });
        ctx.send?.("checkpoint_created", { label, toolName, hash, taskId: ctx.taskId });
      } catch (e) {
        log("warn", "checkpoint_failed", { error: (e as Error).message });
      }
    }
    return { ok: true, result };
  } catch (err) {
    const message = (err as Error).message;
    logToolCall({ taskId: ctx.taskId, projectId: ctx.projectId, toolName, permissionLevel: level, args, result: { error: message }, durationMs: Date.now() - start, status: "error" });
    ctx.send?.("tool_completed", { ...base, ok: false, error: message, exitCode: 1, durationMs: Date.now() - start });
    return { ok: false, error: message };
  }
}

async function runTool(toolName: string, args: any, ctx: ToolContext): Promise<unknown> {
  const ws = ctx.workspaceRoot;
  switch (toolName as ToolName) {
    case "read_file": return { content: readFileTool(ws, String(args.path)) };
    case "list_directory": return { entries: listDirectoryTool(ws, String(args.path || ".")) };
    case "search_files": return { matches: searchFilesTool(ws, String(args.query)) };
    case "write_file": writeFileTool(ws, String(args.path), String(args.content ?? "")); return { written: args.path };
    case "create_file": createFileTool(ws, String(args.path), String(args.content ?? "")); return { created: args.path };
    case "edit_file": return editFileTool(ws, String(args.path), String(args.find), String(args.replace ?? ""), !!args.replaceAll);
    case "delete_file": deleteFileTool(ws, String(args.path)); return { deleted: args.path };
    case "run_command": return await runCommand(ws, String(args.command), Number(getSetting("command_timeout_ms")));
    case "web_search": {
      const provider = activeSearchProvider();
      if (!provider) throw new Error("No search provider is configured. An admin can set one in Settings → Research.");
      return { results: await provider.search(String(args.query), Math.min(10, Number(args.limit) || 5)) };
    }
    case "git_status": return { output: await git.gitStatus(ws) };
    case "git_diff": return { output: await git.gitDiff(ws) };
    case "git_log": return { output: await git.gitLog(ws, Number(args?.limit) || 20) };
    case "git_add": return { output: await git.gitAdd(ws, args?.pathspec && /^[\w./*-]+$/.test(args.pathspec) ? args.pathspec : ".") };
    case "git_commit": return await git.gitCommit(ws, String(args.message || "commit"));
    case "git_branch": return { output: await git.gitBranch(ws, args?.name) };
    case "git_checkout": return { output: await git.gitCheckout(ws, String(args.ref)) };
    default: throw new Error(`Unknown tool: ${toolName}`);
  }
}

/** Polls the approvals table until a decision is made, the wait times out, or the run is cancelled. */
async function waitForApprovalDecision(approvalId: string, timeoutMs: number, isCancelled?: () => boolean): Promise<"approved" | "denied" | "timed_out"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled?.()) { timeoutApproval(approvalId); return "denied"; }
    const row = getApproval(approvalId);
    if (!row) return "denied";
    if (row.status === "approved") return "approved";
    if (row.status === "denied") return "denied";
    if (row.status === "timed_out") return "timed_out";
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  timeoutApproval(approvalId);
  return "timed_out";
}
