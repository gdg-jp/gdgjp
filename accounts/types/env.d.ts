// Augments the wrangler-generated Env with secrets, and registers the
// AppLoadContext shape consumed by react-router.

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

declare global {
  interface Env {
    GOOGLE_CLIENT_SECRET: string;
    TINYURL_CLIENT_SECRET: string;
    WIKI_CLIENT_SECRET: string;
    IMG_CLIENT_SECRET: string;
    SCHEDULER_CLIENT_SECRET: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    /**
     * HMAC key for signing the IdP login-session cookie. Set via
     * `wrangler secret put IDP_SESSION_SECRET`; the wrangler.toml [vars]
     * entry is a placeholder so cf-typegen exposes the property.
     */
    IDP_SESSION_SECRET: string;
  }
}

export {};
