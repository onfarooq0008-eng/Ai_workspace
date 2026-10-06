import express from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import * as path from "path";
import { config } from "./config";
import "./db"; // runs migrations on import
import { bootstrapAdmin, requireAuth } from "./auth/auth";
import { csrfProtection } from "./auth/csrf";
import { SqliteSessionStore } from "./auth/sqliteSessionStore";
import { recoverOrphans } from "./db/tasks";
import { log } from "./logger";
import { authRouter } from "./routes/auth";
import { providersRouter } from "./routes/providers";
import { projectsRouter } from "./routes/projects";
import { chatRouter } from "./routes/chat";
import { activityRouter } from "./routes/activity";
import { tasksRouter } from "./routes/tasks";
import { approvalsRouter } from "./routes/approvals";
import { filesRouter } from "./routes/files";
import { gitRouter } from "./routes/git";
import { settingsRouter } from "./routes/settings";
import { agentsRouter } from "./routes/agents";
import { eventsRouter } from "./routes/events";
import { memoryRouter } from "./routes/memory";
import { tokensRouter } from "./routes/tokens";
import { adminRouter } from "./routes/admin";
import { runRetention } from "./db/retention";

async function main() {
  await bootstrapAdmin();
  const recovered = recoverOrphans();
  if (recovered) log("warn", "orphan_tasks_recovered", { count: recovered });

  runRetention();
  setInterval(() => { try { runRetention(); } catch { /* best effort */ } }, 24 * 60 * 60 * 1000).unref();

  const app = express();
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1)); // Nginx / Koyeb edge in front
  app.disable("x-powered-by");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());

  const sessionMiddleware = session({
    store: new SqliteSessionStore(),
    secret: config.sessionSecret,
    name: "aiagent.sid",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: config.nodeEnv === "production" && process.env.COOKIE_SECURE !== "false", sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  });
  app.use(sessionMiddleware);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // JSON body parsing for everything except raw-byte file uploads, which read the stream themselves.
  app.use((req, res, next) => (req.path.match(/\/api\/files\/[^/]+\/upload$/) ? next() : express.json({ limit: "2mb" })(req, res, next)));

  const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === "/api/events/stream" });
  app.use("/api", apiLimiter);

  app.use("/api/auth", authRouter);

  // Everything below requires an authenticated session (or Bearer API token) and CSRF on state-changing requests.
  app.use("/api/providers", requireAuth, csrfProtection, providersRouter);
  app.use("/api/projects", requireAuth, csrfProtection, projectsRouter);
  app.use("/api/chats", requireAuth, csrfProtection, chatRouter);
  app.use("/api/activity", requireAuth, activityRouter);
  app.use("/api/tasks", requireAuth, csrfProtection, tasksRouter);
  app.use("/api/approvals", requireAuth, csrfProtection, approvalsRouter);
  app.use("/api/files", requireAuth, csrfProtection, filesRouter);
  app.use("/api/git", requireAuth, csrfProtection, gitRouter);
  app.use("/api/settings", requireAuth, csrfProtection, settingsRouter);
  app.use("/api/agents", requireAuth, csrfProtection, agentsRouter);
  app.use("/api/events", requireAuth, eventsRouter);
  app.use("/api/memory", requireAuth, csrfProtection, memoryRouter);
  app.use("/api/tokens", requireAuth, csrfProtection, tokensRouter);
  app.use("/api/admin", requireAuth, csrfProtection, adminRouter);

  const frontendDir = path.resolve(__dirname, "../../frontend");
  app.use(express.static(frontendDir, { maxAge: "1h" }));
  app.get("*", (req, res, next) => (req.path.startsWith("/api") ? next() : res.sendFile(path.join(frontendDir, "index.html"))));

  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log("error", "unhandled_error", { error: err?.message, stack: config.nodeEnv !== "production" ? err?.stack : undefined });
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`AI Agent Platform listening on http://${config.host}:${config.port}`);
  });
  server.keepAliveTimeout = 65000;

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
