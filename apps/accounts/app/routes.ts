import type { RouteConfig } from "@react-router/dev/routes";
import { index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signin", "routes/auth/signin.tsx", { id: "routes/signin" }),
  route("signup", "routes/signup.tsx"),
  route("onboarding", "routes/onboarding/onboarding.tsx", { id: "routes/onboarding" }),
  layout("routes/authenticated.tsx", { id: "account" }, [
    route("dashboard", "routes/dashboard/dashboard.tsx", { id: "routes/dashboard" }),
    route("developers/apps", "routes/developer-apps/developers.apps.tsx", {
      id: "routes/developers.apps",
    }),
    route("developers/apps/new", "routes/developer-apps/developers.apps.new.tsx", {
      id: "routes/developers.apps.new",
    }),
    route("developers/apps/:clientId", "routes/developer-apps/developers.apps.$clientId.tsx", {
      id: "routes/developers.apps.$clientId",
    }),
    route("chapters", "routes/chapters/chapters.tsx", { id: "routes/chapters" }),
    route("settings/google-workspace", "routes/google-workspace/settings.google-workspace.tsx", {
      id: "routes/settings.google-workspace",
    }),
    route("admin/chapters", "routes/chapters/admin.chapters.tsx", { id: "routes/admin.chapters" }),
    route("admin/users", "routes/users/admin.users.tsx", { id: "routes/admin.users" }),
    route("admin/requests", "routes/memberships/admin.requests.tsx", {
      id: "routes/admin.requests",
    }),
    route("admin/seed-clients", "routes/oauth/admin.seed-clients.tsx", {
      id: "routes/admin.seed-clients",
    }),
    route("chapters/:slug/organize", "routes/memberships/chapters.$slug.organize.tsx", {
      id: "routes/chapters.$slug.organize",
    }),
  ]),
  route("api/locale", "routes/api.locale.ts"),
  route("api/chapters/directory", "routes/api.chapters.directory.ts"),
  route("api/users/search", "routes/api.users.search.ts"),
  route("api/cli/logout", "routes/api.cli.logout.ts"),
  route("api/cli/v1/identity", "routes/api.cli.v1.identity.ts"),
  route("api/agents/google-workspace-token", "routes/api.agents.google-workspace-token.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("device", "routes/oauth/device.tsx", { id: "routes/device" }),
  route("api/auth/*", "routes/api.auth.$.ts"),
  // Compatibility routes keep in-flight requests working across the provider cutover.
  route("authorize", "routes/authorize.tsx"),
  route("oauth/token", "routes/oauth.compat.ts"),
  route("userinfo", "routes/userinfo.compat.ts"),
  route("oauth/consent", "routes/oauth/oauth.consent.tsx", { id: "routes/oauth.consent" }),
  route("oauth/google/start", "routes/oauth.google.start.ts"),
  route("oauth/google/callback", "routes/oauth.google.callback.ts"),
  route("oauth/google-workspace/start", "routes/oauth.google-workspace.start.ts"),
  route("oauth/google-workspace/callback", "routes/oauth.google-workspace.callback.ts"),
  route(".well-known/openid-configuration", "routes/well-known.openid-configuration.ts"),
  route(
    ".well-known/oauth-authorization-server",
    "routes/well-known.oauth-authorization-server.ts",
  ),
] satisfies RouteConfig;
