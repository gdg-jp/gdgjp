import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"), // "/" — event list (auth + chapter). Empty until Stage 02.

  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.tsx"), // 404 when ENVIRONMENT === "production"
  route("dev/seed", "routes/dev.seed.tsx"), // 404 when ENVIRONMENT === "production"
] satisfies RouteConfig;
