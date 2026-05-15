import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("links", "routes/dashboard.tsx"),
  route("api/links", "routes/api.links.tsx"),
  route("links/:id", "routes/links.$id.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("tags", "routes/tags.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("auth/signout-iframe", "routes/auth.signout-iframe.ts"),
  route("notfound", "routes/notfound.tsx"),
  route(":slug", "routes/$slug.tsx"),
] satisfies RouteConfig;
