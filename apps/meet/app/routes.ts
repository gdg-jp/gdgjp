import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/meetings/home.tsx"),
  route("meetings/new", "routes/meetings/new.tsx"),
  route("meetings/:id", "routes/meetings/detail.tsx"),
  route("meetings/:id/edit", "routes/meetings/edit.tsx"),
  route("admin/google", "routes/admin/google.tsx"),
  route("admin/google/callback", "routes/admin/google.callback.ts"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("signin", "routes/signin.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/google/events", "routes/api.google.events.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"), // 404 unless APP_URL is loopback
  route("dev/simulate-event", "routes/dev.simulate-event.ts"), // 404 in production or off loopback
] satisfies RouteConfig;
