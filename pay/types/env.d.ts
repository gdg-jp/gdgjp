declare global {
  interface Env {
    RP_SESSION_SECRET: string;
    IDP_CLIENT_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    GEMINI_API_KEY: string;
    GOOGLE_OAUTH_CLIENT_SECRET: string;
    GOOGLE_SERVICE_ACCOUNT_JSON: string;
    RESEND_API_KEY: string;
    SHEETS_TEMPLATE_ID: string;
    GEMINI_MODEL_ID: string;
    COMM_SUPPORT_EMAIL: string;
    EMAIL_FROM: string;
    RECEIPTS: R2Bucket;
  }
}

export {};
