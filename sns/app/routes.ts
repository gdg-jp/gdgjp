import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("posts", "routes/posts.tsx"),
  route("schedule", "routes/schedule.tsx"),
  route("settings", "routes/settings.tsx"),
  route("settings/contributors", "routes/settings.contributors.tsx"),
  route("settings/x", "routes/settings.x.tsx"),
  route("api/posts", "routes/api.posts.ts"),
  route("api/media/:id", "routes/api.media.$id.ts"),
  route("api/chapter", "routes/api.chapter.ts"),
  route("x/connect", "routes/x.connect.ts"),
  route("x/callback", "routes/x.callback.ts"),
  route("google/photos/connect", "routes/google.photos.connect.ts"),
  route("google/photos/callback", "routes/google.photos.callback.ts"),
  route("google/photos/picker", "routes/google.photos.picker.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
