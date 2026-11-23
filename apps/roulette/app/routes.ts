import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/projects/home.tsx"),
  route("admin/:slug", "routes/projects/admin.tsx"),
  route("admin/:slug/draws.csv", "routes/projects/draws-csv.ts"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
  route("dev/reset/:slug", "routes/dev.reset.ts"),
  route(":slug", "routes/draw/draw.tsx"),
] satisfies RouteConfig;
