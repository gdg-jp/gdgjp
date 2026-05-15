// Augments the wrangler-generated `Env` with secrets and the AppLoadContext
// shape used by react-router. `wrangler types` only types vars + bindings;
// secrets (set via `wrangler secret put`) must be declared by hand.

declare global {
  interface Env {
    // Secrets (set via `wrangler secret put`)
    BETTER_AUTH_SECRET: string;
    IDP_CLIENT_SECRET: string;
    GEMINI_API_KEY: string;
    GOOGLE_DOCS_CLIENT_ID: string;
    GOOGLE_DOCS_CLIENT_SECRET: string;
    RESEND_API_KEY: string;
    WIKI_DISCORD_SECRET: string;
    FCM_SERVICE_ACCOUNT_JSON: string;
    DISCORD_BOT_TOKEN: string;
  }
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

export {};
