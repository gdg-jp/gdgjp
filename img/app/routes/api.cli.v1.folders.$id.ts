import {
  deleteFolderForActor,
  getFolderForActor,
  renameFolderForActor,
} from "~/features/folders/service";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliFolderErrorResponse } from "~/lib/folder-errors.server";
import type { Route } from "./+types/api.cli.v1.folders.$id";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = Number(args.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await getFolderForActor(env, auth.actor, id);
  if (!result.ok) return cliFolderErrorResponse(result.error);

  return Response.json({ folder: result.value }, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = Number(args.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "not_found" }, { status: 404 });

  if (args.request.method === "DELETE") {
    const result = await deleteFolderForActor(env, auth.actor, id);
    if (!result.ok) return cliFolderErrorResponse(result.error);
    return Response.json({ id: result.value.id, deleted: true }, { headers: NO_STORE });
  }

  if (args.request.method === "PATCH") {
    const payload = (await args.request.json().catch(() => null)) as { name?: unknown } | null;
    if (!payload || typeof payload.name !== "string") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const result = await renameFolderForActor(env, auth.actor, id, payload.name);
    if (!result.ok) return cliFolderErrorResponse(result.error);
    return Response.json({ folder: result.value }, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
