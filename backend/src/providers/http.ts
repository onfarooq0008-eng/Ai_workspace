import { HealthCheckResult } from "./types";

export class ProviderHttpError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
    this.status = status;
  }
}

export function healthFromError(err: unknown, latencyMs: number): HealthCheckResult {
  if (err instanceof ProviderHttpError) {
    if (err.status === 401 || err.status === 403) return { status: "invalid_key", latencyMs, error: err.message };
    if (err.status === 429) return { status: "rate_limited", latencyMs, error: err.message };
    if (err.status === 404 || err.status === 400) return { status: "model_unavailable", latencyMs, error: err.message };
  }
  return { status: "error", latencyMs, error: (err as Error).message };
}

/** Reads a fetch response body as an SSE stream, invoking onData for each `data:` payload. */
export async function readSse(body: NodeJS.ReadableStream, onData: (payload: string, eventName?: string) => void): Promise<void> {
  let buffer = "";
  await new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        let eventName: string | undefined;
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) onData(dataLines.join("\n"), eventName);
      }
    });
    body.on("end", () => resolve());
    body.on("error", reject);
  });
}
