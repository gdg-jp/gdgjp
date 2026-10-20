import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/controller.tsx"), // "/" — controller (auth + chapter)
  route("play", "routes/play.tsx"), // OBS Browser Source — public, token-gated socket
  route("media/:id", "routes/media.$id.ts"), // uploaded clip audio (R2) — public like /audio
  route("api/clips", "routes/api.clips.ts"), // register an uploaded clip
  route("api/clips/upload", "routes/api.clips.upload.ts"), // store audio + transcribe
  route("api/clips/:id", "routes/api.clips.$id.ts"), // edit / delete an uploaded clip
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"), // 404 unless APP_URL is loopback
] satisfies RouteConfig;
