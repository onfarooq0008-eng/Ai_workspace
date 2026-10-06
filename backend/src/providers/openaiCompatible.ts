import fetch from "node-fetch";
import { AIProvider, ChatRequest, ChatResult, HealthCheckResult, ProviderCredentials, estimateTokens } from "./types";
import { ProviderHttpError, healthFromError, readSse } from "./http";

export { ProviderHttpError };

/**
 * Works with any API that implements the OpenAI chat/completions contract: NVIDIA NIM, OpenRouter, Groq, Together,
 * local OpenAI-compatible servers, etc. The user only supplies base_url + api_key + model.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly type = "openai_compatible";

  private base(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  }
  private headers(creds: ProviderCredentials) {
    return { "Content-Type": "application/json", Authorization: `Bearer ${creds.apiKey}` };
  }
  private body(creds: ProviderCredentials, req: ChatRequest, stream: boolean) {
    return JSON.stringify({ model: creds.model, messages: req.messages, temperature: req.temperature ?? 0.3, max_tokens: req.maxTokens ?? 4096, stream });
  }

  async chat(creds: ProviderCredentials, req: ChatRequest): Promise<ChatResult> {
    const res = await fetch(`${this.base(creds.baseUrl)}/chat/completions`, { method: "POST", headers: this.headers(creds), body: this.body(creds, req, false) });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content && !data?.choices) throw new Error("Invalid response from provider (no choices)");
    return { content, inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens, raw: data };
  }

  async stream(creds: ProviderCredentials, req: ChatRequest, onToken: (chunk: string) => void): Promise<ChatResult> {
    const res = await fetch(`${this.base(creds.baseUrl)}/chat/completions`, { method: "POST", headers: this.headers(creds), body: this.body(creds, req, true) });
    if (!res.ok || !res.body) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    let full = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    await readSse(res.body as any, (payload) => {
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onToken(delta); }
        if (json?.usage) { inputTokens = json.usage.prompt_tokens; outputTokens = json.usage.completion_tokens; }
      } catch { /* ignore malformed fragment */ }
    });
    return { content: full, inputTokens, outputTokens };
  }

  async healthCheck(creds: ProviderCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const r = await this.chat(creds, { messages: [{ role: "user", content: "Reply with the single word: OK" }], maxTokens: 8, temperature: 0 });
      const latencyMs = Date.now() - start;
      return r.content ? { status: "connected", latencyMs } : { status: "model_unavailable", latencyMs, error: "Empty response from model" };
    } catch (err) {
      return healthFromError(err, Date.now() - start);
    }
  }

  countTokens(text: string) { return estimateTokens(text); }

  async listModels(creds: ProviderCredentials): Promise<string[]> {
    const res = await fetch(`${this.base(creds.baseUrl)}/models`, { headers: this.headers(creds) });
    if (!res.ok) throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    const data: any = await res.json();
    return (data?.data || []).map((m: any) => String(m.id)).sort();
  }

  supportsTools() { return true; }
  supportsVision() { return false; }
}
