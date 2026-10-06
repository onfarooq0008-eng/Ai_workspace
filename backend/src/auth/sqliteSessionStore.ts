import { Store } from "express-session";
import { db } from "../db";

/**
 * Minimal express-session Store backed by the same SQLite database as
 * everything else - avoids pulling in Redis (spec section 56: avoid Redis
 * unless absolutely necessary) just to persist sessions across restarts.
 */
export class SqliteSessionStore extends Store {
  constructor() {
    super();
    // Opportunistically clear expired sessions on boot and periodically.
    this.clearExpired();
    setInterval(() => this.clearExpired(), 60 * 60 * 1000).unref();
  }

  private clearExpired() {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  }

  get(sid: string, callback: (err: any, session?: any) => void): void {
    try {
      const row = db
        .prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at >= datetime('now')")
        .get(sid) as { data: string } | undefined;
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.data));
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, session: any, callback?: (err?: any) => void): void {
    try {
      const maxAgeMs = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 7;
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
      db.prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      ).run(sid, JSON.stringify(session), expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, session: any, callback?: () => void): void {
    try {
      const maxAgeMs = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 7;
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
      db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
      callback?.();
    } catch {
      callback?.();
    }
  }
}
