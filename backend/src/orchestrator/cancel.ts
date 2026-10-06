const cancelled = new Set();
export class CancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}
export const requestCancel = (chatId: string) => void cancelled.add(chatId);
export const isCancelled = (chatId: string) => cancelled.has(chatId);
export const clearCancel = (chatId: string) => void cancelled.delete(chatId);
