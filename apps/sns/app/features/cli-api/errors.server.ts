import type {
  PostDraftError,
  PostDraftErrorCode,
} from "~/features/posts/post-draft.service.server";
import { cliError } from "./http.server";

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

export function postDraftErrorResponse(error: PostDraftError): Response {
  return cliError(error.code, POST_DRAFT_STATUS[error.code]);
}

export function cliAccessErrorResponse(error: 401 | 403): Response {
  return cliError(error === 401 ? "unauthorized" : "forbidden", error);
}

export function cliAccessErrorAsNotFound(error: 401 | 403): Response {
  return error === 401 ? cliError("unauthorized", 401) : cliError("not_found", 404);
}
