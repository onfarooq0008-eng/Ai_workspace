import { Router } from "express";
import { getProject } from "../db/chats";
import { listCheckpoints, recordCheckpoint, nextCheckpointLabel } from "../db/checkpoints";
import { listRecentToolCalls } from "../db/toolCalls";
import * as git from "../tools/git";
import { db } from "../db";
import { nanoid } from "nanoid";
import { actorOf } from "../auth/auth";
import { eventBus } from "../orchestrator/eventBus";

export const gitRouter = Router();

gitRouter.get("/:projectId/checkpoints", (req, res) => {
  if (!getProject(req.params.projectId)) return res.status(404).json({ error: "Project not found" });
  res.json(listCheckpoints(req.params.projectId));
});

gitRouter.post("/:projectId/checkpoints", async (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const label = String(req.body?.label || nextCheckpointLabel(req.params.projectId));
  const { hash, output } = await git.createCheckpoint(project.workspace_path, label);
  const row = recordCheckpoint({ projectId: project.id, label, commitHash: hash, message: "manual checkpoint" });
  res.status(201).json({ ...row, output });
});

gitRouter.get("/:projectId/log", async (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ log: await git.gitLog(project.workspace_path, 50) });
});

gitRouter.get("/:projectId/diff", async (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ diff: await git.gitDiff(project.workspace_path) });
});

/** Rolls the workspace back to a checkpoint. A safety checkpoint of the current state is taken first, so this is always reversible. */
gitRouter.post("/:projectId/restore/:checkpointId", async (req, res) => {
  const project = getProject(req.params.projectId) as any;
  if (!project) return res.status(404).json({ error: "Project not found" });
  const ckpt = (listCheckpoints(req.params.projectId) as any[]).find((c) => c.id === req.params.checkpointId);
  if (!ckpt || !ckpt.commit_hash) return res.status(404).json({ error: "Checkpoint not found" });
  const safety = await git.createCheckpoint(project.workspace_path, `pre-restore-safety-${Date.now()}`);
  recordCheckpoint({ projectId: project.id, label: "pre-restore safety", commitHash: safety.hash, message: `before restoring ${ckpt.label}` });
  await git.gitResetHard(project.workspace_path, ckpt.commit_hash);
  recordCheckpoint({ projectId: project.id, label: `restored-${ckpt.label}`, commitHash: ckpt.commit_hash, message: "restore" });
  db.prepare("INSERT INTO audit_logs (id, event, actor, detail) VALUES (?, 'project_restored', ?, ?)").run(`audit_${nanoid(10)}`, actorOf(req), JSON.stringify({ projectId: project.id, checkpoint: ckpt.label }));
  eventBus.publish("checkpoint_restored", { projectId: project.id, label: ckpt.label });
  res.json({ ok: true, restoredTo: ckpt.label });
});

gitRouter.get("/:projectId/tool-calls", (req, res) => {
  if (!getProject(req.params.projectId)) return res.status(404).json({ error: "Project not found" });
  res.json(listRecentToolCalls(req.params.projectId, 150));
});
