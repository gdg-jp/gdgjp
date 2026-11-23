import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import type { ImageServiceErrorCode } from "./result";

type ValidatedFile = { ok: true; file: File } | { ok: false; error: ImageServiceErrorCode };

export function validateImageFile(value: FormDataEntryValue | null): ValidatedFile {
  if (!(value instanceof File)) return { ok: false, error: "missing_file" };
  if (!value.type.startsWith("image/")) return { ok: false, error: "not_image" };
  if (value.size > MAX_IMAGE_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, file: value };
}
