import type { ImageServiceErrorCode } from "~/features/images/service";

const STATUS_BY_CODE: Record<ImageServiceErrorCode, number> = {
  missing_file: 400,
  not_image: 400,
  too_large: 413,
  forbidden: 403,
  not_found: 404,
  chapter_required: 400,
  invalid_cursor: 400,
  invalid_slug: 400,
  slug_taken: 409,
};

export function imageServiceErrorResponse(code: ImageServiceErrorCode): Response {
  return Response.json({ error: code }, { status: STATUS_BY_CODE[code] });
}
