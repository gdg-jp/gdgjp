import { type AuthUser, MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import { uploadImage } from "~/lib/upload";
import type { Route } from "./+types/api.internal-upload";

function isLocalApp(appUrl: string): boolean {
  const hostname = new URL(appUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  if (!isLocalApp(env.APP_URL)) {
    return new Response("Not found", { status: 404 });
  }
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const form = await args.request.formData();
  const file = form.get("file");
  const user = parseUser(form.get("user"));
  const chapterId = Number(form.get("chapterId"));
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return new Response("Please choose an image file.", { status: 415 });
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return new Response("Image must be 10 MB or smaller.", { status: 413 });
  }
  if (!user || !Number.isInteger(chapterId) || chapterId <= 0) {
    return new Response("Invalid image owner.", { status: 400 });
  }

  const result = await uploadImage(env, args.context.cloudflare.ctx, {
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    filename: file.name || null,
    user,
    chapterId,
  });
  return Response.json(result);
}

function parseUser(value: FormDataEntryValue | null): AuthUser | null {
  if (typeof value !== "string") return null;
  try {
    const user = JSON.parse(value) as Partial<AuthUser>;
    if (
      typeof user.id !== "string" ||
      typeof user.email !== "string" ||
      typeof user.name !== "string" ||
      (user.image !== null && typeof user.image !== "string") ||
      typeof user.isAdmin !== "boolean"
    ) {
      return null;
    }
    return user as AuthUser;
  } catch {
    return null;
  }
}
