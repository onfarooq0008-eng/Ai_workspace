import { Router } from "express";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { createProject, listProjects, getProject, updateProject, deleteProject } from "../db/chats";
import { listMemories, addMemory, deleteMemory } from "../db/memory";
import { config } from "../config";

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => res.json(listProjects()));

projectsRouter.post("/", (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(120), instructions: z.string().max(10000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  res.status(201).json(createProject(parsed.data.name, parsed.data.instructions));
});

projectsRouter.get("/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ ...project, memory: listMemories("project", req.params.id) });
});

projectsRouter.patch("/:id", (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(120).optional(), instructions: z.string().max(10000).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const updated = updateProject(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "Project not found" });
  res.json(updated);
});

projectsRouter.delete("/:id", (req, res) => {
  if (req.query.confirm !== "true") return res.status(400).json({ error: "Pass ?confirm=true to permanently delete this project and its workspace." });
  if (!deleteProject(req.params.id)) return res.status(404).json({ error: "Project not found" });
  res.json({ ok: true });
});

projectsRouter.post("/:id/memory", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const { content } = req.body || {};
  if (typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "content is required" });
  res.status(201).json(addMemory("project", content.trim().slice(0, 2000), req.params.id));
});

projectsRouter.delete("/:id/memory/:memId", (req, res) => {
  if (!deleteMemory(req.params.memId)) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

/** Downloads the project workspace as a .zip (spec section 45). Requires the `zip` binary on the host. */
projectsRouter.get("/:id/export", (req, res) => {
  const project = getProject(req.params.id) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const safeName = project.name.replace(/[^a-z0-9-_]+/gi, "_") || "project";
  const tmpZip = path.join(config.workspaceDir, `.export-${project.id}-${Date.now()}.zip`);
  execFile("zip", ["-r", "-q", tmpZip, "."], { cwd: project.workspace_path, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err) => {
    if (err) {
      try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
      return res.status(500).json({ error: `Could not create zip (is 'zip' installed on the server?): ${err.message}` });
    }
    res.download(tmpZip, `${safeName}.zip`, (sendErr) => {
      try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
      if (sendErr && !res.headersSent) res.status(500).json({ error: "Download failed" });
    });
  });
});
