import { type BearerIdentity, getBearerIdentity } from "@gdgjp/gdg-lib";

/**
 * The OCI runner (Stage 04) authenticates with the `RUNNER_TOKEN` secret instead of an
 * OAuth token. It reads every space at full clearance and writes only through `/sync`
 * (agent pages) and `/api/runner/*`; every other route keeps using getBearerIdentity and
 * so rejects it (tests/architecture/runner-identity-routes.test.ts).
 */
export const RUNNER_USER_ID = "runner";

export function runnerIdentity(): BearerIdentity {
  return {
    user: {
      id: RUNNER_USER_ID,
      email: "runner@wiki.gdgs.jp",
      name: "Knowledge Runner",
      image: null,
      isAdmin: true,
    },
    chapters: [],
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isRunnerRequest(request: Request, env: Env): boolean {
  const secret = (env as unknown as { RUNNER_TOKEN?: string }).RUNNER_TOKEN;
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return !!match?.[1] && timingSafeEqual(match[1].trim(), secret);
}

/** Bearer identity for the CLI routes the runner may use: runner token, else OAuth. */
export async function getCliOrRunnerIdentity(
  request: Request,
  env: Env,
): Promise<(BearerIdentity & { isRunner: boolean }) | null> {
  if (isRunnerRequest(request, env)) return { ...runnerIdentity(), isRunner: true };
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  return identity ? { ...identity, isRunner: false } : null;
}
