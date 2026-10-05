declare global {
  interface Env {
    RP_SESSION_SECRET: string;
    IDP_CLIENT_SECRET: string;
    X_CLIENT_ID: string;
    X_CLIENT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    GOOGLE_PHOTOS_IMPORT_TOKEN: string;
    GITHUB_ACTIONS_DISPATCH_TOKEN: string;
  }
}
export {};
