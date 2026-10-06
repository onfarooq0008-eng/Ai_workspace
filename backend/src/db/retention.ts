import { db } from "./index";
import { getSetting } from "../runtimeConfig";

/** Deletes old usage/tool-call/audit rows per Settings → Log retention. */
export function runRetention(): { days: number; usage: number; toolCalls: number; audit: number } {
  const days = Math.max(1, Number(getSetting("log_retention_days")) || 90);
  const cutoff = `-${Math.floor(days)} days`;
  const usage = db.prepare("DELETE FROM usage_events WHERE created_at < datetime('now', ?)").run(cutoff).changes;
  const toolCalls = db.prepare("DELETE FROM tool_calls WHERE created_at < datetime('now', ?)").run(cutoff).changes;
  const audit = db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?)").run(cutoff).changes;
  return { days, usage, toolCalls, audit };
}
