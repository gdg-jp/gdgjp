declare global {
  interface Env {
    RP_SESSION_SECRET: string;
    IDP_CLIENT_SECRET: string;
    STAGING_SLOT?: string;
    GEMINI_API_KEY: string;
    GOOGLE_DOCS_CLIENT_ID: string;
    GOOGLE_DOCS_CLIENT_SECRET: string;
    GOOGLE_PICKER_API_KEY: string;
    GOOGLE_CLOUD_PROJECT_NUMBER: string;
    RESEND_API_KEY: string;
    WIKI_DISCORD_SECRET: string;
    FCM_SERVICE_ACCOUNT_JSON: string;
    DISCORD_BOT_TOKEN: string;
    DISCORD_CLIENT_ID: string;
    DISCORD_CLIENT_SECRET: string;
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
