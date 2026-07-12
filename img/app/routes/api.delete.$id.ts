import { requireUserWithChapter } from "~/lib/auth-redirect";
import { isValidImageId } from "~/lib/id";
import { deleteImage, getImage } from "~/lib/images";
import { canMutateImage } from "~/lib/permissions";
import { deleteOriginal } from "~/lib/r2";
import type { Route } from "./+types/api.delete.$id";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, args.request);
  const image = await getImage(env.DB, id);
  if (!image) return new Response("Not found", { status: 404 });
  if (!canMutateImage(user, image)) return new Response("Forbidden", { status: 403 });

  await deleteImage(env.DB, id);
  args.context.cloudflare.ctx.waitUntil(deleteOriginal(env, image.r2Key));
  if (image.mobileR2Key) {
    args.context.cloudflare.ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
  }

  return Response.json({ ok: true });
}
