export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface WorkerJsonOutput {
  status: "completed" | "failed" | "in_progress";
  summary: string;
  files_changed: string[];
  errors: string[];
  next_steps: string[];
  tool_calls: ToolCallRequest[];
}

/**
 * Workers are instructed to return structured JSON (spec section 22). Real
 * models sometimes wrap it in prose or markdown fences anyway, so this
 * parses defensively: strip fences, find the first {...} block, and fall
 * back to treating the whole response as a free-text summary rather than
 * crashing the task.
 */
export function parseWorkerJson(raw: string): WorkerJsonOutput {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      const status = parsed.status === "failed" || parsed.status === "in_progress" ? parsed.status : "completed";
      const toolCalls: ToolCallRequest[] = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls
            .filter((t: any) => t && typeof t.tool === "string")
            .map((t: any) => ({ tool: t.tool, args: typeof t.args === "object" && t.args !== null ? t.args : {} }))
        : [];
      return {
        status,
        summary: String(parsed.summary ?? ""),
        files_changed: Array.isArray(parsed.files_changed) ? parsed.files_changed : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps : [],
        tool_calls: toolCalls,
      };
    } catch {
      // fall through to plain-text fallback below
    }
  }

  return {
    status: "completed",
    summary: text,
    files_changed: [],
    errors: [],
    next_steps: [],
    tool_calls: [],
  };
}

export interface PlannerTaskJson {
  id: string;
  title: string;
  description: string;
  role: string;
  depends_on: string[];
}

/**
 * Single source of truth for every worker role in the system. Adding a role
 * to this list is enough for it to show up in the planner's allowed roles,
 * the Agents config page, and provider role assignment - every other module
 * (prompts, tool permissions, model-selection capability hints) keys off
 * these same strings.
 */
export const ALL_WORKER_ROLES = [
  "coder",
  "researcher",
  "reviewer",
  "tester",
  "security_reviewer",
  "ui_designer",
  "documentation",
  "debugger",
  "devops",
  "database",
  "api_designer",
  "performance_optimizer",
  "accessibility_reviewer",
  "localization",
] as const;
export type WorkerRole = (typeof ALL_WORKER_ROLES)[number];

const VALID_ROLES = new Set<string>(["planner", ...ALL_WORKER_ROLES]);

export function parsePlannerJson(raw: string): PlannerTaskJson[] {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Planner did not return a JSON object");
  }
  const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("Planner JSON did not contain a non-empty 'tasks' array");
  }
  const seen = new Set<string>();
  return parsed.tasks.map((t: any, idx: number) => {
    const id = String(t.id || `t${idx + 1}`);
    if (seen.has(id)) throw new Error(`Planner produced duplicate task id "${id}"`);
    seen.add(id);
    const role = VALID_ROLES.has(t.role) ? t.role : "coder";
    return {
      id,
      title: String(t.title || "Untitled task"),
      description: String(t.description || ""),
      role,
      depends_on: Array.isArray(t.depends_on) ? t.depends_on.map(String) : [],
    };
  });
}
