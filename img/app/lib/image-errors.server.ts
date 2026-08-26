import type { ImageServiceErrorCode } from "~/features/images/service";

/** Preserves the cookie-session routes' original status codes and text bodies. */
export function dashboardImageErrorResponse(code: ImageServiceErrorCode): Response {
  switch (code) {
    case "not_found":
      return new Response("Not found", { status: 404 });
    case "forbidden":
      return new Response("Forbidden", { status: 403 });
    case "missing_file":
      return new Response("missing file", { status: 400 });
    case "not_image":
      return new Response("not an image", { status: 415 });
    case "too_large":
      return new Response("file too large", { status: 413 });
    case "chapter_required":
      return new Response("chapter required", { status: 400 });
    case "invalid_cursor":
      return new Response("invalid cursor", { status: 400 });
  }
}
