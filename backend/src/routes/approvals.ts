import { Router } from "express";
import { db } from "../db";
import { decideApproval, getApproval, listPendingApprovals } from "../db/approvals";
import { addAllowlist, listAllowlist, removeAllowlist } from "../db/allowlist";
import { allowKeyFor } from "../tools/dispatcher";
import { actorOf } from "../auth/auth";
import { eventBus } from "../orchestrator/eventBus";

export const approvalsRouter = Router();

approvalsRouter.get("/", (_req, res) => {
  res.json(listPendingApprovals());
});

approvalsRouter.get("/history", (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json(db.prepare("SELECT * FROM approvals WHERE status != 'pending' ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit));
});

approvalsRouter.get("/allowlist/:projectId", (req, res) => {
  res.json(listAllowlist(req.params.projectId));
});

approvalsRouter.delete("/allowlist/:projectId", (req, res) => {
  const key = String(req.query.key || "");
  if (!key) return res.status(400).json({ error: "?key= is required" });
  removeAllowlist(req.params.projectId, key);
  res.json({ ok: true });
});

approvalsRouter.post("/:id/decide", (req, res) => {
  const { approve, always } = req.body || {};
  if (typeof approve !== "boolean") return res.status(400).json({ error: "Body must include { approve: boolean }" });
  const existing = getApproval(req.params.id);
  if (!existing) return res.status(404).json({ error: "Approval not found" });
  if (existing.status !== "pending") return res.status(409).json({ error: `Approval already resolved: ${existing.status}` });
  const updated = decideApproval(req.params.id, approve, actorOf(req));
  if (approve && always && existing.permission_level === "SENSITIVE" && existing.project_id) {
    let args: any = {};
    try { args = JSON.parse(existing.args || "{}"); } catch { /* ignore */ }
    addAllowlist(existing.project_id, allowKeyFor(existing.tool_name, args));
  }
  eventBus.publish("approval_decided", { approvalId: existing.id, approved: approve, taskId: existing.task_id, toolName: existing.tool_name });
  res.json(updated);
});
