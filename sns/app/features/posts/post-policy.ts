import type { PostStatus } from "~/lib/db.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "~/lib/utils";
import { parseXPostText } from "~/lib/x-text";
import type { PostCondition } from "./post.types";

export const MAX_TAG_HANDLES = 10;

/** A post whose bytes are already on their way to X can no longer be edited. */
export function isEditableStatus(status: PostStatus): boolean {
  return status !== "published" && status !== "posting";
}

export function isValidPostText(text: string): boolean {
  return text.trim().length > 0 && parseXPostText(text).valid;
}

export function isValidScheduledAt(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

export function isValidCondition(value: string): value is PostCondition {
  return value === "scheduled" || value === "photo_required";
}

/**
 * The draft status is a pure function of its condition and how many images are
 * currently attached: a photo-required post with no image waits, everything
 * else is schedulable. Callers must not apply this to a `published`/`posting`
 * post — see {@link isEditableStatus}.
 */
export function recomputeDraftStatus(
  condition: PostCondition,
  mediaCount: number,
): "scheduled" | "waiting_for_photo" {
  return condition === "photo_required" && mediaCount === 0 ? "waiting_for_photo" : "scheduled";
}

export type MediaValidationError = "too_many_images" | "image_too_large" | "not_image";

export function validateNewMedia(
  existingCount: number,
  files: { size: number; contentType: string }[],
): MediaValidationError | null {
  if (existingCount + files.length > MAX_IMAGES) return "too_many_images";
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) return "image_too_large";
    if (!file.contentType.startsWith("image/")) return "not_image";
  }
  return null;
}

/**
 * Accepts either pre-split handles (CLI) or a single raw field holding several
 * whitespace/comma-separated handles (the dashboard's tag dialog), and caps the
 * result the same way the dashboard action always has.
 */
export function normalizeTagHandles(handles: string[]): string[] {
  return handles
    .flatMap((value) => value.split(/[\s,]+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_TAG_HANDLES);
}
