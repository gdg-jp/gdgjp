import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/events/home.tsx"),

  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
  route("dev/seed", "routes/dev.seed.tsx"),

  route(":slug", "routes/board/board.tsx"),
  route(":slug/screen", "routes/board/screen.tsx"),
  route(":slug/tables", "routes/layout/tables.tsx"),
  route(":slug/edit", "routes/layout/edit.tsx"),
] satisfies RouteConfig;
