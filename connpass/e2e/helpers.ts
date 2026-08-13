import fs from "node:fs";
import path from "node:path";
import { type APIRequestContext, expect } from "@playwright/test";

export const TOKENS = {
  admin: "e2e-admin",
  organizer: "e2e-organizer",
  member: "e2e-member",
  outsider: "e2e-outsider",
} as const;

export const E2E_CHAPTER_ID = "10";

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export function uniqueGroupSlug(prefix = "e2e"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toLowerCase();
}

export function readDevVars(
  filePath = path.join(process.cwd(), ".dev.vars"),
): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function liveConfig(): {
  enabled: boolean;
  hasBotCredentials: boolean;
  groupSlug: string | undefined;
  eventId: string | undefined;
  liveWrites: boolean;
} {
  const vars = readDevVars();
  const env = process.env;
  const hasBotCredentials = Boolean(vars.CONNPASS_BOT_EMAIL && vars.CONNPASS_BOT_PASSWORD);
  return {
    enabled: env.CONNPASS_E2E_LIVE === "1" && hasBotCredentials,
    hasBotCredentials,
    groupSlug: env.CONNPASS_E2E_GROUP_SLUG || vars.CONNPASS_E2E_GROUP_SLUG || undefined,
    eventId: env.CONNPASS_E2E_EVENT_ID || vars.CONNPASS_E2E_EVENT_ID || undefined,
    liveWrites: env.CONNPASS_E2E_LIVE_WRITES === "1",
  };
}

export async function upsertGroup(
  request: APIRequestContext,
  groupSlug: string,
  body: { chapterId?: string | null; enabled?: boolean; numericGroupId?: number | null } = {},
) {
  const response = await request.put(`/api/admin/groups/${groupSlug}`, {
    headers: auth(TOKENS.admin),
    data: {
      chapterId: body.chapterId === undefined ? E2E_CHAPTER_ID : body.chapterId,
      enabled: body.enabled ?? true,
      numericGroupId: body.numericGroupId ?? null,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

type JobJson = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  result: unknown;
  eventId: string | null;
};

export async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  timeoutMs = 180_000,
): Promise<JobJson> {
  const deadline = Date.now() + timeoutMs;
  let last: JobJson | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/jobs/${jobId}`, { headers: auth(TOKENS.admin) });
    expect(response.status(), await response.text()).toBe(200);
    last = (await response.json()) as JobJson;
    if (last.status === "succeeded" || last.status === "failed") return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`job ${jobId} did not finish: ${JSON.stringify(last)}`);
}
