import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/events/create.tsx"),
  route("events/new", "routes/events/new.tsx"),
  route("events", "routes/events/list.tsx"),
  route("e/:id", "routes/participants/event.tsx"),
  route("e/:id/edit", "routes/events/edit.tsx"),
  route("e/:id/delete", "routes/events/delete.ts"),
  route("signin", "routes/signin.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
] satisfies RouteConfig;
