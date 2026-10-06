import { Router } from "express";
import * as crypto from "crypto";
import { nanoid } from "nanoid";
import { db } from "../db";
import { hashToken, actorOf } from "../auth/auth";

export const tokensRouter = Router();

tokensRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC").all());
});

/** Creates an API access token (spec section 34). The raw token is returned exactly once and never stored. */
tokensRouter.post("/", (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80) || "API token";
  const raw = `aap_${crypto.randomBytes(24).toString("hex")}`;
  const id = `tok_${nanoid(10)}`;
  db.prepare("INSERT INTO api_tokens (id, name, token_hash) VALUES (?, ?, ?)").run(id, name, hashToken(raw));
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'api_token_created', ?, ?)").run(`audit_${nanoid(10)}`, actorOf(req), JSON.stringify({ id, name }));
  res.status(201).json({ id, name, token: raw });
});

tokensRouter.delete("/:id", (req, res) => {
  const r = db.prepare("DELETE FROM api_tokens WHERE id = ?").run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
