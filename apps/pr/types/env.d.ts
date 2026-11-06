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
    /** The OCI runner's bearer token for /api/runner/* (32+ chars, distinct from the wiki's). */
    RUNNER_TOKEN: string;
    /** Encrypts chapters' Discord webhook URLs at rest (chapter_settings). */
    SETTINGS_ENCRYPTION_KEY: string;
  }
  /** Commit of the skills submodule the bundled Playbook came from (vite define). */
  const __PLAYBOOK_VERSION__: string;
}

export {};
