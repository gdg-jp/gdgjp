/**
 * Leave enough time to replace Discord's deferred "thinking" response before
 * Vercel's 300 s function limit can terminate the background task.
 */
export const DISCORD_RESPONSE_TIMEOUT_MS = 240_000;
export const DISCORD_POST_TIMEOUT_MS = 10_000;
export const DISCORD_UNAVAILABLE_MESSAGE =
  "I couldn't complete that request right now. Please try again in a moment.";

export class ResponseDeadlineExceededError extends Error {
  constructor() {
    super("discord_response_deadline_exceeded");
    this.name = "ResponseDeadlineExceededError";
  }
}

/** Bound background work so a deferred Discord interaction is always resolved. */
export function withResponseDeadline<T>(
  operation: Promise<T>,
  timeoutMs = DISCORD_RESPONSE_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ResponseDeadlineExceededError()), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
