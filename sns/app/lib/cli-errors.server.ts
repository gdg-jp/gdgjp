import type {
  PostDraftError,
  PostDraftErrorCode,
} from "~/features/posts/post-draft.service.server";
import { cliError } from "./cli-http.server";

const POST_DRAFT_STATUS: Record<PostDraftErrorCode, number> = {
  not_found: 404,
  not_editable: 409,
  invalid_text: 400,
  invalid_schedule: 400,
  invalid_condition: 400,
  account_not_found: 400,
  too_many_images: 400,
  image_too_large: 413,
  not_image: 400,
  media_storage_cleanup_failed: 500,
};

/** Maps an aggregate draft-service failure onto the shared `{ error }` envelope. */
export function postDraftErrorResponse(error: PostDraftError): Response {
  return cliError(error.code, POST_DRAFT_STATUS[error.code]);
}

/**
 * Turns a {@link import("~/features/auth/cli-access.server").requireCliSnsAccess}
 * rejection into a response for a chapter-addressed route: `401` stays `401`,
 * `403` stays `403`.
 */
export function cliAccessErrorResponse(error: 401 | 403): Response {
  return cliError(error === 401 ? "unauthorized" : "forbidden", error);
}

/**
 * Same, but for an id-addressed route: a `403` becomes `404` so a caller cannot
 * confirm the existence of a resource in another chapter.
 */
export function cliAccessErrorAsNotFound(error: 401 | 403): Response {
  return error === 401 ? cliError("unauthorized", 401) : cliError("not_found", 404);
}
