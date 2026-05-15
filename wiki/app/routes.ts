import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Public routes (no app shell)
  route("/api/auth/*", "routes/api-auth.tsx"),
  route("/login", "routes/login.tsx"),
  route("/logout", "routes/logout.tsx"),
  route("/auth/signout-iframe", "routes/auth.signout-iframe.ts"),

  // Task API routes (no app shell)
  route("/api/tasks/:taskListId", "routes/api.tasks.$taskListId.ts"),
  route("/api/tasks/:taskListId/:taskId", "routes/api.tasks.$taskListId.$taskId.ts"),
  route("/api/tasks/:taskListId/teams", "routes/api.tasks.$taskListId.teams.ts"),
  route("/api/tasks/:taskListId/reorder", "routes/api.tasks.$taskListId.reorder.ts"),

  // API routes (no app shell)
  route("/api/set-ui-lang", "routes/api.set-ui-lang.tsx"),
  route("/api/set-content-lang", "routes/api.set-content-lang.tsx"),
  route("/api/ingest/:sessionId/status", "routes/api.ingest.$sessionId.status.ts"),
  route("/api/ingest/:sessionId/commit", "routes/api.ingest.$sessionId.commit.ts"),
  route("/api/ingest/:sessionId/clarify", "routes/api.ingest.$sessionId.clarify.ts"),
  route("/api/ingest/:sessionId/select-urls", "routes/api.ingest.$sessionId.select-urls.ts"),
  route("/api/ingest/:sessionId/regenerate", "routes/api.ingest.$sessionId.regenerate.ts"),
  route("/api/google-drive/auth", "routes/api.google-drive.auth.ts"),
  route("/api/google-drive/callback", "routes/api.google-drive.callback.ts"),
  route("/api/pages/reorder", "routes/api.pages.reorder.ts"),
  route("/api/notifications", "routes/api.notifications.ts"),
  route("/api/comments", "routes/api.comments.ts"),
  route("/api/favorites", "routes/api.favorites.tsx"),
  route("/api/images/*", "routes/api.images.$.ts"),
  route("/api/wiki/:slug/upload-image", "routes/api.wiki.$slug.upload-image.ts"),
  route("/api/admin/backfill-embeddings", "routes/api.admin.backfill-embeddings.ts"),
  route("/api/fcm-tokens", "routes/api.fcm-tokens.ts"),
  route("/api/recent", "routes/api.recent.ts"),
  route("/api/archived", "routes/api.archived.ts"),
  route("/api/page-access/:pageId", "routes/api.page-access.$pageId.tsx"),
  route("/api/users/search", "routes/api.users.search.ts"),

  // Admin routes — separate layout with admin sidebar.
  // User and chapter management are owned by the accounts IdP and no longer
  // live here; admins land on /admin/pages.
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("pages", "routes/admin.pages.tsx"),
    route("tags", "routes/admin.tags.tsx"),
    route("stats", "routes/admin.stats.tsx"),
  ]),

  // About / landing for logged-in users — no app shell
  route("/about", "routes/about.tsx"),

  // Legal pages — public, no auth shell
  route("/privacy", "routes/privacy.tsx"),
  route("/terms", "routes/terms.tsx"),

  // Catch-all: return 404 for any unmatched URL (suppresses React Router warning)
  route("*", "routes/$.tsx"),

  // App routes — wrapped in shared layout (Navbar + PageTree sidebar)
  layout("routes/_app.tsx", [
    index("routes/_index.tsx"),
    route("/search", "routes/search.tsx"),
    route("/wiki/new", "routes/wiki.new.tsx"),
    route("/wiki/:slug", "routes/wiki.$slug.tsx"),
    route("/wiki/:slug/edit", "routes/wiki.$slug.edit.tsx"),
    route("/wiki/:slug/history", "routes/wiki.$slug.history.tsx"),
    route("/recent", "routes/recent.tsx"),
    route("/archived", "routes/archived.tsx"),
    route("/ingest", "routes/ingest.tsx"),
    route("/ingest/:sessionId", "routes/ingest.$sessionId.tsx"),
    route("/analyze", "routes/analyze.tsx"),
    route("/settings", "routes/settings.tsx"),
    route("/tasks/new", "routes/tasks.new.tsx"),
    route("/tasks/:slug", "routes/tasks.$slug.tsx"),
    route("/tasks/:slug/settings", "routes/tasks.$slug.settings.tsx"),
    route("/tasks/:slug/history", "routes/tasks.$slug.history.tsx"),
  ]),
] satisfies RouteConfig;
