import { createDomainProvider, listDomainsForChapters, registerDomain } from "~/features/domains";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import { detectCustomDomain } from "~/lib/domain-detection";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.domains";

const INVALID = Symbol("invalid");

function parseIntParam(raw: string | null): number | undefined | typeof INVALID {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : INVALID;
}

function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const offset = Number(atob(cursor));
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function invalidRequest(): Response {
  return cliError("invalid_request", 400);
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const url = new URL(args.request.url);
  const chapterId = parseIntParam(url.searchParams.get("chapterId"));
  if (chapterId === INVALID) return invalidRequest();
  const limit = parseIntParam(url.searchParams.get("limit"));
  if (limit === INVALID || (limit !== undefined && (limit < 1 || limit > 100))) {
    return invalidRequest();
  }
  const pageSize = limit ?? 50;
  const offset = decodeCursor(url.searchParams.get("cursor"));

  const visibleIds = auth.actor.chapters.map((chapter) => chapter.chapterId);
  const all = await listDomainsForChapters(env.DB, visibleIds);
  const filtered =
    chapterId === undefined ? all : all.filter((d) => d.ownerChapterId === chapterId);
  const domains = filtered.slice(offset, offset + pageSize);
  const nextCursor = offset + pageSize < filtered.length ? encodeCursor(offset + pageSize) : null;

  const body: components["schemas"]["DomainList"] = { domains, nextCursor };
  return cliJson(body);
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const { hostname, chapterId } = parsed.value;
  if (typeof hostname !== "string" || typeof chapterId !== "number") {
    return invalidRequest();
  }

  const deps = {
    db: env.DB,
    provider: createDomainProvider(env),
    detectCustomDomain,
  };
  const result = await registerDomain(deps, auth.actor, { hostname, chapterId });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["DomainResponse"] = { domain: result.domain };
  return cliJson(body, { status: 201 });
}
