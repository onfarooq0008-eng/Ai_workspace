import bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { nanoid } from "nanoid";
import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { config } from "../config";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

const SALT_ROUNDS = 12;

export function userCount(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
}

export async function createUser(username: string, password: string): Promise<UserRow> {
  const id = `user_${nanoid(10)}`;
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(id, username, hash);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

export async function verifyLogin(username: string, password: string): Promise<UserRow | null> {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  if (!user) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva"); // keep timing similar
    return null;
  }
  return (await bcrypt.compare(password, user.password_hash)) ? user : null;
}

export async function changePassword(userId: string, newPassword: string) {
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
}

/**
 * On first run, if no users exist and INITIAL_ADMIN_PASSWORD is set, create the first admin account. The server never
 * runs open: without a user nobody can log in (spec section 34).
 */
export async function bootstrapAdmin() {
  if (userCount() > 0) return;
  if (!config.initialAdminPassword) {
    console.warn("[auth] WARNING: No users exist and INITIAL_ADMIN_PASSWORD is not set. Set it in .env and restart.");
    return;
  }
  await createUser(config.initialAdminUsername, config.initialAdminPassword);
  console.log(`[auth] Created initial admin user "${config.initialAdminUsername}"`);
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    username?: string;
  }
}

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** Session cookie auth, or an optional API access token via `Authorization: Bearer <token>` (spec section 34). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId) return next();
  const header = req.get("authorization");
  if (header && header.startsWith("Bearer ")) {
    const row = db.prepare("SELECT id FROM api_tokens WHERE token_hash = ?").get(hashToken(header.slice(7).trim())) as { id: string } | undefined;
    if (row) {
      (req as any).apiTokenAuth = true;
      db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
      return next();
    }
  }
  return res.status(401).json({ error: "Not authenticated" });
}

export const actorOf = (req: Request) => req.session?.username || ((req as any).apiTokenAuth ? "api-token" : "unknown");
