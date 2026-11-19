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
    /** 共有 Google ホストアカウント接続用の OAuth 2.0 クライアントシークレット。 */
    GOOGLE_CLIENT_SECRET: string;
    /** Google リフレッシュトークンを暗号化する AES-GCM 256-bit 鍵（32 byte base64）。 */
    GOOGLE_TOKEN_ENCRYPTION_KEY: string;
  }
}

export {};
