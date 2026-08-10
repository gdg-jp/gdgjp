import { GOOGLE_CHAT_REAUTH_MESSAGE } from "./google-chat";

/** A permanent OAuth grant failure that requires explicit user action. */
export class SourceAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAuthorizationError";
  }
}

/**
 * Classify a failure so the queue consumer / DO alarm knows whether to retry.
 *
 * Google helpers put the HTTP status in their message, which is the only signal
 * available without rewriting them. Anything unrecognized is treated as transient:
 * a spurious retry is cheap, whereas giving up on a real network blip loses the fetch.
 */
export function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof SourceAuthorizationError) return false;
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("Google Drive is not connected") ||
    message.includes(GOOGLE_CHAT_REAUTH_MESSAGE) ||
    message.includes("Google Chat scopes are missing") ||
    message.includes("Unsupported Google Workspace URL") ||
    message.startsWith("Unsupported source kind") ||
    message.includes("invalid image type") ||
    message.includes("exceeds the 10 MB limit")
  ) {
    return false;
  }

  const status = Number(/\((\d{3})\)/.exec(message)?.[1]);
  if (!Number.isNaN(status)) {
    if (status === 408 || status === 429) return true;
    return status < 400 || status >= 500;
  }

  return true;
}
