import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createProvider, deleteProvider, getProviderCredentials, getProviderPublic, getProviderRow, listProviders, recordHealthCheck, updateProvider } from "../providers/store";
import { getAdapter, PROVIDER_TYPES } from "../providers/registry";
import { decryptSecret } from "../crypto/encryption";
import { db } from "../db";
import { actorOf } from "../auth/auth";

export const providersRouter = Router();

export const CAPABILITIES = ["coding", "reasoning", "research", "vision", "tool_use", "long_context", "fast_response", "cheap", "review"];

const providerSchema = z.object({
  name: z.string().min(1).max(80),
  provider_type: z.string().refine((t) => PROVIDER_TYPES.includes(t), "Unknown provider type"),
  base_url: z.string().max(500),
  api_key: z.string().min(1),
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  role: z.string().min(1).max(40).optional(),
  capabilities: z.array(z.string().refine((c) => CAPABILITIES.includes(c), "Unknown capability")).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  requests_per_minute: z.number().int().positive().nullable().optional(),
  tokens_per_minute: z.number().int().positive().nullable().optional(),
  daily_limit: z.number().int().positive().nullable().optional(),
  monthly_budget: z.number().positive().nullable().optional(),
  input_price_per_1k: z.number().min(0).nullable().optional(),
  output_price_per_1k: z.number().min(0).nullable().optional(),
});

const audit = (req: any, event: string, detail: unknown) =>
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, ?, ?, ?)").run(`audit_${nanoid(10)}`, event, actorOf(req), JSON.stringify(detail));

providersRouter.get("/meta", (_req, res) => {
  res.json({ provider_types: PROVIDER_TYPES, capabilities: CAPABILITIES });
});

providersRouter.get("/", (_req, res) => {
  res.json(listProviders());
});

providersRouter.post("/", (req, res) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider payload: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") });
  const created = createProvider(parsed.data);
  audit(req, "provider_created", { provider_id: created.id, name: created.name });
  res.status(201).json(created);
});

/** Discover available models for credentials that are not saved yet (used by the Add Provider form). */
providersRouter.post("/discover-models", async (req, res) => {
  const { provider_type, base_url, api_key } = req.body || {};
  if (!provider_type || !api_key) return res.status(400).json({ error: "provider_type and api_key are required" });
  try {
    const models = await getAdapter(provider_type).listModels({ baseUrl: base_url || "", apiKey: api_key, model: "" });
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message.replace(api_key, "[REDACTED]") });
  }
});

providersRouter.get("/:id", (req, res) => {
  const p = getProviderPublic(req.params.id);
  if (!p) return res.status(404).json({ error: "Provider not found" });
  res.json(p);
});

providersRouter.patch("/:id", (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.api_key === "" || body.api_key === undefined) delete body.api_key; // blank = keep the stored key
  const parsed = providerSchema.partial().safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider payload: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") });
  const updated = updateProvider(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "Provider not found" });
  audit(req, "provider_updated", { provider_id: req.params.id, fields: Object.keys(parsed.data).filter((k) => k !== "api_key"), key_changed: !!parsed.data.api_key });
  res.json(updated);
});

providersRouter.post("/:id/duplicate", (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: "Provider not found" });
  const copy = createProvider({
    name: `${row.name} copy`, provider_type: row.provider_type, base_url: row.base_url, api_key: decryptSecret(row.api_key_encrypted), model: row.model,
    temperature: row.temperature, max_tokens: row.max_tokens, role: row.role, capabilities: JSON.parse(row.capabilities || "[]"), enabled: false,
    priority: row.priority + 1, requests_per_minute: row.requests_per_minute, tokens_per_minute: row.tokens_per_minute, daily_limit: row.daily_limit,
    monthly_budget: row.monthly_budget, input_price_per_1k: row.input_price_per_1k, output_price_per_1k: row.output_price_per_1k,
  });
  audit(req, "provider_duplicated", { from: req.params.id, to: copy.id });
  res.status(201).json(copy);
});

providersRouter.delete("/:id", (req, res) => {
  if (!deleteProvider(req.params.id)) return res.status(404).json({ error: "Provider not found" });
  audit(req, "provider_deleted", { provider_id: req.params.id });
  res.json({ ok: true });
});

/** Test Connection: authentication, endpoint, model availability and a basic completion (spec section 8). */
providersRouter.post("/:id/test", async (req, res) => {
  const creds = getProviderCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: "Provider not found" });
  try {
    const result = await getAdapter(creds.providerType).healthCheck({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, model: creds.model });
    recordHealthCheck(req.params.id, result.status, result.latencyMs, result.error);
    res.json({ ...result, provider: getProviderPublic(req.params.id) });
  } catch (err) {
    const message = (err as Error).message;
    recordHealthCheck(req.params.id, "error", undefined, message);
    res.json({ status: "error", error: message, provider: getProviderPublic(req.params.id) });
  }
});

providersRouter.get("/:id/models", async (req, res) => {
  const creds = getProviderCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: "Provider not found" });
  try {
    res.json({ models: await getAdapter(creds.providerType).listModels({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, model: creds.model }) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message.replace(creds.apiKey, "[REDACTED]") });
  }
});
