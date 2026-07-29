import { createRequestHandler } from "react-router";
import { publishDuePosts } from "../app/lib/publish.server";
import { CloudflareContext } from "./context";
import { dispatchGooglePhotosImport } from "./google-photos-dispatcher";
import { claimDueGooglePhotosAlbum } from "./google-photos-importer";

const PUBLISH_DUE_POSTS_CRON = "* * * * *";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

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
