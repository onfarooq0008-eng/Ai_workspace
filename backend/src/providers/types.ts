export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResult {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  raw?: unknown;
}

export interface HealthCheckResult {
  status: "connected" | "error" | "rate_limited" | "invalid_key" | "model_unavailable";
  latencyMs?: number;
  error?: string;
}

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Rough token estimate (~4 chars/token) used only when a provider does not report usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

/**
 * Unified interface every provider adapter must implement. Provider-specific request/response translation lives
 * entirely inside the adapter - the rest of the application only talks to this interface (spec section 50).
 */
export interface AIProvider {
  readonly type: string;
  chat(creds: ProviderCredentials, req: ChatRequest): Promise<ChatResult>;
  stream(creds: ProviderCredentials, req: ChatRequest, onToken: (chunk: string) => void): Promise<ChatResult>;
  healthCheck(creds: ProviderCredentials): Promise<HealthCheckResult>;
  countTokens(text: string): number;
  listModels(creds: ProviderCredentials): Promise<string[]>;
  supportsTools(): boolean;
  supportsVision(): boolean;
}
