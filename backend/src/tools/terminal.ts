import { exec } from "child_process";
import { classifyCommand } from "./permissions";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT_CHARS = 20_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + "\n... [output truncated]" : s;
}

/**
 * Executes a command with its cwd locked to the project workspace. Callers
 * (the tool dispatcher) are responsible for classifying the command and
 * gating SENSITIVE/DANGEROUS commands through approval/blocking BEFORE
 * calling this - this function assumes it has already been cleared to run,
 * but re-checks for BLOCKED as a defense-in-depth backstop.
 */
export function runCommand(
  workspaceRoot: string,
  command: string,
  timeoutMs: number
): Promise<CommandResult> {
  const classification = classifyCommand(command, workspaceRoot);
  if (classification.level === "BLOCKED") {
    return Promise.resolve({
      command,
      exitCode: null,
      stdout: "",
      stderr: `Command blocked: ${classification.reason}`,
      durationMs: 0,
      timedOut: false,
    });
  }

  const start = Date.now();
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          // Minimal, predictable environment - never pass through the
          // platform's full process.env (which may contain API keys/
          // session secrets) to an agent-initiated shell command.
          PATH: process.env.PATH,
          HOME: workspaceRoot,
          LANG: "C.UTF-8",
          CI: "true",
        },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const timedOut = !!error && (error as any).killed && (error as any).signal === "SIGTERM";
        resolve({
          command,
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: truncate(stdout?.toString() || ""),
          stderr: truncate(stderr?.toString() || ""),
          durationMs,
          timedOut,
        });
      }
    );
    // exec already enforces `timeout`, but guard against hung stdio streams
    child.on("error", () => {
      /* resolved in the exec callback above */
    });
  });
}
