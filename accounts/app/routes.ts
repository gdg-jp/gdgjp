import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signin", "routes/signin.tsx"),
  route("signup", "routes/signup.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("admin/chapters", "routes/admin.chapters.tsx"),
  route("chapters/:slug/organize", "routes/chapters.$slug.organize.tsx"),
  route("api/locale", "routes/api.locale.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
