import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/meetings/home.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("signin", "routes/signin.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"), // 404 unless APP_URL is loopback
] satisfies RouteConfig;
