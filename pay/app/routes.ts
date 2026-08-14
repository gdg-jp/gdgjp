import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("profile", "routes/profile.tsx"),
  route("events/new", "routes/events.new.tsx"),
  route("events/:id", "routes/events.$id.tsx"),
  route("events/:id/google", "routes/events.$id.google.ts"),
  route("events/:id/claims/new", "routes/events.$id.claims.new.tsx"),
  route("events/:id/claims/proxy", "routes/events.$id.claims.proxy.tsx"),
  route("events/:id/claims/:claimId", "routes/events.$id.claims.$claimId.tsx"),
  route("receipts/*", "routes/receipts.$.ts"),
  route("google/connect", "routes/google.connect.ts"),
  route("google/callback", "routes/google.callback.ts"),
  route("signin", "routes/signin.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
