import { createRequestHandler } from "react-router";
import { publishDuePosts } from "../app/lib/publish.server";
import { CloudflareContext } from "./context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      publishDuePosts(env).catch((error: unknown) => {
        console.error(
          JSON.stringify({ message: "sns scheduled publish failed", error: String(error) }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
