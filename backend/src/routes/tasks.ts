import { Router } from "express";
import { listTasksByChat, getDependencyIds, cancelTaskRow, retryTaskRow, getTask } from "../db/tasks";
import { listToolCallsForTask } from "../db/toolCalls";
import { getChat } from "../db/chats";
import { eventBus } from "../orchestrator/eventBus";

export const tasksRouter = Router();

function serialize(t: any) {
  return {
    id: t.id, plan_id: t.plan_id, title: t.title, description: t.description, role: t.role, status: t.status,
    attempts: t.attempts, max_attempts: t.max_attempts, sequence: t.sequence, depends_on: getDependencyIds(t.id),
    output: t.output ? JSON.parse(t.output) : null, errors: t.errors ? JSON.parse(t.errors) : [], updated_at: t.updated_at,
  };
}

tasksRouter.get("/chat/:chatId", (req, res) => {
  const chat = getChat(req.params.chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json(listTasksByChat(req.params.chatId).map(serialize));
});

tasksRouter.get("/:id", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json(serialize(t));
});

tasksRouter.get("/:id/tool-calls", (req, res) => {
  if (!getTask(req.params.id)) return res.status(404).json({ error: "Task not found" });
  res.json(listToolCallsForTask(req.params.id));
});

tasksRouter.post("/:id/cancel", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  cancelTaskRow(req.params.id);
  eventBus.publish("task_status", { taskId: t.id, planId: t.plan_id, title: t.title, role: t.role, status: "CANCELLED", chatId: t.chat_id, projectId: t.project_id });
  res.json(serialize(getTask(req.params.id)));
});

tasksRouter.post("/:id/retry", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  retryTaskRow(req.params.id);
  eventBus.publish("task_status", { taskId: t.id, planId: t.plan_id, title: t.title, role: t.role, status: "PENDING", chatId: t.chat_id, projectId: t.project_id });
  res.json(serialize(getTask(req.params.id)));
});
