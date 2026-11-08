/** Bindings and secrets of gdgjp-agent. Deliberately no AI binding and no LLM keys. */
export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  WIKI: Fetcher;
  PENDING: DurableObjectNamespace;
  APP_URL: string;
  ACCOUNTS_URL: string;
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEYS: string;
  AGENT_SERVICE_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  /** Shared with `gdg agent discord-gateway` on the OCI VM, which forwards @mentions and DMs. */
  GATEWAY_TOKEN?: string;
  GOOGLE_CHAT_AUDIENCE?: string;
  /** Service account JSON for posting answers with the Chat API. */
  GOOGLE_CHAT_CREDENTIALS?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
  TELEMETRY_ID_SALT?: string;
};
