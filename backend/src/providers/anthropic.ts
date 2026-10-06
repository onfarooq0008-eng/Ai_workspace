import fetch from "node-fetch";
import { AIProvider, ChatRequest, ChatResult, HealthCheckResult, ProviderCredentials, estimateTokens } from "./types";
import { ProviderHttpError, healthFromError, readSse } from "./http";

export class AnthropicProvider implements AIProvider {
  readonly type = "anthropic";

  private root(baseUrl: string): string {
    return (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1\/messages$/, "").replace(/\/v1$/, "");
  }
  private headers(creds: ProviderCredentials) {
    return { "Content-Type": "application/json", "x-api-key": creds.apiKey, "anthropic-version": "2023-06-01" };
  }
  private payload(creds: ProviderCredentials, req: ChatRequest, stream: boolean) {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = req.messages.filter((m) => m.role !== "system");
    return JSON.stringify({ model: creds.model, system: system || undefined, messages: rest, max_tokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.3, stream });
  }

  async chat(creds: ProviderCredentials, req: ChatRequest): Promise<ChatResult> {
    const res = await fetch(`${this.root(creds.baseUrl)}/v1/messages`, { method: "POST", headers: this.headers(creds), body: this.payload(creds, req, false) });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    const content = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { content, inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens, raw: data };
  }

  async stream(creds: ProviderCredentials, req: ChatRequest, onToken: (chunk: string) => void): Promise<ChatResult> {
    const res = await fetch(`${this.root(creds.baseUrl)}/v1/messages`, { method: "POST", headers: this.headers(creds), body: this.payload(creds, req, true) });
    if (!res.ok || !res.body) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    let full = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    await readSse(res.body as any, (payload) => {
      try {
        const j = JSON.parse(payload);
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) { full += j.delta.text; onToken(j.delta.text); }
        if (j.type === "message_start") inputTokens = j.message?.usage?.input_tokens;
        if (j.type === "message_delta") outputTokens = j.usage?.output_tokens;
        if (j.type === "error") throw new Error(j.error?.message || "Anthropic stream error");
      } catch (e) { if ((e as Error).message.includes("stream error") || (e as Error).message.includes("Overloaded")) throw e; }
    });
    return { content: full, inputTokens, outputTokens };
  }

  async healthCheck(creds: ProviderCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const r = await this.chat(creds, { messages: [{ role: "user", content: "Reply with the single word: OK" }], maxTokens: 8, temperature: 0 });
      const latencyMs = Date.now() - start;
      return r.content ? { status: "connected", latencyMs } : { status: "model_unavailable", latencyMs, error: "Empty response" };
    } catch (err) {
      return healthFromError(err, Date.now() - start);
    }
  }

  countTokens(text: string) { return estimateTokens(text); }

  async listModels(creds: ProviderCredentials): Promise<string[]> {
    const res = await fetch(`${this.root(creds.baseUrl)}/v1/models?limit=100`, { headers: this.headers(creds) });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    return (data?.data || []).map((m: any) => String(m.id));
  }

  supportsTools() { return true; }
  supportsVision() { return true; }
}
