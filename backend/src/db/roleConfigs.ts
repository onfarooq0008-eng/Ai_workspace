import { db } from "./index";

export interface RoleConfig {
  role: string;
  provider_id: string | null;
  temperature: number | null;
  max_tokens: number | null;
  enabled: boolean;
  extra_instructions: string | null;
}

function map(r: any): RoleConfig {
  return { role: r.role, provider_id: r.provider_id, temperature: r.temperature, max_tokens: r.max_tokens, enabled: !!r.enabled, extra_instructions: r.extra_instructions };
}

export function getRoleConfig(role: string): RoleConfig {
  const r = db.prepare("SELECT * FROM role_configs WHERE role = ?").get(role);
  return r ? map(r) : { role, provider_id: null, temperature: null, max_tokens: null, enabled: true, extra_instructions: null };
}

export function listRoleConfigs(): Record<string, RoleConfig> {
  const out: Record<string, RoleConfig> = {};
  for (const r of db.prepare("SELECT * FROM role_configs").all()) out[(r as any).role] = map(r);
  return out;
}

export function upsertRoleConfig(role: string, patch: Partial<Omit<RoleConfig, "role">>): RoleConfig {
  const cur = getRoleConfig(role);
  const next = { ...cur, ...patch };
  db.prepare(
    `INSERT INTO role_configs (role, provider_id, temperature, max_tokens, enabled, extra_instructions, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(role) DO UPDATE SET provider_id = excluded.provider_id, temperature = excluded.temperature,
       max_tokens = excluded.max_tokens, enabled = excluded.enabled, extra_instructions = excluded.extra_instructions, updated_at = excluded.updated_at`
  ).run(role, next.provider_id, next.temperature, next.max_tokens, next.enabled ? 1 : 0, next.extra_instructions);
  return getRoleConfig(role);
}
