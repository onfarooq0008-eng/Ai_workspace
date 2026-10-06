import { Router } from "express";
import { eventBus, BusEvent } from "../orchestrator/eventBus";
import { listActiveRuns } from "../orchestrator/teamRunner";
import { listActiveTasks } from "../db/tasks";
import { listPendingApprovals } from "../db/approvals";

export const eventsRouter = Router();

/** Global live event stream (Server-Sent Events). Powers the Office view, live terminal, and cross-device progress. */
eventsRouter.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.on("error", () => {});
  const last = Number(req.get("last-event-id") || req.query.since || 0);
  const write = (ev: BusEvent) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  if (last > 0) eventBus.since(last).forEach(write);
  else res.write(`data: ${JSON.stringify({ id: eventBus.lastId, ts: new Date().toISOString(), event: "hello", canonical: [], data: {} })}\n\n`);
  eventBus.on("event", write);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 20000);
  req.on("close", () => { clearInterval(heartbeat); eventBus.off("event", write); });
});

/** Snapshot of what is happening right now, so a freshly loaded page starts from the true state (never a fake one). */
eventsRouter.get("/snapshot", (_req, res) => {
  res.json({ runs: listActiveRuns(), activeTasks: listActiveTasks(), pendingApprovals: listPendingApprovals(), lastEventId: eventBus.lastId });
});

eventsRouter.get("/recent", (req, res) => {
  res.json(eventBus.since(Math.max(0, eventBus.lastId - Math.min(300, Number(req.query.limit) || 100))));
});
