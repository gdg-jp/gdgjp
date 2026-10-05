import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/jobs/:jobId", "routes/api/jobs/detail.ts"),
  route("api/groups/:groupId/events", "routes/api/events/list.ts"),
  route("api/groups/:groupId/events/:eventId", "routes/api/events/detail.ts"),
  route("api/groups/:groupId/events/:eventId/publish", "routes/api/events/publish.ts"),
  route("api/groups/:groupId/events/:eventId/image", "routes/api/events/image.ts"),
  route("api/groups/:groupId/events/:eventId/copy", "routes/api/events/copy.ts"),
  route("api/groups/:groupId/events/:eventId/cancel", "routes/api/events/cancel.ts"),
  route("api/groups/:groupId/events/:eventId/participants", "routes/api/events/participants.ts"),
  route(
    "api/groups/:groupId/events/:eventId/participants/:participantId",
    "routes/api/events/participant.ts",
  ),
  route("api/groups/:groupId/events/:eventId/stats", "routes/api/events/stats.ts"),
  route("api/groups/:groupId/events/:eventId/messages", "routes/api/events/messages.ts"),
  route("api/groups/:groupId/events/:eventId/vouchers", "routes/api/events/vouchers.ts"),
  route("api/groups/:groupId/events/:eventId/vouchers/:voucherId", "routes/api/events/voucher.ts"),
  route("api/groups/:groupId/events/:eventId/sub-events", "routes/api/events/sub-events.ts"),
  route(
    "api/groups/:groupId/events/:eventId/sub-events/:subEventId",
    "routes/api/events/sub-event.ts",
  ),
  route("api/groups/:groupId/events/:eventId/survey", "routes/api/events/survey.ts"),
  route("api/groups/:groupId/events/:eventId/conference", "routes/api/events/conference.ts"),
  route("api/admin/session/relogin", "routes/api/admin/relogin.ts"),
  route("api/admin/groups", "routes/api/admin/groups.ts"),
  route("api/admin/groups/:groupId", "routes/api/admin/group.ts"),
] satisfies RouteConfig;
