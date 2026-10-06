import { nanoid } from "nanoid";
import { db } from "../db";
import { encryptSecret, decryptSecret, maskSecret } from "../crypto/encryption";

export interface ProviderInput {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  role?: string;
  capabilities?: string[];
  enabled?: boolean;
  priority?: number;
  requests_per_minute?: number | null;
  tokens_per_minute?: number | null;
  daily_limit?: number | null;
  monthly_budget?: number | null;
  input_price_per_1k?: number | null;
  output_price_per_1k?: number | null;
}

export interface ProviderRow {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key_encrypted: string;
  model: string;
  temperature: number;
  max_tokens: number;
  role: string;
  capabilities: string; // JSON
  enabled: number;
  priority: number;
  requests_per_minute: number | null;
  tokens_per_minute: number | null;
  daily_limit: number | null;
  monthly_budget: number | null;
  input_price_per_1k: number | null;
  output_price_per_1k: number | null;
  last_status: string | null;
  last_error: string | null;
  last_latency_ms: number | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape returned to the frontend - API key is always masked, never full. */
export interface ProviderPublic {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key_masked: string;
  model: string;
  temperature: number;
  max_tokens: number;
  role: string;
  capabilities: string[];
  enabled: boolean;
  priority: number;
  requests_per_minute: number | null;
  tokens_per_minute: number | null;
  daily_limit: number | null;
  monthly_budget: number | null;
  input_price_per_1k: number | null;
  output_price_per_1k: number | null;
  last_status: string | null;
  last_error: string | null;
  last_latency_ms: number | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function toPublic(row: ProviderRow): ProviderPublic {
  const apiKey = decryptSecret(row.api_key_encrypted);
  return {
    id: row.id,
    name: row.name,
    provider_type: row.provider_type,
    base_url: row.base_url,
    api_key_masked: maskSecret(apiKey),
    model: row.model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    role: row.role,
    capabilities: JSON.parse(row.capabilities || "[]"),
    enabled: !!row.enabled,
    priority: row.priority,
    requests_per_minute: row.requests_per_minute,
    tokens_per_minute: row.tokens_per_minute,
    daily_limit: row.daily_limit,
    monthly_budget: row.monthly_budget,
    input_price_per_1k: row.input_price_per_1k,
    output_price_per_1k: row.output_price_per_1k,
    last_status: row.last_status,
    last_error: row.last_error,
    last_latency_ms: row.last_latency_ms,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listProviders(): ProviderPublic[] {
  const rows = db.prepare("SELECT * FROM providers ORDER BY priority ASC, created_at ASC").all() as ProviderRow[];
  return rows.map(toPublic);
}

export function getProviderRow(id: string): ProviderRow | undefined {
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
}

export function getProviderPublic(id: string): ProviderPublic | undefined {
  const row = getProviderRow(id);
  return row ? toPublic(row) : undefined;
}

/** Decrypted credentials for internal use only - never send this to the client. */
export function getProviderCredentials(id: string) {
  const row = getProviderRow(id);
  if (!row) return undefined;
  return {
    baseUrl: row.base_url,
    apiKey: decryptSecret(row.api_key_encrypted),
    model: row.model,
    providerType: row.provider_type,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
  };
}

export function createProvider(input: ProviderInput): ProviderPublic {
  const id = `prov_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO providers
      (id, name, provider_type, base_url, api_key_encrypted, model, temperature, max_tokens,
       role, capabilities, enabled, priority, requests_per_minute, tokens_per_minute,
       daily_limit, monthly_budget, input_price_per_1k, output_price_per_1k, last_status)
     VALUES (@id, @name, @provider_type, @base_url, @api_key_encrypted, @model, @temperature, @max_tokens,
       @role, @capabilities, @enabled, @priority, @requests_per_minute, @tokens_per_minute,
       @daily_limit, @monthly_budget, @input_price_per_1k, @output_price_per_1k, 'untested')`
  ).run({
    id,
    name: input.name,
    provider_type: input.provider_type,
    base_url: input.base_url,
    api_key_encrypted: encryptSecret(input.api_key),
    model: input.model,
    temperature: input.temperature ?? 0.3,
    max_tokens: input.max_tokens ?? 4096,
    role: input.role ?? "any",
    capabilities: JSON.stringify(input.capabilities ?? []),
    enabled: input.enabled === false ? 0 : 1,
    priority: input.priority ?? 100,
    requests_per_minute: input.requests_per_minute ?? null,
    tokens_per_minute: input.tokens_per_minute ?? null,
    daily_limit: input.daily_limit ?? null,
    monthly_budget: input.monthly_budget ?? null,
    input_price_per_1k: input.input_price_per_1k ?? null,
    output_price_per_1k: input.output_price_per_1k ?? null,
  });
  return getProviderPublic(id)!;
}

export function updateProvider(id: string, input: Partial<ProviderInput>): ProviderPublic | undefined {
  const existing = getProviderRow(id);
  if (!existing) return undefined;

  const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);
  const merged = {
    name: input.name ?? existing.name,
    provider_type: input.provider_type ?? existing.provider_type,
    base_url: input.base_url ?? existing.base_url,
    api_key_encrypted: input.api_key ? encryptSecret(input.api_key) : existing.api_key_encrypted,
    model: input.model ?? existing.model,
    temperature: input.temperature ?? existing.temperature,
    max_tokens: input.max_tokens ?? existing.max_tokens,
    role: input.role ?? existing.role,
    capabilities: input.capabilities ? JSON.stringify(input.capabilities) : existing.capabilities,
    enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
    priority: input.priority ?? existing.priority,
    requests_per_minute: pick(input.requests_per_minute, existing.requests_per_minute),
    tokens_per_minute: pick(input.tokens_per_minute, existing.tokens_per_minute),
    daily_limit: pick(input.daily_limit, existing.daily_limit),
    monthly_budget: pick(input.monthly_budget, existing.monthly_budget),
    input_price_per_1k: pick(input.input_price_per_1k, existing.input_price_per_1k),
    output_price_per_1k: pick(input.output_price_per_1k, existing.output_price_per_1k),
  };

  db.prepare(
    `UPDATE providers SET
      name=@name, provider_type=@provider_type, base_url=@base_url, api_key_encrypted=@api_key_encrypted,
      model=@model, temperature=@temperature, max_tokens=@max_tokens, role=@role, capabilities=@capabilities,
      enabled=@enabled, priority=@priority, requests_per_minute=@requests_per_minute,
      tokens_per_minute=@tokens_per_minute, daily_limit=@daily_limit, monthly_budget=@monthly_budget,
      input_price_per_1k=@input_price_per_1k, output_price_per_1k=@output_price_per_1k,
      updated_at=datetime('now')
     WHERE id=@id`
  ).run({ ...merged, id });

  return getProviderPublic(id);
}

export function deleteProvider(id: string): boolean {
  const result = db.prepare("DELETE FROM providers WHERE id = ?").run(id);
  return result.changes > 0;
}

export function recordHealthCheck(
  id: string,
  status: string,
  latencyMs?: number,
  error?: string
) {
  db.prepare(
    `UPDATE providers SET last_status=?, last_latency_ms=?, last_error=?, last_checked_at=datetime('now')
     WHERE id=?`
  ).run(status, latencyMs ?? null, error ?? null, id);
}
