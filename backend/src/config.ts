import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return v;
}

export const config = {
  port: parseInt(process.env.APP_PORT || process.env.PORT || "3000", 10), // PORT is what Koyeb/Heroku-style hosts provide
  host: process.env.APP_HOST || "127.0.0.1",
  nodeEnv: process.env.NODE_ENV || "production",

  databasePath: process.env.DATABASE_PATH || "./data/app.db",

  sessionSecret: required("SESSION_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"), // must be 32 bytes hex (64 chars) for AES-256

  workspaceDir: path.resolve(process.env.WORKSPACE_DIR || "./workspaces"),
  logDir: path.resolve(process.env.LOG_DIR || "./logs"),
  logLevel: process.env.LOG_LEVEL || "info",

  maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || "2", 10),
  defaultCommandTimeoutMs: parseInt(process.env.DEFAULT_COMMAND_TIMEOUT_MS || "120000", 10),
  defaultTaskTimeoutMs: parseInt(process.env.DEFAULT_TASK_TIMEOUT_MS || "600000", 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || "600000", 10), // 10 min default
  maxToolIterationsPerTask: parseInt(process.env.MAX_TOOL_ITERATIONS_PER_TASK || "8", 10),

  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME || "admin",
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || "",
};

// Ensure runtime directories exist
for (const dir of [
  path.dirname(path.resolve(config.databasePath)),
  config.workspaceDir,
  config.logDir,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (config.encryptionKey.length !== 64) {
  throw new Error(
    "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32"
  );
}
