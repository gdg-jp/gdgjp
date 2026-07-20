import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("links", "routes/dashboard.tsx"),
  route("campaigns", "routes/campaigns.tsx"),
  route("campaigns/:id", "routes/campaigns.$id.tsx"),
  route("api/links", "routes/api.links.tsx"),
  route("api/images/upload", "routes/api.images.upload.ts"),
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
