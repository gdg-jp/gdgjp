import { MAX_IMAGES, MAX_IMAGE_BYTES } from "~/features/posts/media-policy";
import type { PostStatus } from "~/features/posts/post.types";
import { parseXPostText } from "~/features/posts/x-text";
import type { PostCondition } from "./post.types";

export const MAX_TAG_HANDLES = 10;

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

export function validateMediaSortOrder(
  usedSortOrders: number[],
  sortOrder: number,
): "invalid_sort_order" | "sort_order_taken" | null {
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= MAX_IMAGES)
    return "invalid_sort_order";
  return usedSortOrders.includes(sortOrder) ? "sort_order_taken" : null;
}

export function normalizeTagHandles(handles: string[]): string[] {
  return handles
    .flatMap((value) => value.split(/[\s,]+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_TAG_HANDLES);
}
