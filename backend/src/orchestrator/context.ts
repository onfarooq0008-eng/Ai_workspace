import { db } from "../db";
import { listMessages } from "../db/chats";
import { getProjectContext } from "../db/memory";
import { callModelForRole } from "./callModel";

type Msg = { role: "system" | "user" | "assistant"; content: string };

const KEEP_RECENT = 12; // messages kept verbatim
const SUMMARIZE_WHEN_OVER = 30; // un-summarized messages before we compress older ones

function toModelRole(r: string): "user" | "assistant" {
  return r === "user" ? "user" : "assistant";
}

/**
 * Builds the message list for a plain chat reply without blindly sending the whole conversation (spec sections
 * 20-21): system prompt + project/user memory + a rolling summary of older turns + the most recent turns.
 * When too many un-summarized turns pile up, the Manager summarizes the older ones and the summary is persisted.
 */
export async function buildChatMessages(chat: { id: string; project_id: string | null }, systemPrompt: string): Promise<Msg[]> {
  const all = (listMessages(chat.id) as any[]).filter((m) => m.role !== "error" && m.role !== "system");
  const sum = db.prepare("SELECT summary, upto_rowid FROM chat_summaries WHERE chat_id = ?").get(chat.id) as { summary: string; upto_rowid: number } | undefined;
  let summary = sum?.summary || "";
  let uptoRowid = sum?.upto_rowid || 0;
  let live = all.filter((m) => m.rid > uptoRowid);

  if (live.length > SUMMARIZE_WHEN_OVER) {
    const older = live.slice(0, live.length - KEEP_RECENT);
    try {
      const transcript = older.map((m) => `${m.role}${m.agent_name ? `(${m.agent_name})` : ""}: ${m.content}`).join("\n").slice(0, 24000);
      const res = await callModelForRole(
        "manager",
        [
          { role: "system", content: "You compress conversations. Produce a concise factual summary (max 250 words) preserving decisions, requirements, file names, and open questions." },
          { role: "user", content: `${summary ? `Existing summary:\n${summary}\n\n` : ""}New conversation to fold in:\n${transcript}` },
        ],
        { chatId: chat.id, projectId: chat.project_id ?? undefined, agent: "manager" }
      );
      summary = res.content.trim();
      uptoRowid = older[older.length - 1].rid;
      db.prepare("INSERT INTO chat_summaries (chat_id, summary, upto_rowid) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary, upto_rowid = excluded.upto_rowid, updated_at = datetime('now')").run(chat.id, summary, uptoRowid);
      live = all.filter((m) => m.rid > uptoRowid);
    } catch {
      live = live.slice(-SUMMARIZE_WHEN_OVER); // summarization failed: fall back to a hard cut rather than failing the reply
    }
  }

  const ctxBlock = getProjectContext(chat.project_id);
  const system = [systemPrompt, ctxBlock, summary ? `Summary of earlier conversation:\n${summary}` : ""].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, ...live.map((m) => ({ role: toModelRole(m.role), content: m.content }))];
}
