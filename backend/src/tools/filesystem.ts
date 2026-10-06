import * as fs from "fs";
import * as path from "path";

export class WorkspaceSecurityError extends Error {}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, spec section 35: maximum file size
const MAX_LIST_ENTRIES = 500;

/**
 * Resolves a user/agent-supplied relative path against the project's
 * workspace root and throws if the result would escape that root - this is
 * the single choke point that stops "../../etc/passwd"-style traversal
 * (spec section 35). Every filesystem function below goes through this.
 */
export function resolveSafePath(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath || ".");
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new WorkspaceSecurityError(
      `Path "${relativePath}" resolves outside the project workspace and was blocked`
    );
  }
  return target;
}

export function readFileTool(workspaceRoot: string, relativePath: string): string {
  const target = resolveSafePath(workspaceRoot, relativePath);
  const stat = fs.statSync(target);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is ${stat.size} bytes, exceeding the ${MAX_FILE_SIZE_BYTES}-byte read limit`);
  }
  return fs.readFileSync(target, "utf8");
}

export function writeFileTool(workspaceRoot: string, relativePath: string, content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Content exceeds the ${MAX_FILE_SIZE_BYTES}-byte write limit`);
  }
  const target = resolveSafePath(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

export function createFileTool(workspaceRoot: string, relativePath: string, content: string): void {
  const target = resolveSafePath(workspaceRoot, relativePath);
  if (fs.existsSync(target)) {
    throw new Error(`File already exists: ${relativePath}. Use edit_file or write_file to modify it.`);
  }
  writeFileTool(workspaceRoot, relativePath, content);
}

/** Simple exact-match find/replace edit, applied once by default (or all occurrences if replaceAll is true). */
export function editFileTool(
  workspaceRoot: string,
  relativePath: string,
  find: string,
  replace: string,
  replaceAll = false
): { replacements: number } {
  const target = resolveSafePath(workspaceRoot, relativePath);
  const original = fs.readFileSync(target, "utf8");
  if (!original.includes(find)) {
    throw new Error(`The text to find was not present verbatim in ${relativePath}`);
  }
  const occurrences = original.split(find).length - 1;
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `"find" matched ${occurrences} locations in ${relativePath}; it must be unique, or pass replaceAll`
    );
  }
  const updated = replaceAll ? original.split(find).join(replace) : original.replace(find, replace);
  fs.writeFileSync(target, updated, "utf8");
  return { replacements: replaceAll ? occurrences : 1 };
}

export function deleteFileTool(workspaceRoot: string, relativePath: string): void {
  const target = resolveSafePath(workspaceRoot, relativePath);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    fs.rmSync(target, { recursive: true });
  } else {
    fs.unlinkSync(target);
  }
}

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
}

export function listDirectoryTool(workspaceRoot: string, relativePath: string): DirEntry[] {
  const target = resolveSafePath(workspaceRoot, relativePath || ".");
  const entries = fs.readdirSync(target, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== ".git" && e.name !== "node_modules")
    .slice(0, MAX_LIST_ENTRIES)
    .map((e) => {
      if (e.isDirectory()) return { name: e.name, type: "directory" as const };
      const full = path.join(target, e.name);
      let size: number | undefined;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = undefined;
      }
      return { name: e.name, type: "file" as const, size };
    });
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Simple recursive substring search across the workspace (no shell-out, so
 * it works the same regardless of what's installed on the VPS). Bounded by
 * file count and match count to stay cheap on a 1GB VPS.
 */
export function searchFilesTool(workspaceRoot: string, query: string, maxResults = 100): SearchMatch[] {
  const root = path.resolve(workspaceRoot);
  const results: SearchMatch[] = [];
  let filesScanned = 0;
  const MAX_FILES_SCANNED = 2000;

  function walk(dir: string) {
    if (results.length >= maxResults || filesScanned >= MAX_FILES_SCANNED) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults || filesScanned >= MAX_FILES_SCANNED) return;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      filesScanned++;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SIZE_BYTES) continue;
      let content: string;
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue; // likely a binary file
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(query)) {
          results.push({ file: path.relative(root, full), line: i + 1, text: lines[i].trim().slice(0, 300) });
          if (results.length >= maxResults) break;
        }
      }
    }
  }

  walk(root);
  return results;
}
