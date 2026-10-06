import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { addMessage, createChat, deleteChat, clearChatMessages, getChat, listChats, listMessages, updateChat } from "../db/chats";
import { latestPlanId } from "../db/tasks";
import { listProviders, getProviderCredentials } from "../providers/store";
import { getAdapter } from "../providers/registry";
import { MANAGER_SYSTEM_PROMPT } from "../orchestrator/prompts";
import { buildChatMessages } from "../orchestrator/context";
import { startTeamRun, startResume, isRunActive } from "../orchestrator/teamRunner";
import { requestCancel } from "../orchestrator/cancel";
import { eventBus } from "../orchestrator/eventBus";
import { estimateTokens } from "../providers/types";
import { recordUsage } from "../db/chats";
import { redactSecrets } from "../crypto/encryption";
import { providerWithinLimits, globalBudgetStatus } from "../orchestrator/limits";

export const chatRouter = Router();
const TEAM_MODES = new Set(["team", "developer", "research", "autonomous"]);

chatRouter.post("/", (req, res) => {
  const parsed = z.object({ projectId: z.string().optional(), title: z.string().optional(), mode: z.enum(["chat", "agent", "team", "developer", "research", "autonomous"]).optional(), managerProviderId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  res.status(201).json(createChat(parsed.data));
});

chatRouter.get("/", (req, res) => {
  res.json(listChats({ projectId: req.query.projectId as string | undefined, q: req.query.q as string | undefined }));
});

chatRouter.get("/:id", (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json({ ...chat, running: isRunActive(req.params.id) });
});

chatRouter.patch("/:id", (req, res) => {
  const updated = updateChat(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Chat not found" });
  res.json(updated);
});

chatRouter.delete("/:id", (req, res) => {
  if (!deleteChat(req.params.id)) return res.status(404).json({ error: "Chat not found" });
  res.json({ ok: true });
});

chatRouter.post("/:id/clear", (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  clearChatMessages(req.params.id);
  res.json({ ok: true });
});

chatRouter.get("/:id/messages", (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json(listMessages(req.params.id));
});

chatRouter.get("/:id/export", (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const msgs = listMessages(req.params.id) as any[];
  const text = msgs.map((m) => `## ${m.role}${m.agent_name ? ` (${m.agent_name})` : ""} — ${m.created_at}\n\n${m.content}\n`).join("\n");
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="${(chat as any).title.replace(/[^a-z0-9-_]+/gi, "_")}.md"`);
  res.send(`# ${(chat as any).title}\n\n${text}`);
});

/** Stop a running team task. The in-flight task finishes its current step, then every task still pending is cancelled. */
chatRouter.post("/:id/stop", (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  requestCancel(req.params.id);
  res.json({ ok: true, wasRunning: isRunActive(req.params.id) });
});

/** Resume the most recent plan: re-queues FAILED/CANCELLED/interrupted tasks and continues (spec section 14: task resumption). */
chatRouter.post("/:id/resume", (req, res) => {
  const chat = getChat(req.params.id) as any;
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const planId = latestPlanId(req.params.id);
  if (!planId) return res.status(409).json({ error: "This chat has no previous plan to resume." });
  const r = startResume(chat, planId, { workerProviderId: req.body?.workerProviderId });
  if (!r.started) return res.status(409).json({ error: r.reason });
  res.json({ ok: true, planId });
});

const sendMessageSchema = z.object({ content: z.string().min(1).max(20000), providerId: z.string().optional(), workerProviderId: z.string().optional() });

/**
 * Non-streaming send: starts the work (team run in the background, or a plain reply) and returns immediately.
 * The caller follows progress via GET /api/events/stream, which works across tabs/devices and survives a refresh -
 * unlike a single-request SSE stream tied to this POST.
 */
chatRouter.post("/:id/messages", async (req, res) => {
  const chat = getChat(req.params.id) as any;
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const { content, providerId, workerProviderId } = parsed.data;

  if (isRunActive(chat.id)) return res.status(409).json({ error: "This chat already has a run in progress. Stop it first or wait for it to finish." });

  addMessage({ chatId: chat.id, role: "user", content });
  eventBus.publish("user_message", { chatId: chat.id, content });

  if (TEAM_MODES.has(chat.mode)) {
    const r = startTeamRun(chat, content, { workerProviderId });
    if (!r.started) return res.status(409).json({ error: r.reason });
    return res.status(202).json({ started: true, mode: chat.mode });
  }

  const budget = globalBudgetStatus();
  if (!budget.ok) return res.status(429).json({ error: budget.reason });

  // Plain Chat/Agent mode: reply inline and return it directly (still emitted on the event bus too).
  const candidates = listProviders().filter((p) => p.enabled);
  if (candidates.length === 0) return res.status(409).json({ error: "No enabled AI provider is configured. Add one in API Providers first." });

  const messages = await buildChatMessages(chat, MANAGER_SYSTEM_PROMPT);
  const ordered = providerId ? [providerId, ...candidates.filter((p) => p.id !== providerId).map((p) => p.id)] : [chat.manager_provider_id, ...candidates.map((p) => p.id)].filter(Boolean) as string[];
  const tried = new Set<string>();
  let lastError = "";
  for (const candidateId of ordered) {
    if (tried.has(candidateId)) continue;
    tried.add(candidateId);
    const limit = providerWithinLimits(candidateId);
    if (!limit.ok) { lastError = limit.reason || "limit reached"; continue; }
    const creds = getProviderCredentials(candidateId);
    if (!creds) continue;
    const requestId = `req_${nanoid(16)}`;
    const start = Date.now();
    try {
      const adapter = getAdapter(creds.providerType);
      let full = "";
      const result = await adapter.stream({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, model: creds.model }, { messages, temperature: creds.temperature, maxTokens: creds.maxTokens, stream: true }, (tok) => {
        full += tok;
        eventBus.publish("token", { chatId: chat.id, text: tok });
      });
      const finalContent = redactSecrets(result.content || full);
      const inputTokens = result.inputTokens ?? estimateTokens(messages.map((m) => m.content).join("\n"));
      const outputTokens = result.outputTokens ?? estimateTokens(finalContent);
      addMessage({ chatId: chat.id, role: "assistant", agentName: "manager", content: finalContent, providerId: candidateId, inputTokens, outputTokens, requestId });
      recordUsage({ requestId, providerId: candidateId, projectId: chat.project_id, chatId: chat.id, model: creds.model, inputTokens, outputTokens, latencyMs: Date.now() - start, status: "ok", agent: "manager" });
      eventBus.publish("assistant_message", { chatId: chat.id, content: finalContent, providerId: candidateId });
      return res.json({ started: false, content: finalContent, providerId: candidateId, requestId });
    } catch (err) {
      lastError = (err as Error).message;
      recordUsage({ requestId, providerId: candidateId, projectId: chat.project_id, chatId: chat.id, model: creds.model, latencyMs: Date.now() - start, status: "error", agent: "manager" });
      eventBus.publish("provider_error", { chatId: chat.id, providerId: candidateId, error: redactSecrets(lastError).slice(0, 300) });
    }
  }
  const message = `All configured providers failed. Last error: ${redactSecrets(lastError)}`;
  addMessage({ chatId: chat.id, role: "error", agentName: "manager", content: message });
  res.status(502).json({ error: message });
});
