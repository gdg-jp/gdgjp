declare global {
  interface Env {
    CONNPASS_BOT_EMAIL?: string;
    CONNPASS_BOT_PASSWORD?: string;
    SESSION_ENCRYPTION_KEY?: string;
  }
}
export {};
