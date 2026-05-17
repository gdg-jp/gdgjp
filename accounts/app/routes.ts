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
  // OAuth / OIDC IdP endpoints — workers-oauth-provider handles /oauth/token
  // and /userinfo internally; everything below is the user-facing portion.
  route("authorize", "routes/authorize.tsx"),
  route("oauth/google/start", "routes/oauth.google.start.ts"),
  route("oauth/google/callback", "routes/oauth.google.callback.ts"),
  route(".well-known/openid-configuration", "routes/well-known.openid-configuration.ts"),
] satisfies RouteConfig;
