/**
 * The runner's credential: secret RUNNER_TOKEN (32+ chars, a different value from the wiki's).
 * Accepted only by app/routes/api/runner/* (tests/architecture/runner-identity-routes.test.ts).
 */
export async function requireRunner(request: Request, env: Env): Promise<void> {
  const expected = env.RUNNER_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || expected.length < 32 || !(await equal(token, expected))) {
    throw Response.json({ error: "invalid_runner_token" }, { status: 401 });
  }
}

async function equal(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] as number) ^ (right[i] as number);
  return diff === 0;
}

export function runnerHost(request: Request): string {
  return (request.headers.get("x-runner-host") ?? "unknown").slice(0, 120);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
