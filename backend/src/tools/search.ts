import fetch from "node-fetch";
import { getSetting, getSearchApiKey } from "../runtimeConfig";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Abstraction so the research tool is not tied to one search vendor (spec section 27). */
export interface SearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

/** Normalizes the many shapes search APIs return into SearchResult[]. */
export function normalizeSearchResults(data: any, limit: number): SearchResult[] {
  const arr: any[] = Array.isArray(data) ? data : data?.results ?? data?.items ?? data?.web?.results ?? data?.organic ?? data?.data ?? [];
  return (Array.isArray(arr) ? arr : [])
    .slice(0, limit)
    .map((r) => ({
      title: String(r.title ?? r.name ?? ""),
      url: String(r.url ?? r.link ?? r.href ?? ""),
      snippet: String(r.snippet ?? r.description ?? r.content ?? r.text ?? "").slice(0, 500),
    }))
    .filter((r) => r.url || r.title);
}

/** Generic HTTP+JSON search provider configured from Settings → Research. */
export class HttpJsonSearchProvider implements SearchProvider {
  readonly name = "http-json";
  isConfigured() { return !!getSetting("search_api_url"); }
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const template: string = getSetting("search_api_url");
    if (!template) throw new Error("No search provider configured. Set a Search API URL in Settings → Research.");
    const url = template.replace("{query}", encodeURIComponent(query)).replace("{limit}", String(limit));
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = getSearchApiKey();
    if (key) {
      const header = getSetting("search_auth_header") || "Authorization";
      headers[header] = header.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Search API returned HTTP ${res.status}`);
    return normalizeSearchResults(await res.json(), limit);
  }
}

const providers: SearchProvider[] = [new HttpJsonSearchProvider()];
export function registerSearchProvider(p: SearchProvider) { providers.unshift(p); }
export function activeSearchProvider(): SearchProvider | undefined { return providers.find((p) => p.isConfigured()); }
