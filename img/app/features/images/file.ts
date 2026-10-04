import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import type { ImageServiceErrorCode } from "./result";

type ValidatedFile = { ok: true; file: File } | { ok: false; error: ImageServiceErrorCode };

/**
 * Reads the `file` multipart field and enforces the shared image/* and
 * MAX_IMAGE_UPLOAD_BYTES contract. Takes the raw form value (not
 * pre-extracted bytes) so callers can run policy checks — e.g. does this
 * image exist and can this actor mutate it — before validating the upload.
 */
export function validateImageFile(value: FormDataEntryValue | null): ValidatedFile {
  if (!(value instanceof File)) return { ok: false, error: "missing_file" };
  if (!value.type.startsWith("image/")) return { ok: false, error: "not_image" };
  if (value.size > MAX_IMAGE_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, file: value };
}
