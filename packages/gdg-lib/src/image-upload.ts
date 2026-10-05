import type { AuthUser } from "./auth";

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImageUploadInput = {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string | null;
  user: AuthUser;
  chapterId: number;
};

export type ImageUploadResult = {
  id: string;
  url: string;
};
