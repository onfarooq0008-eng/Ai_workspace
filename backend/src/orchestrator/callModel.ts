import { nanoid } from "nanoid";
import { getProviderCredentials } from "../providers/store";
import { getAdapter } from "../providers/registry";
import { estimateTokens } from "../providers/types";
import { selectCandidateProviders } from "./modelSelection";
import { recordUsage } from "../db/chats";
import { getRoleConfig } from "../db/roleConfigs";
import { redactSecrets } from "../crypto/encryption";
import { providerWithinLimits, globalBudgetStatus } from "./limits";
import { eventBus } from "./eventBus";
import { log } from "../logger";

export {
  parseWorkerJson,
  parsePlannerJson,
  type WorkerJsonOutput,
  type ToolCallRequest,
  type PlannerTaskJson,
} from "./jsonParsing";

export interface CallResult {
  content: string;
  providerId: string;
  requestId: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CallContext {
  projectId?: string;
  chatId?: string;
  agent?: string;
  taskId?: string;
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

/**
 * Tries each candidate provider for a role in order until one succeeds (spec section 29: failover on timeout, 429,
 * server error, invalid response). Providers over their configured limits are skipped (spec section 32). Every
 * attempt gets a unique request ID that is used across logs, usage tracking, and events (spec section 73).
 */
export async function callModelForRole(role: string, messages: Msg[], ctx: CallContext, overrideProviderId?: string): Promise<CallResult> {
  const budget = globalBudgetStatus();
  if (!budget.ok) throw new Error(budget.reason);

  const candidates = selectCandidateProviders(role, overrideProviderId);
  if (candidates.length === 0) throw new Error(`No enabled provider available for role "${role}". Add and enable a provider first.`);

  const roleCfg = getRoleConfig(role);
  let lastError = "";
  let attempted = 0;
  const skipped: string[] = [];

  for (const candidate of candidates) {
    const limit = providerWithinLimits(candidate.id);
    if (!limit.ok) {
      skipped.push(`${candidate.name}: ${limit.reason}`);
      eventBus.publish("provider_fallback", { providerId: candidate.id, providerName: candidate.name, reason: limit.reason, role, chatId: ctx.chatId });
      continue;
    }
    const creds = getProviderCredentials(candidate.id);
    if (!creds) continue;
    attempted++;
    const requestId = `req_${nanoid(16)}`;
    const start = Date.now();
    try {
      const adapter = getAdapter(creds.providerType);
      const result = await adapter.chat(
        { baseUrl: creds.baseUrl, apiKey: creds.apiKey, model: creds.model },
        { messages, temperature: roleCfg.temperature ?? creds.temperature, maxTokens: roleCfg.max_tokens ?? creds.maxTokens }
      );
      if (!result.content || !result.content.trim()) throw new Error("Provider returned an empty response");
      const estimated = result.inputTokens == null || result.outputTokens == null;
      const inputTokens = result.inputTokens ?? estimateTokens(messages.map((m) => m.content).join("\n"));
      const outputTokens = result.outputTokens ?? estimateTokens(result.content);
      recordUsage({ requestId, providerId: candidate.id, projectId: ctx.projectId, chatId: ctx.chatId, model: creds.model, inputTokens, outputTokens, latencyMs: Date.now() - start, status: "ok", agent: ctx.agent ?? role, taskId: ctx.taskId, tokensEstimated: estimated });
      log("info", "model_call_ok", { request_id: requestId, provider: candidate.name, role, task_id: ctx.taskId, latency_ms: Date.now() - start });
      return { content: redactSecrets(result.content), providerId: candidate.id, requestId, inputTokens, outputTokens };
    } catch (err) {
      lastError = (err as Error).message;
      const status = /HTTP 429/.test(lastError) ? "rate_limited" : /abort|timeout|ETIMEDOUT/i.test(lastError) ? "timeout" : "error";
      recordUsage({ requestId, providerId: candidate.id, projectId: ctx.projectId, chatId: ctx.chatId, model: creds.model, latencyMs: Date.now() - start, status, agent: ctx.agent ?? role, taskId: ctx.taskId });
      log("warn", "model_call_failed", { request_id: requestId, provider: candidate.name, role, error: lastError.slice(0, 300) });
      eventBus.publish("provider_error", { providerId: candidate.id, providerName: candidate.name, error: redactSecrets(lastError).slice(0, 300), role, chatId: ctx.chatId, requestId });
    }
  }
  if (attempted === 0) throw new Error(`All candidate providers are at their configured limits (${skipped.join("; ")}).`);
  throw new Error(`All providers for role "${role}" failed. Last error: ${redactSecrets(lastError)}`);
}
