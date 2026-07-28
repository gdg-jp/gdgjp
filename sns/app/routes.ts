import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("posts", "routes/posts.tsx"),
  route("schedule", "routes/schedule.tsx"),
  route("settings", "routes/settings.tsx"),
  route("settings/contributors", "routes/settings.contributors.tsx"),
  route("settings/x", "routes/settings.x.tsx"),
  route("settings/google-photos", "routes/settings.google-photos.ts"),
  route("api/posts", "routes/api.posts.ts"),
  route("api/contributor-candidates", "routes/api.contributor-candidates.ts"),
  route("api/media/:id", "routes/api.media.$id.ts"),
  route("api/google-photos-media/:id", "routes/api.google-photos-media.$id.ts"),
  route("api/google-photos-import/*", "routes/api.google-photos-import.$.ts"),
  route("api/chapter", "routes/api.chapter.ts"),
  route("x/connect", "routes/x.connect.ts"),
  route("x/callback", "routes/x.callback.ts"),
  route("google/photos/library", "routes/google.photos.library.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
