declare global {
  interface Env {
    // HMAC key for the openid-client RP factory's signed session + OIDC
    // transaction cookies. The variable name is historical (it was the
    // better-auth secret pre-PR-2); the value is now just an HMAC key.
    BETTER_AUTH_SECRET: string;
    // OAuth client secret issued by the accounts IdP for this RP.
    IDP_CLIENT_SECRET: string;
  }
}

export {};
