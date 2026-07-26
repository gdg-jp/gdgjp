import { requireUserWithChapter } from "~/lib/auth-redirect";
import { isValidImageId } from "~/lib/id";
import { getImage, updateImageBytes } from "~/lib/images";
import { canMutateImage } from "~/lib/permissions";
import { putOriginal } from "~/lib/r2";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.replace.$id";

const MAX_BYTES = 10 * 1024 * 1024;

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

  const form = await args.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("missing file", { status: 400 });
  if (!file.type.startsWith("image/")) return new Response("not an image", { status: 415 });
  if (file.size > MAX_BYTES) return new Response("file too large", { status: 413 });

  const bytes = await file.arrayBuffer();
  await putOriginal(env, image.r2Key, bytes, {
    contentType: file.type,
    userId: image.userId,
    chapterId: image.chapterId,
    filename: file.name || image.filename,
  });
  await updateImageBytes(env.DB, id, {
    contentType: file.type,
    byteSize: file.size,
    width: null,
    height: null,
    filename: file.name || image.filename,
  });

  const body: components["schemas"]["ImageId"] = { id };
  return Response.json(body);
}
