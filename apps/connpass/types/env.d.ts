declare global {
  interface Env {
    CONNPASS_BOT_EMAIL?: string;
    CONNPASS_BOT_PASSWORD?: string;
    SESSION_ENCRYPTION_KEY?: string;
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

interface ImportMetaEnv {
  readonly CONNPASS_E2E_ACCOUNTS_URL?: string;
}

export {};
