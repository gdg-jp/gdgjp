import type { FetchLike } from "./tools/wiki";

export type WikiWriteContext = {
  accessToken: string;
  wikiApiUrl: string;
  fetch?: FetchLike;
};

export type PostNoteInput = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  citedPaths: string[];
  replaceId?: string;
};

export type PostNoteResult =
  | {
      ok: true;
      status: number;
      body: {
        id: string;
        slug: string;
        path: string;
        pageUrl: string;
        created: boolean;
      };
    }
  | { ok: false; status: number; error: string; path?: string };

export type PostLogEntryInput = {
  subject: string;
  lines: string[];
};

export type FilingInstructions = {
  profile: "query";
  content: string;
  contentHash: string;
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

/**
 * Plain HTTP clients for the filing pass — deliberately not AI SDK tools, so
 * nothing here can be spread into the answer loop's tool set by accident.
 */
export async function postNote(
  ctx: WikiWriteContext,
  input: PostNoteInput,
): Promise<PostNoteResult> {
  const fetchImpl = ctx.fetch ?? fetch;
  const response = await fetchImpl(`${trimSlash(ctx.wikiApiUrl)}/api/agent/notes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (response.ok && body && typeof body === "object") {
    return {
      ok: true,
      status: response.status,
      body: body as PostNoteResult extends { ok: true; body: infer B } ? B : never,
    };
  }
  const error =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "request_failed";
  const path =
    body && typeof body === "object" && "path" in body && typeof body.path === "string"
      ? body.path
      : undefined;
  return { ok: false, status: response.status, error, ...(path ? { path } : {}) };
}

export async function postLogEntry(
  ctx: WikiWriteContext,
  input: PostLogEntryInput,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const fetchImpl = ctx.fetch ?? fetch;
  const response = await fetchImpl(`${trimSlash(ctx.wikiApiUrl)}/api/agent/log`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (response.status === 204 || response.ok) return { ok: true };
  const body = await readJson(response);
  const error =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "request_failed";
  return { ok: false, status: response.status, error };
}

/**
 * Filing instructions are identical for every caller (keyed by contentHash).
 * Caching here is fine — it is not the per-user page-content caching Stage 5e
 * forbids.
 */
const instructionsCache = new Map<string, { expiresAt: number; value: FilingInstructions }>();
const INSTRUCTIONS_TTL_MS = 60_000;

export async function fetchFilingInstructions(
  ctx: WikiWriteContext,
): Promise<
  { ok: true; instructions: FilingInstructions } | { ok: false; status: number; error: string }
> {
  const cached = [...instructionsCache.values()].find((entry) => entry.expiresAt > Date.now());
  if (cached) return { ok: true, instructions: cached.value };

  const fetchImpl = ctx.fetch ?? fetch;
  const response = await fetchImpl(
    `${trimSlash(ctx.wikiApiUrl)}/api/agent/instructions?profile=query`,
    {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
      },
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "instructions_unavailable";
    return { ok: false, status: response.status, error };
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("content" in body) ||
    typeof body.content !== "string" ||
    !("contentHash" in body) ||
    typeof body.contentHash !== "string"
  ) {
    return { ok: false, status: 503, error: "instructions_unavailable" };
  }
  const instructions: FilingInstructions = {
    profile: "query",
    content: body.content,
    contentHash: body.contentHash,
  };
  instructionsCache.set(instructions.contentHash, {
    expiresAt: Date.now() + INSTRUCTIONS_TTL_MS,
    value: instructions,
  });
  return { ok: true, instructions };
}

/** Test-only: clear the in-process instructions cache. */
export function clearFilingInstructionsCacheForTests(): void {
  instructionsCache.clear();
}
