import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import { redactSecrets } from "./crypto/encryption";

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const file = path.join(config.logDir, "app.log");
let writes = 0;

function rotateIfNeeded() {
  try {
    if (fs.statSync(file).size > 10 * 1024 * 1024) fs.renameSync(file, file + ".1");
  } catch {
    /* no file yet */
  }
}

/** Structured JSON logging (spec section 72). Secrets are redacted before anything is written. */
export function log(level: "debug" | "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  if ((LEVELS[level] ?? 20) < (LEVELS[config.logLevel] ?? 20)) return;
  const line = redactSecrets(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
  try {
    if (++writes % 200 === 0) rotateIfNeeded();
    fs.appendFileSync(file, line + "\n");
  } catch {
    /* logging must never crash the app */
  }
  console.log(line);
}
