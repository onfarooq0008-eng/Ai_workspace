import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { getProject } from "../db/chats";
import { listDirectoryTool, readFileTool, writeFileTool, resolveSafePath, WorkspaceSecurityError } from "../tools/filesystem";
import { getSetting } from "../runtimeConfig";

export const filesRouter = Router();

const EXEC_EXTENSIONS = new Set([".sh", ".exe", ".bat", ".cmd", ".ps1", ".app"]);

filesRouter.get("/:projectId/list", (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    res.json({ path: (req.query.path as string) || ".", entries: listDirectoryTool(project.workspace_path, (req.query.path as string) || ".") });
  } catch (err) {
    if (err instanceof WorkspaceSecurityError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: (err as Error).message });
  }
});

filesRouter.get("/:projectId/read", (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: "?path= is required" });
  try {
    res.json({ path: relPath, content: readFileTool(project.workspace_path, relPath) });
  } catch (err) {
    if (err instanceof WorkspaceSecurityError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: (err as Error).message });
  }
});

/** Manual edits from the Files panel (separate from agent writes - still sandboxed the same way). */
filesRouter.put("/:projectId/write", (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const { path: relPath, content } = req.body || {};
  if (!relPath || typeof content !== "string") return res.status(400).json({ error: "path and content are required" });
  try {
    writeFileTool(project.workspace_path, relPath, content);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceSecurityError) return res.status(400).json({ error: err.message });
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Upload a file into the project workspace (spec section 44). Raw-body upload (no multipart dependency needed):
 * the client PUTs file bytes with ?path=; size is capped by Settings → Maintenance, and nothing is ever auto-executed.
 */
filesRouter.put("/:projectId/upload", (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: "?path= is required" });
  const ext = path.extname(relPath).toLowerCase();
  if (EXEC_EXTENSIONS.has(ext)) return res.status(400).json({ error: `Executable uploads (${ext}) are not allowed.` });

  let target: string;
  try {
    target = resolveSafePath(project.workspace_path, relPath);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const maxBytes = (Number(getSetting("max_upload_mb")) || 5) * 1024 * 1024;
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes && !aborted) {
      aborted = true;
      res.status(413).json({ error: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB upload limit.` });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (aborted) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.concat(chunks));
    res.status(201).json({ ok: true, path: relPath, bytes: total });
  });
  req.on("error", () => { if (!res.headersSent) res.status(400).json({ error: "Upload failed" }); });
});
