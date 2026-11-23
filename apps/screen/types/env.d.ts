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
    STAGING_SLOT?: string;
    REALTIME_APP_TOKEN: string;
  }
}

export {};
