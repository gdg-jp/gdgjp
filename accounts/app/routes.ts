import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signin", "routes/signin.tsx"),
  route("signup", "routes/signup.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("chapters", "routes/chapters.tsx"),
  route("admin/chapters", "routes/admin.chapters.tsx"),
  route("admin/requests", "routes/admin.requests.tsx"),
  route("admin/seed-clients", "routes/admin.seed-clients.tsx"),
  route("chapters/:slug/organize", "routes/chapters.$slug.organize.tsx"),
  route("api/locale", "routes/api.locale.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  // Compatibility routes keep in-flight requests working across the provider cutover.
  route("authorize", "routes/authorize.tsx"),
  route("oauth/token", "routes/oauth.compat.ts"),
  route("userinfo", "routes/userinfo.compat.ts"),
  route("oauth/consent", "routes/oauth.consent.tsx"),
  route("oauth/google/start", "routes/oauth.google.start.ts"),
  route("oauth/google/callback", "routes/oauth.google.callback.ts"),
  route(".well-known/openid-configuration", "routes/well-known.openid-configuration.ts"),
  route(
    ".well-known/oauth-authorization-server",
    "routes/well-known.oauth-authorization-server.ts",
  ),
] satisfies RouteConfig;
