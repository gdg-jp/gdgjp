import {
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import type { Route } from "./+types/api.images.upload";

type ImageUploadService = {
  upload(input: ImageUploadInput): Promise<ImageUploadResult>;
};

function isLocalApp(appUrl: string): boolean {
  const hostname = new URL(appUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function uploadThroughLocalHttp(
  env: Env,
  input: ImageUploadInput,
): Promise<ImageUploadResult> {
  const form = new FormData();
  form.set(
    "file",
    new File([input.bytes], input.filename ?? "preview-image", { type: input.contentType }),
  );
  form.set("user", JSON.stringify(input.user));
  form.set("chapterId", String(input.chapterId));
  const response = await env.IMG_HTTP.fetch("http://localhost:5175/api/internal/upload", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Local img upload failed (${response.status}): ${await response.text()}`);
  }
  return response.json<ImageUploadResult>();
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  const form = await args.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("Please choose an image file.", { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return new Response("Please choose an image file.", { status: 415 });
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return new Response("Image must be 10 MB or smaller.", { status: 413 });
  }

  const input: ImageUploadInput = {
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    filename: file.name || null,
    user,
    chapterId: chapter.chapterId,
  };

  try {
    const result = await (env.IMG_UPLOAD as unknown as ImageUploadService).upload(input);
    return Response.json(result);
  } catch (error) {
    if (isLocalApp(env.APP_URL)) {
      try {
        return Response.json(await uploadThroughLocalHttp(env, input));
      } catch (fallbackError) {
        console.error("local img upload fallback failed", fallbackError);
      }
    } else {
      console.error("img upload service failed", error);
    }
    return new Response("Image upload is temporarily unavailable. Please try again.", {
      status: 502,
    });
  }
}
