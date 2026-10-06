import fetch from "node-fetch";
import { AIProvider, ChatRequest, ChatResult, HealthCheckResult, ProviderCredentials, estimateTokens } from "./types";
import { ProviderHttpError, healthFromError, readSse } from "./http";

/** Google Gemini (Generative Language API) adapter. */
export class GoogleProvider implements AIProvider {
  readonly type = "google";

  private root(baseUrl: string) {
    return (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  }
  private payload(req: ChatRequest) {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature: req.temperature ?? 0.3, maxOutputTokens: req.maxTokens ?? 4096 },
    });
  }
  private text(data: any): string {
    return (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
  }

  async chat(creds: ProviderCredentials, req: ChatRequest): Promise<ChatResult> {
    const url = `${this.root(creds.baseUrl)}/models/${encodeURIComponent(creds.model)}:generateContent`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": creds.apiKey }, body: this.payload(req) });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    return { content: this.text(data), inputTokens: data?.usageMetadata?.promptTokenCount, outputTokens: data?.usageMetadata?.candidatesTokenCount, raw: data };
  }

  async stream(creds: ProviderCredentials, req: ChatRequest, onToken: (chunk: string) => void): Promise<ChatResult> {
    const url = `${this.root(creds.baseUrl)}/models/${encodeURIComponent(creds.model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": creds.apiKey }, body: this.payload(req) });
    if (!res.ok || !res.body) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    let full = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    await readSse(res.body as any, (payload) => {
      try {
        const j = JSON.parse(payload);
        const t = this.text(j);
        if (t) { full += t; onToken(t); }
        if (j?.usageMetadata) { inputTokens = j.usageMetadata.promptTokenCount; outputTokens = j.usageMetadata.candidatesTokenCount; }
      } catch { /* ignore */ }
    });
    return { content: full, inputTokens, outputTokens };
  }

  async healthCheck(creds: ProviderCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const r = await this.chat(creds, { messages: [{ role: "user", content: "Reply with the single word: OK" }], maxTokens: 16, temperature: 0 });
      const latencyMs = Date.now() - start;
      return r.content ? { status: "connected", latencyMs } : { status: "model_unavailable", latencyMs, error: "Empty response" };
    } catch (err) {
      return healthFromError(err, Date.now() - start);
    }
  }

  countTokens(text: string) { return estimateTokens(text); }

  async listModels(creds: ProviderCredentials): Promise<string[]> {
    const res = await fetch(`${this.root(creds.baseUrl)}/models?pageSize=200`, { headers: { "x-goog-api-key": creds.apiKey } });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    return (data?.models || []).map((m: any) => String(m.name).replace(/^models\//, ""));
  }

  supportsTools() { return true; }
  supportsVision() { return true; }
}
