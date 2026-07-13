import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { uploadImage } from "~/lib/upload";
import type { Route } from "./+types/api.upload";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);

  const form = await args.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("missing file", { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return new Response("not an image", { status: 415 });
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return new Response("file too large", { status: 413 });
  }

  const result = await uploadImage(env, args.context.cloudflare.ctx, {
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    user,
    chapterId: chapter.chapterId,
    filename: file.name || null,
  });

  return Response.json({ id: result.id });
}
