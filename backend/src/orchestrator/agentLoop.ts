import { buildWorkerSystemPrompt } from "./prompts";
import { callModelForRole } from "./callModel";
import { parseWorkerJson, WorkerJsonOutput } from "./jsonParsing";
import { executeTool, ROLE_TOOLS, ToolContext } from "../tools/dispatcher";
import { getRoleConfig } from "../db/roleConfigs";
import { getSetting } from "../runtimeConfig";
import { CancelledError } from "./cancel";

export interface AgentLoopResult {
  final: WorkerJsonOutput;
  providerId?: string;
  iterations: number;
}

export interface AgentLoopOptions {
  overrideProviderId?: string;
  onIteration?: (info: { iteration: number; output: WorkerJsonOutput }) => void;
  onTool?: (info: { tool: string; args: any; ok: boolean; error?: string; result?: any }) => void;
}

const clipJson = (v: unknown, n = 12000) => {
  const s = JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + `…[truncated ${s.length - n} chars]` : s;
};

/**
 * Runs one worker to completion, including tool use. Each iteration: call the model → parse its JSON → execute any
 * requested tool_calls for real → append the results as the next user turn → repeat. Stops when the worker reports
 * completed/failed with nothing left to run, or after max_tool_iterations turns (spec section 35: recursion depth).
 */
export async function runAgentLoop(
  role: string,
  taskPayload: unknown,
  toolCtx: ToolContext,
  callCtx: { projectId?: string; chatId?: string; taskId?: string },
  opts: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
  const availableTools = ROLE_TOOLS[role] || [];
  const cfg = getRoleConfig(role);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildWorkerSystemPrompt(role, availableTools, cfg.extra_instructions) },
    { role: "user", content: JSON.stringify(taskPayload) },
  ];

  let lastProviderId: string | undefined;
  let ranCommand = false;
  const maxIterations = Number(getSetting("max_tool_iterations")) || 8;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (toolCtx.isCancelled?.()) throw new CancelledError();
    const result = await callModelForRole(role, messages, { ...callCtx, agent: role }, opts.overrideProviderId);
    lastProviderId = result.providerId;
    const parsed = parseWorkerJson(result.content);
    opts.onIteration?.({ iteration, output: parsed });

    const wantsTools = availableTools.length > 0 && parsed.tool_calls.length > 0 && parsed.status !== "failed";
    if (!wantsTools) {
      const final: WorkerJsonOutput = { ...parsed, status: parsed.status === "in_progress" ? "completed" : parsed.status, tool_calls: [] };
      if (role === "tester" && final.status === "completed" && !ranCommand && availableTools.includes("run_command")) {
        final.errors = [...final.errors, "No command was actually executed to verify this result."];
        final.summary += " (Note: no test/build command was executed, so this is unverified.)";
      }
      return { final, providerId: lastProviderId, iterations: iteration };
    }

    messages.push({ role: "assistant", content: result.content });
    const toolResults: unknown[] = [];
    for (const call of parsed.tool_calls.slice(0, 6)) {
      if (toolCtx.isCancelled?.()) throw new CancelledError();
      if (!availableTools.includes(call.tool as any)) {
        const error = `Tool "${call.tool}" is not available to the ${role} role.`;
        toolResults.push({ tool: call.tool, args: call.args, result: { ok: false, error } });
        opts.onTool?.({ tool: call.tool, args: call.args, ok: false, error });
        continue;
      }
      const outcome = await executeTool(call.tool, call.args, toolCtx);
      if (call.tool === "run_command" && outcome.ok) ranCommand = true;
      toolResults.push({ tool: call.tool, args: call.args, result: outcome });
      opts.onTool?.({ tool: call.tool, args: call.args, ok: outcome.ok, error: outcome.error, result: outcome.result });
    }
    messages.push({
      role: "user",
      content: `${clipJson({ tool_results: toolResults })}\nThese are the real results of the tool calls you requested. Continue: issue more tool_calls if needed, or finish with status "completed"/"failed" and an empty tool_calls array.`,
    });
  }

  return {
    final: {
      status: "failed",
      summary: `Worker did not reach a final answer within ${maxIterations} tool-use iterations.`,
      files_changed: [],
      errors: [`Exceeded the maximum tool-use steps per task (${maxIterations})`],
      next_steps: [],
      tool_calls: [],
    },
    providerId: lastProviderId,
    iterations: maxIterations,
  };
}
