import { WorkerEntrypoint } from "cloudflare:workers";
import type { SnsPrService } from "@gdgjp/gdg-lib";
import { createRequestHandler } from "react-router";
import { claimDueGooglePhotosAlbum } from "../app/features/google-photos/importer.server";
import {
  prAttachMedia,
  prCreateScheduledPost,
  prGetPost,
  prListXAccounts,
  prUpdatePost,
} from "../app/features/posts/pr-service.server";
import { publishDuePosts } from "../app/features/posts/scheduled-publishing.server";
import { CloudflareContext } from "./context";
import { dispatchGooglePhotosImport } from "./google-photos-dispatcher";

const PUBLISH_DUE_POSTS_CRON = "* * * * *";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

/** pr.gdgs.jp's service binding (`entrypoint = "PrService"`). Each call authorizes its actor. */
export class PrService extends WorkerEntrypoint<Env> implements SnsPrService {
  listXAccounts(input: Parameters<SnsPrService["listXAccounts"]>[0]) {
    return prListXAccounts(this.env, input);
  }
  createScheduledPost(input: Parameters<SnsPrService["createScheduledPost"]>[0]) {
    return prCreateScheduledPost(this.env, input);
  }
  updatePost(input: Parameters<SnsPrService["updatePost"]>[0]) {
    return prUpdatePost(this.env, input);
  }
  attachMedia(input: Parameters<SnsPrService["attachMedia"]>[0]) {
    return prAttachMedia(this.env, input);
  }
  getPost(input: Parameters<SnsPrService["getPost"]>[0]) {
    return prGetPost(this.env, input);
  }
}

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
  async scheduled(event, env, ctx) {
    if (event.cron === PUBLISH_DUE_POSTS_CRON) {
      ctx.waitUntil(
        publishDuePosts(env).catch((error: unknown) => {
          console.error(
            JSON.stringify({ message: "sns scheduled publish failed", error: String(error) }),
          );
        }),
      );
      const album = await claimDueGooglePhotosAlbum(env);
      if (!album) return;
      console.log(
        JSON.stringify({
          message: "sns Google Photos workflow dispatch started",
          scheduledTime: new Date(event.scheduledTime).toISOString(),
        }),
      );
      ctx.waitUntil(
        dispatchGooglePhotosImport(env.GITHUB_ACTIONS_DISPATCH_TOKEN, {
          albumId: album.id,
          albumUrl: album.url,
          runId: album.runId,
        }).catch((error: unknown) => {
          console.error(
            JSON.stringify({
              message: "sns Google Photos workflow dispatch failed",
              error: String(error),
            }),
          );
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
