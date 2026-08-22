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
  route(
    "api/groups/:groupId/events/:eventId/image",
    "routes/api.groups.$groupId.events.$eventId.image.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/copy",
    "routes/api.groups.$groupId.events.$eventId.copy.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/cancel",
    "routes/api.groups.$groupId.events.$eventId.cancel.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/participants",
    "routes/api.groups.$groupId.events.$eventId.participants.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/participants/:participantId",
    "routes/api.groups.$groupId.events.$eventId.participants.$participantId.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/stats",
    "routes/api.groups.$groupId.events.$eventId.stats.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/messages",
    "routes/api.groups.$groupId.events.$eventId.messages.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/vouchers",
    "routes/api.groups.$groupId.events.$eventId.vouchers.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/vouchers/:voucherId",
    "routes/api.groups.$groupId.events.$eventId.vouchers.$voucherId.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/sub-events",
    "routes/api.groups.$groupId.events.$eventId.sub-events.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/sub-events/:subEventId",
    "routes/api.groups.$groupId.events.$eventId.sub-events.$subEventId.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/survey",
    "routes/api.groups.$groupId.events.$eventId.survey.ts",
  ),
  route(
    "api/groups/:groupId/events/:eventId/conference",
    "routes/api.groups.$groupId.events.$eventId.conference.ts",
  ),
  route("api/admin/session/relogin", "routes/api.admin.session.relogin.ts"),
  route("api/admin/groups", "routes/api.admin.groups.ts"),
  route("api/admin/groups/:groupId", "routes/api.admin.groups.$groupId.ts"),
] satisfies RouteConfig;
