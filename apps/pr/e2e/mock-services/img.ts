// Local stand-in for gdgjp-img's ImageUploadService (vite.config.ts auxiliaryWorkers, dev only).
import { WorkerEntrypoint } from "cloudflare:workers";
import type { ImageUploadInput, ImageUploadResult } from "@gdgjp/gdg-lib";

// Ids stay unique across dev-server restarts (pr keeps them in D1).
const RUN = Date.now().toString(36);
const uploads: {
  id: string;
  bytes: number;
  contentType: string;
  filename: string | null;
  user: string;
  chapterId: number;
}[] = [];

export class ImageUploadService extends WorkerEntrypoint {
  upload(input: ImageUploadInput): ImageUploadResult {
    const id = `img-${RUN}-${uploads.length + 1}`;
    uploads.push({
      id,
      bytes: input.bytes.byteLength,
      contentType: input.contentType,
      filename: input.filename,
      user: input.user.id,
      chapterId: input.chapterId,
    });
    return { id, url: `https://img.gdgs.jp/${id}` };
  }
  mockState() {
    return { uploads };
  }
}

export default { fetch: () => new Response("mock gdgjp-img") };
