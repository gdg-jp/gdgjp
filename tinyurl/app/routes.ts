import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("links", "routes/dashboard.tsx"),
  route("campaigns", "routes/campaigns.tsx"),
  route("campaigns/:id", "routes/campaigns.$id.tsx"),
  route("api/links", "routes/api.links.tsx"),
  route("api/images/upload", "routes/api.images.upload.ts"),
  route("api/cli/v1/campaigns", "routes/api.cli.v1.campaigns.ts"),
  route("api/cli/v1/campaigns/:id", "routes/api.cli.v1.campaigns.$id.ts"),
  route("api/cli/v1/campaigns/:id/restore", "routes/api.cli.v1.campaigns.$id.restore.ts"),
  route("api/cli/v1/campaigns/:id/analytics", "routes/api.cli.v1.campaigns.$id.analytics.ts"),
  route("api/cli/v1/campaigns/:id/channels", "routes/api.cli.v1.campaigns.$id.channels.ts"),
  route(
    "api/cli/v1/campaigns/:id/channels/:channelId",
    "routes/api.cli.v1.campaigns.$id.channels.$channelId.ts",
  ),
  route(
    "api/cli/v1/campaigns/:id/channels/:channelId/restore",
    "routes/api.cli.v1.campaigns.$id.channels.$channelId.restore.ts",
  ),
  route(
    "api/cli/v1/campaigns/:id/channels/:channelId/sources",
    "routes/api.cli.v1.campaigns.$id.channels.$channelId.sources.ts",
  ),
  route(
    "api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId",
    "routes/api.cli.v1.campaigns.$id.channels.$channelId.sources.$sourceId.ts",
  ),
  route(
    "api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId/restore",
    "routes/api.cli.v1.campaigns.$id.channels.$channelId.sources.$sourceId.restore.ts",
  ),
  route("links/:id", "routes/links.$id.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("tags", "routes/tags.tsx"),
  route("folders", "routes/folders.tsx"),
  route("folders/:id", "routes/folders.$id.tsx"),
  route("domains", "routes/domains.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("notfound", "routes/notfound.tsx"),
  route(":slug", "routes/$slug.tsx"),
] satisfies RouteConfig;
