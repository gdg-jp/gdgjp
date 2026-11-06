import { isRunnerRequest } from "~/features/agent-api/runner-identity.server";

/** 401 unless the request carries RUNNER_TOKEN. Every /api/runner/* route calls this. */
export function requireRunner(request: Request, env: Env): void {
  if (!isRunnerRequest(request, env)) {
    throw Response.json({ error: "invalid_token" }, { status: 401 });
  }
}

export function runnerHost(request: Request): string {
  return (request.headers.get("x-runner-host") ?? "unknown").slice(0, 100);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  return (await request.json().catch(() => null)) as T | null;
}
