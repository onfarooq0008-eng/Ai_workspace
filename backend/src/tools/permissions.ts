export type PermissionLevel = "SAFE" | "NORMAL" | "SENSITIVE" | "DANGEROUS";

export const FS_TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  read_file: "SAFE",
  list_directory: "SAFE",
  search_files: "SAFE",
  write_file: "NORMAL",
  edit_file: "NORMAL",
  create_file: "NORMAL",
  delete_file: "SENSITIVE",
};

export const GIT_TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  git_status: "SAFE",
  git_diff: "SAFE",
  git_log: "SAFE",
  git_init: "NORMAL",
  git_add: "NORMAL",
  git_commit: "NORMAL",
  git_branch: "NORMAL",
  git_checkout: "SENSITIVE",
};

export const SEARCH_TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  web_search: "SENSITIVE",
};

export const TERMINAL_TOOL_NAME = "run_command";

/**
 * Command strings that must never run, full stop - no approval can unlock
 * these (spec section 17/35: no unrestricted root shell, prevent server
 * damage). Matched case-insensitively against the whole command string.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\bsudo\b/i,
  /\brm\s+-rf\s+\/(?!\S)/i, // rm -rf / (root)
  /\brm\s+-rf\s+~\/?\s*$/i,
  /:\(\)\s*\{.*:\|:.*\}/, // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bchown\s+-R\b.*\//i,
  /curl[^|]*\|\s*(ba)?sh/i,
  /wget[^|]*\|\s*(ba)?sh/i,
  /\bsystemctl\b/i,
  /\buserdel\b|\buseradd\b|\bpasswd\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\biptables\b|\bufw\b/i,
];

/**
 * Commands that touch package managers, the network, or install software -
 * allowed, but require human approval (spec section 26: SENSITIVE = install
 * packages, network requests).
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\bnpm\s+(install|i|add|uninstall|remove)\b/i,
  /\byarn\s+(add|remove|install)\b/i,
  /\bpip3?\s+install\b/i,
  /\bapt(-get)?\s+install\b/i,
  /\bgem\s+install\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+clone\b/i,
];

export interface CommandClassification {
  level: PermissionLevel | "BLOCKED";
  reason: string;
}

/**
 * Classifies a shell command for the terminal tool. BLOCKED means the
 * command must be refused outright, regardless of any approval; SENSITIVE
 * means it can run but only after human approval; everything else runs
 * automatically under its level.
 */
/**
 * Heuristic guard against commands reaching outside the project workspace or building paths dynamically.
 * This is defense in depth, NOT an OS sandbox: code the agent writes and then runs can still do anything the
 * service user can do. See README "Security model".
 */
export function findEscapingPath(command: string, workspaceRoot?: string): string | null {
  if (/`|\$\(|\$\{?HOME|\beval\b/.test(command)) return "command substitution / eval / $HOME are not allowed";
  const tokens = command.split(/[\s"'=;|&<>(),]+/).filter(Boolean);
  const root = workspaceRoot ? workspaceRoot.replace(/\/+$/, "") : undefined;
  for (const t of tokens) {
    if (t === "/dev/null") continue;
    if (t === ".." || t.startsWith("../") || t.includes("/../") || t.endsWith("/..")) return `path "${t}" goes outside the workspace`;
    if (t.startsWith("~")) return `path "${t}" goes outside the workspace`;
    if (t.startsWith("/")) {
      if (root && (t === root || t.startsWith(root + "/"))) continue;
      return `absolute path "${t}" is outside the workspace`;
    }
    if (/(^|\/)\.env(\.|$)/.test(t)) return `access to ${t} is not allowed`;
  }
  return null;
}

/**
 * Classifies a shell command for the terminal tool. BLOCKED means the command must be refused outright,
 * regardless of any approval; SENSITIVE means it can run but only after human approval; everything else
 * runs automatically under its level.
 */
export function classifyCommand(command: string, workspaceRoot?: string): CommandClassification {
  const trimmed = command.trim();
  if (!trimmed) {
    return { level: "BLOCKED", reason: "Empty command" };
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: "BLOCKED", reason: `Command matches a blocked dangerous pattern: ${pattern}` };
    }
  }
  const segments = trimmed.split(/&&|;|\|\||\|/).map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(segment)) {
        return { level: "BLOCKED", reason: `Command segment "${segment}" matches a blocked pattern` };
      }
    }
  }
  const escaping = findEscapingPath(trimmed, workspaceRoot);
  if (escaping) return { level: "BLOCKED", reason: escaping };
  for (const segment of segments) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(segment)) {
        return { level: "SENSITIVE", reason: `Command segment "${segment}" requires approval (package install / network / git push)` };
      }
    }
  }
  return { level: "NORMAL", reason: "Standard build/test/dev command" };
}

export function requiresApproval(level: PermissionLevel): boolean {
  return level === "SENSITIVE" || level === "DANGEROUS";
}
