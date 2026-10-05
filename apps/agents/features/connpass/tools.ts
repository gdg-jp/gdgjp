import { tool } from "ai";
import { z } from "zod";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ConnpassToolContext = {
  accessToken: string;
  connpassApiUrl: string;
  fetch?: FetchLike;
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function connpassRequest(
  ctx: ConnpassToolContext,
  path: string,
  init?: RequestInit,
): Promise<
  { ok: true; status: number; body: unknown } | { ok: false; status: number; error: string }
> {
  const fetchImpl = ctx.fetch ?? fetch;
  const response = await fetchImpl(`${trimSlash(ctx.connpassApiUrl)}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "request_failed";
    return { ok: false, status: response.status, error: code };
  }
  return { ok: true, status: response.status, body };
}

/**
 * Connpass admin tools for the Chat agent.
 * Uses the linked user's Bearer token. Caller must be a chapter organizer
 * (or platform admin) for write operations on allowlisted groups.
 */
export function createConnpassTools(ctx: ConnpassToolContext) {
  const connpass_list_events = tool({
    description:
      "List events for an allowlisted connpass group (read-only via official API). groupId is the connpass group slug such as gdg-tokyo.",
    inputSchema: z.object({
      groupId: z.string().describe("Connpass group slug or numeric id"),
    }),
    execute: async ({ groupId }, { abortSignal }) => {
      const result = await connpassRequest(
        ctx,
        `/api/groups/${encodeURIComponent(groupId)}/events`,
        {
          signal: abortSignal,
        },
      );
      if (!result.ok) return { error: result.error, status: result.status };
      return result.body;
    },
  });

  const connpass_create_event = tool({
    description:
      "Create a connpass event draft for an allowlisted group. Returns an async job; poll with connpass_get_job. Requires chapter organizer (or admin).",
    inputSchema: z.object({
      groupId: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      place: z.string().optional(),
      address: z.string().optional(),
      capacity: z.number().int().positive().optional(),
    }),
    execute: async (input, { abortSignal }) => {
      const { groupId, ...body } = input;
      const result = await connpassRequest(
        ctx,
        `/api/groups/${encodeURIComponent(groupId)}/events`,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: abortSignal,
        },
      );
      if (!result.ok) return { error: result.error, status: result.status };
      return result.body;
    },
  });

  const connpass_publish_event = tool({
    description:
      "Publish a connpass event. Returns an async job; poll with connpass_get_job. Requires chapter organizer (or admin).",
    inputSchema: z.object({
      groupId: z.string(),
      eventId: z.string(),
    }),
    execute: async ({ groupId, eventId }, { abortSignal }) => {
      const result = await connpassRequest(
        ctx,
        `/api/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/publish`,
        { method: "POST", body: "{}", signal: abortSignal },
      );
      if (!result.ok) return { error: result.error, status: result.status };
      return result.body;
    },
  });

  const connpass_get_job = tool({
    description: "Get status/result of a connpass async job returned by create/publish tools.",
    inputSchema: z.object({
      jobId: z.string(),
    }),
    execute: async ({ jobId }, { abortSignal }) => {
      const result = await connpassRequest(ctx, `/api/jobs/${encodeURIComponent(jobId)}`, {
        signal: abortSignal,
      });
      if (!result.ok) return { error: result.error, status: result.status };
      return result.body;
    },
  });

  return {
    connpass_list_events,
    connpass_create_event,
    connpass_publish_event,
    connpass_get_job,
  };
}

export type ConnpassTools = ReturnType<typeof createConnpassTools>;
