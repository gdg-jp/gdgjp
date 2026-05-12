import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("events/new", "routes/events.new.tsx"),
  route("events", "routes/events.tsx"),
  route("e/:id", "routes/e.$id.tsx"),
  route("e/:id/delete", "routes/e.$id.delete.ts"),
  route("signin", "routes/signin.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
