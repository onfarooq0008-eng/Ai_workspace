import { AIProvider } from "./types";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";

// OpenRouter and "custom" speak the OpenAI-compatible protocol, so they reuse that adapter - only base_url differs.
const adapters: Record<string, AIProvider> = {
  openai_compatible: new OpenAICompatibleProvider(),
  openrouter: new OpenAICompatibleProvider(),
  custom: new OpenAICompatibleProvider(),
  anthropic: new AnthropicProvider(),
  google: new GoogleProvider(),
};

export function getAdapter(providerType: string): AIProvider {
  const adapter = adapters[providerType];
  if (!adapter) throw new Error(`No adapter registered for provider_type "${providerType}". Known types: ${Object.keys(adapters).join(", ")}`);
  return adapter;
}

export function registerAdapter(providerType: string, adapter: AIProvider) {
  adapters[providerType] = adapter;
}

export const PROVIDER_TYPES = Object.keys(adapters);
