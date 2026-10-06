import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { db } from "../db";
import { config } from "../config";
import { verifyLogin, changePassword, actorOf } from "../auth/auth";
import { runRetention } from "../db/retention";

export const adminRouter = Router();
const run = promisify(execFile);
const backupDir = path.join(path.dirname(path.resolve(config.databasePath)), "backups");

adminRouter.post("/password", async (req, res) => {
  const { current, next } = req.body || {};
  if (!req.session?.userId) return res.status(400).json({ error: "Password changes require a logged-in session." });
  if (typeof next !== "string" || next.length < 10) return res.status(400).json({ error: "New password must be at least 10 characters." });
  const user = await verifyLogin(req.session.username || "", String(current || ""));
  if (!user) return res.status(403).json({ error: "Current password is incorrect." });
  await changePassword(user.id, next);
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'password_changed', ?, '{}')").run(`audit_${nanoid(10)}`, actorOf(req));
  res.json({ ok: true });
});

adminRouter.get("/backups", (_req, res) => {
  res.json(db.prepare("SELECT * FROM backups ORDER BY created_at DESC, rowid DESC LIMIT 50").all());
});

/** Consistent DB snapshot + project workspaces. API keys are blanked unless includeKeys is explicitly requested. .env is never included. */
adminRouter.post("/backups", async (req, res) => {
  const includeKeys = !!req.body?.includeKeys;
  const id = `bkp_${nanoid(8)}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmp = fs.mkdtempSync(path.join(path.dirname(backupDir), "bk-"));
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    await db.backup(path.join(tmp, "app.db"));
    const copy = new Database(path.join(tmp, "app.db"));
    copy.exec("DELETE FROM sessions; DELETE FROM api_tokens;");
    if (!includeKeys) copy.exec("UPDATE providers SET api_key_encrypted = '';");
    copy.close();
    try { await run("zip", ["-r", "-q", path.join(tmp, "projects.zip"), ".", "-x", "*/node_modules/*"], { cwd: config.workspaceDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }); } catch { /* empty workspaces dir */ }
    const filename = `backup-${stamp}.zip`;
    await run("zip", ["-r", "-q", path.join(backupDir, filename), "."], { cwd: tmp, timeout: 120_000 });
    const size = fs.statSync(path.join(backupDir, filename)).size;
    db.prepare("INSERT INTO backups (id, filename, size_bytes, include_keys) VALUES (?, ?, ?, ?)").run(id, filename, size, includeKeys ? 1 : 0);
    db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'backup_created', ?, ?)").run(`audit_${nanoid(10)}`, actorOf(req), JSON.stringify({ filename, includeKeys }));
    res.status(201).json({ id, filename, size_bytes: size, include_keys: includeKeys });
  } catch (err) {
    res.status(500).json({ error: `Backup failed (is 'zip' installed?): ${(err as Error).message}` });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

adminRouter.get("/backups/:id/download", (req, res) => {
  const row = db.prepare("SELECT * FROM backups WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "Backup not found" });
  const file = path.join(backupDir, path.basename(row.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Backup file is missing on disk" });
  res.download(file, row.filename);
});

adminRouter.post("/maintenance/retention", (_req, res) => res.json(runRetention()));
