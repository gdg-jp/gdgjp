import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import { getFolderForActor } from "~/features/folders/service";
import { setImageFolderForActor, uploadImage } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.upload";

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

  // Resolve and authorize the destination folder *before* uploading: the
  // dashboard's folder bar shows folders across every chapter the caller
  // belongs to, not just the primary one, so a folder selected while
  // browsing a non-primary chapter must upload into that folder's chapter —
  // uploading into the primary chapter and then trying to file it would
  // fail with folder_chapter_mismatch and silently strand the image unfiled.
  const folderId = parseFolderId(form.get("folderId"));
  if (folderId === INVALID) return new Response("invalid folderId", { status: 400 });
  let uploadChapterId = chapter.chapterId;
  if (folderId !== undefined) {
    const folderResult = await getFolderForActor(env, actor, folderId);
    if (!folderResult.ok) {
      return new Response(folderResult.error === "not_found" ? "Folder not found" : "Forbidden", {
        status: folderResult.error === "not_found" ? 404 : 403,
      });
    }
    uploadChapterId = folderResult.value.chapterId;
  }

  const result = await uploadImage(env, args.context.cloudflare.ctx, {
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    user,
    chapterId: uploadChapterId,
    filename: file.name || null,
  });

  if (folderId !== undefined) {
    await setImageFolderForActor(env, actor, result.id, folderId);
  }

  const body: components["schemas"]["ImageId"] = { id: result.id };
  return Response.json(body);
}

const INVALID = Symbol("invalid");

function parseFolderId(value: FormDataEntryValue | null): number | undefined | typeof INVALID {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : INVALID;
}
