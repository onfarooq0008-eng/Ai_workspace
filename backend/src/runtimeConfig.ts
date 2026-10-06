import { db } from "./db";
import { config } from "./config";
import { encryptSecret, decryptSecret } from "./crypto/encryption";

export type SettingType = "number" | "boolean" | "string" | "select" | "providerSelect" | "providerMulti";

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: SettingType;
  default: any;
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
}

/** Every user-editable runtime setting (spec section 46). The Settings page renders itself from this list. */
export const SETTING_DEFS: SettingDef[] = [
  { key: "default_manager_provider_id", group: "Team", label: "Default Manager AI", type: "providerSelect", default: "", help: "Used for new chats and for planning." },
  { key: "default_worker_provider_id", group: "Team", label: "Default Worker AI", type: "providerSelect", default: "", help: "Empty = Auto (pick by role/capability)." },
  { key: "fallback_provider_ids", group: "Team", label: "Fallback models (in order)", type: "providerMulti", default: [], help: "Tried in this order when the chosen model fails." },
  { key: "load_balance_strategy", group: "Team", label: "Load balancing between equivalent models", type: "select", options: ["priority", "round_robin", "lowest_usage", "fastest", "random"], default: "priority" },
  { key: "max_concurrent_workers", group: "Team", label: "Maximum concurrent workers", type: "number", min: 1, max: 8, default: config.maxConcurrentWorkers },
  { key: "max_retries", group: "Team", label: "Maximum retries per task", type: "number", min: 0, max: 10, default: config.maxRetries },
  { key: "max_tool_iterations", group: "Team", label: "Maximum tool-use steps per task", type: "number", min: 1, max: 30, default: config.maxToolIterationsPerTask },
  { key: "command_timeout_ms", group: "Safety", label: "Command timeout (ms)", type: "number", min: 1000, max: 1800000, default: config.defaultCommandTimeoutMs },
  { key: "task_timeout_ms", group: "Safety", label: "Task timeout (ms)", type: "number", min: 10000, max: 7200000, default: config.defaultTaskTimeoutMs },
  { key: "approval_timeout_ms", group: "Safety", label: "Approval wait timeout (ms)", type: "number", min: 10000, max: 7200000, default: config.approvalTimeoutMs },
  { key: "require_approval", group: "Safety", label: "Require approval for sensitive actions", type: "boolean", default: true, help: "Dangerous commands are always blocked regardless of this setting." },
  { key: "daily_token_budget", group: "Budgets", label: "Daily token budget (0 = unlimited)", type: "number", min: 0, max: 1e12, default: 0 },
  { key: "monthly_cost_budget", group: "Budgets", label: "Monthly cost budget (0 = unlimited)", type: "number", min: 0, max: 1e9, default: 0, help: "Only counts providers that have pricing configured." },
  { key: "log_retention_days", group: "Maintenance", label: "Log retention (days)", type: "number", min: 1, max: 3650, default: 90 },
  { key: "max_upload_mb", group: "Maintenance", label: "Maximum upload size (MB)", type: "number", min: 1, max: 100, default: 5 },
  { key: "theme", group: "Appearance", label: "Theme", type: "select", options: ["dark", "light"], default: "dark" },
  { key: "language", group: "Appearance", label: "Language", type: "select", options: ["en", "es", "fr", "de", "ar"], default: "en" },
  { key: "search_api_url", group: "Research", label: "Search API URL", type: "string", default: "", help: "GET endpoint returning JSON. Use {query} and {limit} placeholders, e.g. https://api.example.com/search?q={query}&count={limit}" },
  { key: "search_auth_header", group: "Research", label: "Search auth header name", type: "string", default: "Authorization", help: "The API key below is sent in this header (Bearer prefix added for Authorization)." },
];

const cache = new Map<string, { v: any; t: number }>();
const TTL_MS = 2000;

function parseStored(def: SettingDef, raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return def.default;
  }
}

export function getSetting<T = any>(key: string): T {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  const v = row ? parseStored(def, row.value) : def.default;
  cache.set(key, { v, t: Date.now() });
  return v;
}

export function getAllSettings(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of SETTING_DEFS) out[d.key] = getSetting(d.key);
  return out;
}

export function validateSettingValue(def: SettingDef, value: any): { ok: true; value: any } | { ok: false; error: string } {
  switch (def.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `${def.label} must be ≥ ${def.min}` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `${def.label} must be ≤ ${def.max}` };
      return { ok: true, value: n };
    }
    case "boolean":
      return { ok: true, value: !!value };
    case "select":
      return def.options!.includes(String(value)) ? { ok: true, value: String(value) } : { ok: false, error: `${def.label}: invalid option` };
    case "providerMulti":
      return Array.isArray(value) ? { ok: true, value: value.map(String) } : { ok: false, error: `${def.label} must be a list` };
    default:
      return { ok: true, value: String(value ?? "") };
  }
}

export function setSettings(values: Record<string, any>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const toWrite: [string, any][] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) { errors.push(`Unknown setting: ${key}`); continue; }
    const r = validateSettingValue(def, value);
    if (!r.ok) errors.push(r.error); else toWrite.push([key, r.value]);
  }
  if (errors.length) return { ok: false, errors };
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.transaction(() => { for (const [k, v] of toWrite) stmt.run(k, JSON.stringify(v)); })();
  for (const [k] of toWrite) cache.delete(k);
  return { ok: true, errors: [] };
}

// --- the search API key is a secret: stored encrypted, never returned ---
export function setSearchApiKey(key: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('search_api_key_enc', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(key ? encryptSecret(key) : ""));
}
export function getSearchApiKey(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'search_api_key_enc'").get() as { value: string } | undefined;
  if (!row) return "";
  try {
    const enc = JSON.parse(row.value);
    return enc ? decryptSecret(enc) : "";
  } catch {
    return "";
  }
}
export const searchApiKeyIsSet = () => !!getSearchApiKey();
