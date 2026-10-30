import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/projects/home.tsx"), // "/" — project list + create (auth + chapter)
  route("admin/:slug", "routes/projects/admin.tsx"), // settings + live status (auth + chapter)
  route("admin/:slug/draws.csv", "routes/projects/draws-csv.ts"), // draw log download (same gate)
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"), // 404 unless APP_URL is loopback
  // Public spin page. Last so every static path above wins (slug.ts reserves those names).
  route(":slug", "routes/draw/draw.tsx"),
] satisfies RouteConfig;
