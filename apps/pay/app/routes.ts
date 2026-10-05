import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/events/event-list.tsx"),
  route("profile", "routes/profiles/profile.tsx"),
  route("events/new", "routes/events/new-event.tsx"),
  route("events/:id", "routes/events/event-detail.tsx"),
  route("events/:id/google", "routes/events.$id.google.ts"),
  route("events/:id/claims/new", "routes/claims/new-claim.tsx"),
  route("events/:id/claims/proxy", "routes/claims/proxy-claim.tsx"),
  route("events/:id/claims/:claimId", "routes/claims/claim-detail.tsx"),
  route("receipts/*", "routes/receipts.$.ts"),
  route("google/connect", "routes/google.connect.ts"),
  route("google/callback", "routes/google.callback.ts"),
  route("signin", "routes/auth/sign-in.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
