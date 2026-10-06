import { Router } from "express";
import { db } from "../db";

export const activityRouter = Router();

activityRouter.get("/usage/summary", (_req, res) => {
  const byProvider = db.prepare(
    `SELECT u.provider_id, p.name AS provider_name, COUNT(*) AS requests, SUM(u.input_tokens) AS input_tokens,
            SUM(u.output_tokens) AS output_tokens, SUM(u.estimated_cost) AS estimated_cost, AVG(u.latency_ms) AS avg_latency_ms,
            SUM(CASE WHEN u.status != 'ok' THEN 1 ELSE 0 END) AS errors
     FROM usage_events u LEFT JOIN providers p ON p.id = u.provider_id
     WHERE u.created_at >= datetime('now', '-30 days') GROUP BY u.provider_id ORDER BY requests DESC`
  ).all();
  const byAgent = db.prepare(
    `SELECT agent, COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens FROM usage_events
     WHERE created_at >= datetime('now', '-7 days') AND agent IS NOT NULL GROUP BY agent ORDER BY requests DESC`
  ).all();
  const byProject = db.prepare(
    `SELECT u.project_id, pr.name AS project_name, COUNT(*) AS requests, SUM(u.estimated_cost) AS cost
     FROM usage_events u LEFT JOIN projects pr ON pr.id = u.project_id
     WHERE u.project_id IS NOT NULL AND u.created_at >= datetime('now', '-30 days') GROUP BY u.project_id ORDER BY requests DESC`
  ).all();
  const daily = db.prepare(
    `SELECT date(created_at) AS day, COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens, SUM(estimated_cost) AS cost
     FROM usage_events WHERE created_at >= datetime('now', '-14 days') GROUP BY day ORDER BY day ASC`
  ).all();
  const today = db.prepare(`SELECT COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(estimated_cost) AS cost FROM usage_events WHERE date(created_at) = date('now')`).get();
  const week = db.prepare(`SELECT COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens, SUM(estimated_cost) AS cost FROM usage_events WHERE created_at >= datetime('now', '-7 days')`).get();
  const month = db.prepare(`SELECT COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens, SUM(estimated_cost) AS cost FROM usage_events WHERE created_at >= datetime('now', 'start of month')`).get();
  res.json({ today, week, month, byProvider, byAgent, byProject, daily });
});

activityRouter.get("/events", (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json(db.prepare(`SELECT u.*, p.name AS provider_name FROM usage_events u LEFT JOIN providers p ON p.id = u.provider_id ORDER BY u.created_at DESC, u.rowid DESC LIMIT ?`).all(limit));
});

activityRouter.get("/audit-log", (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json(db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit));
});

activityRouter.get("/system", (_req, res) => {
  const mem = process.memoryUsage();
  const counts = db.prepare(
    `SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM chats) AS chats,
            (SELECT COUNT(*) FROM providers WHERE enabled = 1) AS enabled_providers,
            (SELECT COUNT(*) FROM tasks WHERE status IN ('RUNNING','RETRYING')) AS active_tasks,
            (SELECT COUNT(*) FROM approvals WHERE status = 'pending') AS pending_approvals`
  ).get();
  res.json({ uptimeSeconds: process.uptime(), rssMb: Math.round(mem.rss / 1024 / 1024), heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024), ...counts });
});
