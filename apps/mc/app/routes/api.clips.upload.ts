import { canUseController } from "~/features/auth/auth-redirect.server";
import { MAX_UPLOAD_BYTES, audioMimeType, newUploadId } from "~/features/clips/clip-input";
import { audioKey, transcribe } from "~/features/clips/uploads.server";
import type { Route } from "./+types/api.clips.upload";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!(await canUseController(env, request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "too-large" }, { status: 413 });
  const mimeType = audioMimeType(file.type, file.name);
  if (!mimeType) return Response.json({ error: "format" }, { status: 415 });

  const id = newUploadId();
  const audio = await file.arrayBuffer();
  await env.AUDIO.put(audioKey(id), audio, {
    httpMetadata: { contentType: mimeType === "audio/mp3" ? "audio/mpeg" : mimeType },
    customMetadata: { file: file.name },
  });

  if (!env.GEMINI_API_KEY) return Response.json({ id, text: "", transcribeError: "no-key" });
  try {
    return Response.json({ id, text: await transcribe(env.GEMINI_API_KEY, audio, mimeType) });
  } catch (err) {
    console.error("transcribe failed", err);
    return Response.json({ id, text: "", transcribeError: String(err).slice(0, 300) });
  }
}
