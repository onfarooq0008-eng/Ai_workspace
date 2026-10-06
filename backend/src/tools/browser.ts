/**
 * Extension point for browser automation (spec section 28). Not implemented in v1 and deliberately not exposed to
 * any worker role. A future implementation (e.g. Playwright-based) registers itself via setBrowserTool().
 */
export interface BrowserTool {
  open_url(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  extract_text(selector?: string): Promise<string>;
}

let impl: BrowserTool | null = null;
export function setBrowserTool(tool: BrowserTool) { impl = tool; }
export function getBrowserTool(): BrowserTool {
  if (!impl) throw new Error("Browser automation is not installed in this version.");
  return impl;
}
