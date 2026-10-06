import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as crypto from "crypto";
import { verifyLogin } from "../auth/auth";
import { db } from "../db";
import { nanoid } from "nanoid";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const user = await verifyLogin(username, password);
  if (!user) {
    db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'login_failed', ?, ?)").run(
      `audit_${nanoid(10)}`,
      username,
      JSON.stringify({ ip: req.ip })
    );
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'login_success', ?, ?)").run(
    `audit_${nanoid(10)}`,
    user.username,
    JSON.stringify({ ip: req.ip })
  );
  res.json({ id: user.id, username: user.username });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

/** Issues/returns this session's CSRF token - call once after login, send back as X-CSRF-Token on writes. */
authRouter.get("/csrf", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  res.json({ csrfToken: req.session.csrfToken });
});

authRouter.get("/me", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ id: req.session.userId, username: req.session.username });
});
