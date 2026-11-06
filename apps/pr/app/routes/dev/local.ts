const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Dev-only routes answer on a loopback URL of a development Worker, never in production. */
export const isLocalDev = (env: Env, request: Request) =>
  env.ENVIRONMENT === "development" && LOOPBACK.has(new URL(request.url).hostname);
