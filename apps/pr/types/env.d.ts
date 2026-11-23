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
    RUNNER_TOKEN: string;
    SETTINGS_ENCRYPTION_KEY: string;
    PR_RENDER_URL?: string;
  }
  const __PLAYBOOK_VERSION__: string;
}

export {};
