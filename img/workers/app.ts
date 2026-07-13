import { WorkerEntrypoint } from "cloudflare:workers";
import type { ImageUploadInput, ImageUploadResult } from "@gdgjp/gdg-lib";
import { createRequestHandler } from "react-router";
import { uploadImage } from "../app/lib/upload";
import { CloudflareContext } from "./context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export class ImageUploadService extends WorkerEntrypoint<Env> {
  upload(input: ImageUploadInput): Promise<ImageUploadResult> {
    return uploadImage(this.env, this.ctx, input);
  }
}

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
} satisfies ExportedHandler<Env>;
