const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Dev-only routes answer on a loopback URL of a non-production Worker, never in production.
 * `wrangler types` types ENVIRONMENT as the `[vars]` literal "production", so compare against
 * that value (as the rest of the app does) instead of `.dev.vars`' "development".
 */
export const isLocalDev = (env: Env, request: Request) =>
  env.ENVIRONMENT !== "production" && LOOPBACK.has(new URL(request.url).hostname);
