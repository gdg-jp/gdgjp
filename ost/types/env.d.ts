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
    /** HMAC key for the RP's signed session + OIDC transaction cookies. */
    RP_SESSION_SECRET: string;
    /** OAuth client secret issued by the accounts IdP for this RP. */
    IDP_CLIENT_SECRET: string;
  }
}

export {};
