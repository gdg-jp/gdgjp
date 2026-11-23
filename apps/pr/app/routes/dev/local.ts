const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const isLocalDev = (env: Env, request: Request) =>
  env.ENVIRONMENT !== "production" && LOOPBACK.has(new URL(request.url).hostname);
