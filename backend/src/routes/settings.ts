import { Router } from "express";
import { SETTING_DEFS, getAllSettings, setSettings, setSearchApiKey, searchApiKeyIsSet } from "../runtimeConfig";
import { db } from "../db";
import { nanoid } from "nanoid";
import { actorOf } from "../auth/auth";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json({ definitions: SETTING_DEFS, values: getAllSettings(), search_api_key_set: searchApiKeyIsSet() });
});

settingsRouter.put("/", (req, res) => {
  const { values, search_api_key } = req.body || {};
  if (values && typeof values === "object") {
    const r = setSettings(values);
    if (!r.ok) return res.status(400).json({ error: r.errors.join("; ") });
  }
  if (typeof search_api_key === "string") setSearchApiKey(search_api_key);
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'settings_updated', ?, ?)").run(`audit_${nanoid(10)}`, actorOf(req), JSON.stringify({ keys: Object.keys(values || {}) }));
  res.json({ definitions: SETTING_DEFS, values: getAllSettings(), search_api_key_set: searchApiKeyIsSet() });
});
