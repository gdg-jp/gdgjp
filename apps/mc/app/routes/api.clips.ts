import { canUseController } from "~/features/auth/auth-redirect.server";
import { parseNewClipInput } from "~/features/clips/clip-input";
import {
  audioKey,
  getUploaded,
  insertUploaded,
  listUploaded,
  notifyRooms,
} from "~/features/clips/uploads.server";
import type { Route } from "./+types/api.clips";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!(await canUseController(env, request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = parseNewClipInput(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;
  if (!(await env.AUDIO.head(audioKey(input.id)))) {
    return Response.json({ error: "audio" }, { status: 404 });
  }
  if (await getUploaded(env.DB, input.id)) {
    return Response.json({ error: "exists" }, { status: 409 });
  }
  await insertUploaded(env.DB, input);
  await notifyRooms(env);
  return Response.json({ clips: await listUploaded(env.DB) });
}
