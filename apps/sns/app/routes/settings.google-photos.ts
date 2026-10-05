import { requireSnsAccess } from "~/features/auth/access.server";
import { updateAlbumSettings } from "~/features/google-photos/album-settings.server";
import type { Route } from "./+types/settings.google-photos";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  if (access.chapter.role !== "organizer") throw new Response("Forbidden", { status: 403 });
  return updateAlbumSettings(request, env, access.chapter.chapterId);
}
