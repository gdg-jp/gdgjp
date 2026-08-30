import { createFolderForActor, listFoldersForActor } from "~/features/folders/service";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliFolderErrorResponse } from "~/lib/folder-errors.server";
import type { Route } from "./+types/api.cli.v1.folders";

const NO_STORE = { "Cache-Control": "no-store" };
const INVALID = Symbol("invalid");

function parseIntParam(raw: string | null): number | undefined | typeof INVALID {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : INVALID;
}

function invalidRequest(): Response {
  return Response.json({ error: "invalid_request" }, { status: 400 });
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

  const result = await listFoldersForActor(env, auth.actor, {
    chapterId,
    limit,
    cursor: url.searchParams.get("cursor"),
  });
  if (!result.ok) return cliFolderErrorResponse(result.error);

  return Response.json(
    { folders: result.value.folders, nextCursor: result.value.nextCursor },
    { headers: NO_STORE },
  );
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const payload = (await args.request.json().catch(() => null)) as {
    name?: unknown;
    chapterId?: unknown;
  } | null;
  if (!payload || typeof payload.name !== "string") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (payload.chapterId !== undefined && typeof payload.chapterId !== "number") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await createFolderForActor(env, auth.actor, {
    name: payload.name,
    chapterId: typeof payload.chapterId === "number" ? payload.chapterId : null,
  });
  if (!result.ok) return cliFolderErrorResponse(result.error);

  return Response.json({ folder: result.value }, { status: 201, headers: NO_STORE });
}
