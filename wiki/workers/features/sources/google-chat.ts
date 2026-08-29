/**
 * Barrel for the Google Chat source integration. Split by "reason to read":
 * `google-chat-normalize.ts` (pure: messages.list payload → weekly Markdown) and
 * `google-chat-client.ts` (network: messages.list paging, thread-parent fetches,
 * error logging).
 */
export * from "./google-chat-normalize";
export * from "./google-chat-client";
