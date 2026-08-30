import type { FolderServiceErrorCode } from "~/features/folders/service";

const STATUS_BY_CODE: Record<FolderServiceErrorCode, number> = {
  invalid_name: 400,
  name_taken: 409,
  not_found: 404,
  forbidden: 403,
  chapter_required: 400,
  invalid_cursor: 400,
};

export function cliFolderErrorResponse(code: FolderServiceErrorCode): Response {
  return Response.json({ error: code }, { status: STATUS_BY_CODE[code] });
}

/** Preserves the cookie-session routes' text-body convention (see image-errors.server.ts). */
export function dashboardFolderErrorResponse(code: FolderServiceErrorCode): Response {
  switch (code) {
    case "invalid_name":
      return new Response("Folder names must be 1–48 characters.", { status: 400 });
    case "name_taken":
      return new Response("A folder with that name already exists.", { status: 409 });
    case "not_found":
      return new Response("Folder not found", { status: 404 });
    case "forbidden":
      return new Response("Forbidden", { status: 403 });
    case "chapter_required":
      return new Response("chapter required", { status: 400 });
    case "invalid_cursor":
      return new Response("invalid cursor", { status: 400 });
  }
}
