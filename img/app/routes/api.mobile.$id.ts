import { requireUserWithChapter } from "~/lib/auth-redirect";
import { isValidImageId } from "~/lib/id";
import { getImage, removeMobileImage, setMobileImage } from "~/lib/images";
import { canMutateImage } from "~/lib/permissions";
import { deleteOriginal, putOriginal } from "~/lib/r2";
import type { Route } from "./+types/api.mobile.$id";

const MAX_BYTES = 10 * 1024 * 1024;

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST" && args.request.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, args.request);
  const image = await getImage(env.DB, id);
  if (!image) return new Response("Not found", { status: 404 });
  if (!canMutateImage(user, image)) return new Response("Forbidden", { status: 403 });

  if (args.request.method === "DELETE") {
    if (!image.mobileR2Key) return Response.json({ ok: true });
    await removeMobileImage(env.DB, id);
    args.context.cloudflare.ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
    return Response.json({ ok: true });
  }

  const form = await args.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("missing file", { status: 400 });
  if (!file.type.startsWith("image/")) return new Response("not an image", { status: 415 });
  if (file.size > MAX_BYTES) return new Response("file too large", { status: 413 });

  const r2Key = `${id}/mobile`;
  await putOriginal(env, r2Key, await file.arrayBuffer(), {
    contentType: file.type,
    userId: image.userId,
    chapterId: image.chapterId,
    filename: file.name || null,
  });
  await setMobileImage(env.DB, id, {
    r2Key,
    contentType: file.type,
    byteSize: file.size,
    filename: file.name || null,
  });

  return Response.json({ id });
}
