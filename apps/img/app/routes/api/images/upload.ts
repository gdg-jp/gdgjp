import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { uploadImage, uploadImageToFolderForActor } from "~/features/images/upload.server";
import type { components } from "../../../../openapi/types.generated";
import type { Route } from "./+types/upload";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const actor = { user, chapters };

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

  const folderId = parseFolderId(form.get("folderId"));
  if (folderId === INVALID) return new Response("invalid folderId", { status: 400 });
  const input = {
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    filename: file.name || null,
  };

  let id: string;
  if (folderId === undefined) {
    const result = await uploadImage(env, args.context.cloudflare.ctx, {
      ...input,
      user,
      chapterId: chapter.chapterId,
    });
    id = result.id;
  } else {
    const result = await uploadImageToFolderForActor(
      env,
      args.context.cloudflare.ctx,
      actor,
      input,
      folderId,
    );
    if (!result.ok) {
      const notFound = result.error === "folder_not_found";
      return new Response(notFound ? "Folder not found" : "Forbidden", {
        status: notFound ? 404 : 403,
      });
    }
    id = result.value.id;
  }

  const body: components["schemas"]["ImageId"] = { id };
  return Response.json(body);
}

const INVALID = Symbol("invalid");

function parseFolderId(value: FormDataEntryValue | null): number | undefined | typeof INVALID {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : INVALID;
}
