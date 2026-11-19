const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Dev-only routes require an explicit development environment and a loopback URL. */
export const isLocalDev = (env: Partial<Pick<Env, "ENVIRONMENT">>, request: Request) =>
  env.ENVIRONMENT === "development" && LOOPBACK.has(new URL(request.url).hostname);
