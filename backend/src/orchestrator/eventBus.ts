import { EventEmitter } from "events";

export interface BusEvent {
  id: number;
  ts: string;
  event: string;
  canonical: string[];
  data: any;
}

/** Maps the UI-facing event names onto the canonical event vocabulary from spec section 75. */
export function canonicalNames(event: string, data: any): string[] {
  const out: string[] = [];
  const role = data?.role;
  const cmd: string = data?.command || "";
  const isBuild = /\b(build|compile|assemble|gradle|tsc|make)\b/i.test(cmd);
  switch (event) {
    case "plan_created": out.push("task.created"); break;
    case "task_status":
      if (data.status === "RUNNING") out.push("task.started");
      if (data.status === "COMPLETED") out.push("task.completed");
      if (data.status === "FAILED") out.push("task.failed");
      if (role === "reviewer" || role === "security_reviewer" || role === "accessibility_reviewer") {
        if (data.status === "RUNNING") out.push("review.started");
        if (data.status === "COMPLETED") out.push("review.completed");
      }
      break;
    case "agent_status": if (data.status === "working") out.push("worker.started"); break;
    case "worker_output": out.push("worker.completed"); break;
    case "tool_started":
      out.push("tool.started");
      if (isBuild) out.push("build.started");
      break;
    case "tool_completed":
      out.push("tool.completed");
      if (isBuild) out.push(data.exitCode === 0 ? "build.success" : "build.failed");
      break;
    case "provider_error": out.push("provider.error"); break;
    case "provider_fallback": out.push("provider.fallback"); break;
  }
  return out;
}

class Bus extends EventEmitter {
  private seq = 0;
  private buf: BusEvent[] = [];
  publish(event: string, data: any): BusEvent {
    const ev: BusEvent = { id: ++this.seq, ts: new Date().toISOString(), event, canonical: canonicalNames(event, data), data };
    this.buf.push(ev);
    if (this.buf.length > 500) this.buf.shift();
    this.emit("event", ev);
    return ev;
  }
  get lastId(): number {
    return this.seq;
  }
  since(id: number): BusEvent[] {
    return this.buf.filter((e) => e.id > id);
  }
}

export const eventBus = new Bus();
eventBus.setMaxListeners(200);
