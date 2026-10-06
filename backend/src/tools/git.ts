import * as fs from "fs";
import * as path from "path";
import { runCommand } from "./terminal";

const GIT_TIMEOUT_MS = 30_000;
const IDENT = '-c user.name="AI Agent Platform" -c user.email="agent@ai-agent-platform.local"';

async function git(workspaceRoot: string, args: string): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand(workspaceRoot, `git ${args}`, GIT_TIMEOUT_MS);
  return { ok: result.exitCode === 0, output: (result.stdout + result.stderr).trim() };
}

const DEFAULT_GITIGNORE = "node_modules/\n.env\n*.log\ndist/\n__pycache__/\n.DS_Store\n";

export async function gitInit(workspaceRoot: string): Promise<string> {
  const gi = path.join(workspaceRoot, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, DEFAULT_GITIGNORE);
  return (await git(workspaceRoot, "init")).output;
}

export async function isRepo(workspaceRoot: string): Promise<boolean> {
  return (await runCommand(workspaceRoot, "git rev-parse --is-inside-work-tree", 10_000)).exitCode === 0;
}

export async function gitStatus(workspaceRoot: string): Promise<string> {
  return (await git(workspaceRoot, "status --porcelain=v1 -b")).output;
}

export async function gitDiff(workspaceRoot: string): Promise<string> {
  return (await git(workspaceRoot, "diff HEAD")).output || (await git(workspaceRoot, "diff")).output;
}

export async function gitAdd(workspaceRoot: string, pathspec = "."): Promise<string> {
  return (await git(workspaceRoot, `add -- ${pathspec}`)).output;
}

export async function gitCommit(workspaceRoot: string, message: string): Promise<{ hash: string | null; output: string }> {
  const safeMessage = message.replace(/["`$\\]/g, " ");
  const result = await git(workspaceRoot, `${IDENT} commit -m "${safeMessage}" --allow-empty`);
  const hashResult = await git(workspaceRoot, "rev-parse HEAD");
  return { hash: hashResult.ok ? hashResult.output.trim() : null, output: result.output };
}

export async function gitLog(workspaceRoot: string, limit = 20): Promise<string> {
  return (await git(workspaceRoot, `log --oneline -n ${Math.max(1, Math.min(500, Math.floor(limit) || 20))}`)).output;
}

export async function gitBranch(workspaceRoot: string, name?: string): Promise<string> {
  if (name && !/^[A-Za-z0-9._\/-]+$/.test(name)) throw new Error("Invalid branch name");
  return (await git(workspaceRoot, name ? `branch ${name}` : "branch")).output;
}

export async function gitCheckout(workspaceRoot: string, ref: string): Promise<string> {
  if (!/^[A-Za-z0-9._\/-]+$/.test(ref)) throw new Error("Invalid ref");
  return (await git(workspaceRoot, `checkout ${ref}`)).output;
}

/** Restores the working tree to a previous checkpoint commit (a safety checkpoint is taken first by the caller). */
export async function gitResetHard(workspaceRoot: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error("Invalid commit hash");
  return (await git(workspaceRoot, `reset --hard ${hash}`)).output;
}

/**
 * Creates a checkpoint commit (spec section 18) so damage is always reversible. Ensures a repo exists first,
 * since a fresh project workspace has none yet.
 */
export async function createCheckpoint(workspaceRoot: string, label: string): Promise<{ hash: string | null; output: string }> {
  if (!(await isRepo(workspaceRoot))) await gitInit(workspaceRoot);
  await gitAdd(workspaceRoot);
  return gitCommit(workspaceRoot, label);
}
