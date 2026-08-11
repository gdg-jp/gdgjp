import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/jobs/:jobId", "routes/api.jobs.$jobId.ts"),
  route("api/groups/:groupId/events", "routes/api.groups.$groupId.events.ts"),
  route("api/groups/:groupId/events/:eventId", "routes/api.groups.$groupId.events.$eventId.ts"),
  route(
    "api/groups/:groupId/events/:eventId/publish",
    "routes/api.groups.$groupId.events.$eventId.publish.ts",
  ),
  route("api/admin/session/relogin", "routes/api.admin.session.relogin.ts"),
  route("api/admin/groups", "routes/api.admin.groups.ts"),
  route("api/admin/groups/:groupId", "routes/api.admin.groups.$groupId.ts"),
] satisfies RouteConfig;
