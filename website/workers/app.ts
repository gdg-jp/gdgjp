import { createRequestHandler } from "react-router";
import { routeApexRequest } from "./apex-routing";
import { CloudflareContext } from "./context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    return routeApexRequest(
      request,
      (websiteRequest) => requestHandler(websiteRequest, new CloudflareContext({ env, ctx })),
      env.TINYURL,
    );
  },
} satisfies ExportedHandler<Env>;
