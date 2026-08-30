import { listImagesForActor, uploadImageForActor } from "~/features/images/service";
import { requireCliActor } from "~/lib/cli-auth.server";
import { imageServiceErrorResponse } from "~/lib/cli-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.images";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const url = new URL(args.request.url);
  const chapterId = parseIntParam(url.searchParams.get("chapterId"));
  if (chapterId === INVALID) return invalidRequest();
  const folderId = parseFolderIdParam(url.searchParams.get("folderId"));
  if (folderId === INVALID) return invalidRequest();
  const limit = parseIntParam(url.searchParams.get("limit"));
  if (limit === INVALID || (limit !== undefined && (limit < 1 || limit > 100))) {
    return invalidRequest();
  }

  const result = await listImagesForActor(env, auth.actor, {
    chapterId,
    folderId,
    limit,
    cursor: url.searchParams.get("cursor"),
  });
  if (!result.ok) return imageServiceErrorResponse(result.error);

  const body: components["schemas"]["CliImageList"] = {
    images: result.value.images,
    nextCursor: result.value.nextCursor,
  };
  return Response.json(body, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const form = await args.request.formData();
  const chapterId = parseIntParam(asString(form.get("chapterId")));
  if (chapterId === INVALID) return invalidRequest();

  const result = await uploadImageForActor(
    env,
    args.context.cloudflare.ctx,
    auth.actor,
    form.get("file"),
    chapterId ?? null,
  );
  if (!result.ok) return imageServiceErrorResponse(result.error);

  const body: components["schemas"]["UploadResult"] = result.value;
  return Response.json(body, { status: 201, headers: NO_STORE });
}

const INVALID = Symbol("invalid");

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

function parseIntParam(raw: string | null): number | undefined | typeof INVALID {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : INVALID;
}

/** "unfiled" is the sentinel for "no folder"; anything else must be a folder id. */
function parseFolderIdParam(raw: string | null): number | null | undefined | typeof INVALID {
  if (raw === null || raw === "") return undefined;
  if (raw === "unfiled") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : INVALID;
}

function invalidRequest(): Response {
  return Response.json({ error: "invalid_request" }, { status: 400 });
}
