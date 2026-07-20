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
    /** Better Auth encryption/signing secret. Set with wrangler secret put. */
    BETTER_AUTH_SECRET: string;
  }
}

export {};
