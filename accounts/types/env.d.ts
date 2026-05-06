declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_SECRET: string;
    TINYURL_CLIENT_SECRET: string;
    WIKI_CLIENT_SECRET: string;
    IMG_CLIENT_SECRET: string;
  }
}

export {};
