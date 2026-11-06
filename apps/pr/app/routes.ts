import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/campaigns/home.tsx"),
  route("c/:slug", "routes/campaigns/overview.tsx"),
  route("c/:slug/brief", "routes/briefs/edit.tsx"),
  route("c/:slug/schedule", "routes/schedule/calendar.tsx"),
  route("c/:slug/members", "routes/campaigns/members.tsx"),
  route("c/:slug/settings", "routes/campaigns/settings.tsx"),
  route("contacts", "routes/contacts/list.tsx"),
  route("me", "routes/me.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
] satisfies RouteConfig;
