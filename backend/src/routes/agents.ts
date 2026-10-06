import { Router } from "express";
import { allRolesMeta } from "../orchestrator/roleMeta";
import { ROLE_TOOLS } from "../tools/dispatcher";
import { listRoleConfigs, upsertRoleConfig } from "../db/roleConfigs";
import { WORKER_SYSTEM_PROMPTS, MANAGER_SYSTEM_PROMPT, PLANNER_SYSTEM_PROMPT } from "../orchestrator/prompts";
import { selectCandidateProviders } from "../orchestrator/modelSelection";
import { getProviderPublic } from "../providers/store";

export const agentsRouter = Router();

agentsRouter.get("/", (_req, res) => {
  const configs = listRoleConfigs();
  res.json(
    allRolesMeta().map((m) => {
      const cfg = configs[m.role] || { role: m.role, provider_id: null, temperature: null, max_tokens: null, enabled: true, extra_instructions: null };
      const eff = selectCandidateProviders(m.role)[0];
      return {
        ...m,
        config: cfg,
        tools: ROLE_TOOLS[m.role] || [],
        base_prompt: m.role === "manager" ? MANAGER_SYSTEM_PROMPT : m.role === "planner" ? PLANNER_SYSTEM_PROMPT : WORKER_SYSTEM_PROMPTS[m.role] || "",
        effective_provider: eff ? { id: eff.id, name: eff.name, model: eff.model } : null,
      };
    })
  );
});

agentsRouter.put("/:role", (req, res) => {
  const role = req.params.role;
  if (!allRolesMeta().some((m) => m.role === role)) return res.status(404).json({ error: "Unknown role" });
  const b = req.body || {};
  const patch: any = {};
  if ("provider_id" in b) {
    if (b.provider_id && !getProviderPublic(b.provider_id)) return res.status(400).json({ error: "Unknown provider" });
    patch.provider_id = b.provider_id || null;
  }
  if ("temperature" in b) {
    if (b.temperature !== null && !(Number(b.temperature) >= 0 && Number(b.temperature) <= 2)) return res.status(400).json({ error: "temperature must be between 0 and 2" });
    patch.temperature = b.temperature === null || b.temperature === "" ? null : Number(b.temperature);
  }
  if ("max_tokens" in b) {
    if (b.max_tokens !== null && !(Number.isInteger(Number(b.max_tokens)) && Number(b.max_tokens) > 0)) return res.status(400).json({ error: "max_tokens must be a positive integer" });
    patch.max_tokens = b.max_tokens === null || b.max_tokens === "" ? null : Number(b.max_tokens);
  }
  if ("enabled" in b && role !== "manager" && role !== "planner") patch.enabled = !!b.enabled;
  if ("extra_instructions" in b) {
    const t = String(b.extra_instructions ?? "").slice(0, 4000);
    patch.extra_instructions = t.trim() ? t : null;
  }
  res.json(upsertRoleConfig(role, patch));
});
