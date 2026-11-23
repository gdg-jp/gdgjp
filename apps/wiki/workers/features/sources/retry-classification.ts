import { GOOGLE_CHAT_REAUTH_MESSAGE } from "./google-chat";

export class SourceAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAuthorizationError";
  }
}

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
    if (status === 401 || status === 408 || status === 429) return true;
    return status < 400 || status >= 500;
  }

  return true;
}
