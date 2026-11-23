import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/controller.tsx"),
  route("play", "routes/play.tsx"),
  route("media/:id", "routes/media.$id.ts"),
  route("api/clips", "routes/api.clips.ts"),
  route("api/clips/upload", "routes/api.clips.upload.ts"),
  route("api/clips/:id", "routes/api.clips.$id.ts"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
] satisfies RouteConfig;
