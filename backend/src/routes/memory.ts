import { Router } from "express";
import { addMemory, deleteMemory, listMemories } from "../db/memory";
import { getProject } from "../db/chats";

export const memoryRouter = Router();

memoryRouter.get("/", (req, res) => {
  const scope = req.query.scope === "user" ? "user" : "project";
  if (scope === "project" && !req.query.projectId) return res.status(400).json({ error: "projectId is required for project memory" });
  res.json(listMemories(scope, req.query.projectId as string | undefined));
});

memoryRouter.post("/", (req, res) => {
  const { scope, content, projectId } = req.body || {};
  if (scope !== "user" && scope !== "project") return res.status(400).json({ error: "scope must be 'user' or 'project'" });
  if (typeof content !== "string" || !content.trim() || content.length > 2000) return res.status(400).json({ error: "content must be 1-2000 characters" });
  if (scope === "project" && !getProject(projectId)) return res.status(404).json({ error: "Project not found" });
  res.status(201).json(addMemory(scope, content.trim(), projectId));
});

memoryRouter.delete("/:id", (req, res) => {
  if (!deleteMemory(req.params.id)) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
