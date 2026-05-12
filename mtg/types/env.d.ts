declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    IDP_CLIENT_SECRET: string;
  }
}

export {};
