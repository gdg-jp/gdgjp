import type { Actor } from "~/features/auth/actor";

export type ImageActor = Actor;

export type ImageServiceErrorCode =
  | "missing_file"
  | "not_image"
  | "too_large"
  | "forbidden"
  | "not_found"
  | "chapter_required"
  | "invalid_cursor"
  | "invalid_slug"
  | "slug_taken"
  | "folder_not_found"
  | "folder_chapter_mismatch"
  | "invalid_request";

export type ImageServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ImageServiceErrorCode };

export function ok<T>(value: T): ImageServiceResult<T> {
  return { ok: true, value };
}

export function fail<T>(error: ImageServiceErrorCode): ImageServiceResult<T> {
  return { ok: false, error };
}
