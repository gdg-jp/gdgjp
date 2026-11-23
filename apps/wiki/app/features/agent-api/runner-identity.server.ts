import { type BearerIdentity, getBearerIdentity } from "@gdgjp/gdg-lib";

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

export async function getCliOrRunnerIdentity(
  request: Request,
  env: Env,
): Promise<(BearerIdentity & { isRunner: boolean }) | null> {
  if (isRunnerRequest(request, env)) return { ...runnerIdentity(), isRunner: true };
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  return identity ? { ...identity, isRunner: false } : null;
}
