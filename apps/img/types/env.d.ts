declare global {
  interface Env {
    // HMAC key for the openid-client RP factory's signed session + OIDC
    // transaction cookies. Generate with `openssl rand -base64 48`.
    RP_SESSION_SECRET: string;
    // OAuth client secret issued by the accounts IdP for this RP.
    IDP_CLIENT_SECRET: string;
    /** 0 disables automatic resizing while preserving format negotiation. */
    IMG_AUTO_MAX_WIDTH: string;
  }
}

export {};
