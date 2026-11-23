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
    RP_SESSION_SECRET: string;
    IDP_CLIENT_SECRET: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_TOKEN_ENCRYPTION_KEY: string;
  }
}

export {};
