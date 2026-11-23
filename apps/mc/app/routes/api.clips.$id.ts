import { canUseController } from "~/features/auth/auth-redirect.server";
import { UPLOAD_ID_RE, parseClipInput } from "~/features/clips/clip-input";
import {
  audioKey,
  deleteUploaded,
  getUploaded,
  listUploaded,
  notifyRooms,
  updateUploaded,
} from "~/features/clips/uploads.server";
import type { Route } from "./+types/api.clips.$id";

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!(await canUseController(env, request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!UPLOAD_ID_RE.test(id)) return Response.json({ error: "id" }, { status: 400 });

  if (request.method === "DELETE") {
    await deleteUploaded(env.DB, id);
    await env.AUDIO.delete(audioKey(id));
    await notifyRooms(env);
    return Response.json({ clips: await listUploaded(env.DB) });
  }

  if (request.method === "PATCH") {
    const current = await getUploaded(env.DB, id);
    if (!current) return Response.json({ error: "not-found" }, { status: 404 });
    const parsed = parseClipInput(await request.json().catch(() => null), current.durationMs);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    if (parsed.value.after === id) return Response.json({ error: "after" }, { status: 400 });
    await updateUploaded(env.DB, id, parsed.value);
    await notifyRooms(env);
    return Response.json({ clips: await listUploaded(env.DB) });
  }

  return new Response(null, { status: 405 });
}
