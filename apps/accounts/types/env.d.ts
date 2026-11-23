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
    GOOGLE_WORKSPACE_ENCRYPTION_KEY: string;
    TINYURL_CLIENT_SECRET: string;
    WIKI_CLIENT_SECRET: string;
    IMG_CLIENT_SECRET: string;
    SCHEDULER_CLIENT_SECRET: string;
    SNS_CLIENT_SECRET: string;
    AGENTS_CLIENT_SECRET: string;
    PAY_CLIENT_SECRET: string;
    OST_CLIENT_SECRET: string;
    ROSTER_CLIENT_SECRET: string;
    MC_CLIENT_SECRET: string;
    SCREEN_CLIENT_SECRET: string;
    DECK_CLIENT_SECRET: string;
    ROULETTE_CLIENT_SECRET: string;
    PR_CLIENT_SECRET: string;
    MCP_CLIENT_SECRET: string;
    MEET_CLIENT_SECRET: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    BETTER_AUTH_SECRET: string;
    E2E_TEST_MODE?: string;
  }
}

export {};
