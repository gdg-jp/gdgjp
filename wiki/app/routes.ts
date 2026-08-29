import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Public routes (no app shell)
  route("/api/auth/*", "routes/public/api-auth.tsx"),
  route("/signin", "routes/public/signin.tsx"),
  route("/logout", "routes/public/logout.tsx"),

  // Task API routes (no app shell)
  route("/api/tasks/:taskListId", "routes/api/tasks/list.ts"),
  route("/api/tasks/:taskListId/:taskId", "routes/api/tasks/task.ts"),
  route("/api/tasks/:taskListId/teams", "routes/api/tasks/teams.ts"),
  route("/api/tasks/:taskListId/reorder", "routes/api/tasks/reorder.ts"),

  // API routes (no app shell)
  route("/api/set-ui-lang", "routes/api/user/set-ui-lang.tsx"),
  route("/api/set-content-lang", "routes/api/user/set-content-lang.tsx"),
  route("/api/ingest/:sessionId/status", "routes/api/ingest/status.ts"),
  route("/api/ingest/:sessionId/commit", "routes/api/ingest/commit.ts"),
  route("/api/ingest/:sessionId/clarify", "routes/api/ingest/clarify.ts"),
  route("/api/ingest/:sessionId/select-urls", "routes/api/ingest/select-urls.ts"),
  route("/api/ingest/:sessionId/regenerate", "routes/api/ingest/regenerate.ts"),
  route("/api/google-drive/auth", "routes/api/google/drive-auth.ts"),
  route("/api/google-drive/callback", "routes/api/google/drive-callback.ts"),
  route("/api/google-chat/spaces", "routes/api/google/chat-spaces.ts"),
  route("/api/discord/auth", "routes/api/discord/auth.ts"),
  route("/api/discord/callback", "routes/api/discord/callback.ts"),
  route("/api/discord/guilds", "routes/api/discord/guilds.ts"),
  route("/api/discord/guilds/:guildId/channels", "routes/api/discord/guild-channels.ts"),
  route("/api/google-documents/picker-token", "routes/api/google/documents-picker-token.ts"),
  route("/api/google-documents/import/preview", "routes/api/google/documents-import-preview.ts"),
  route("/api/google-documents/import", "routes/api/google/documents-import.ts"),
  route(
    "/api/google-documents/import/:jobId/status",
    "routes/api/google/documents-import-status.ts",
  ),
  route("/api/sources", "routes/api/sources/list.ts"),
  route("/api/sources/:id/refresh", "routes/api/sources/refresh.ts"),
  route("/api/sources/:id/archive", "routes/api/sources/archive.ts"),
  route("/api/sources/:id/unarchive", "routes/api/sources/unarchive.ts"),
  route("/api/sources/:id/visibility", "routes/api/sources/visibility.ts"),
  route("/api/pages/reorder", "routes/api/pages/reorder.ts"),
  route("/api/notifications", "routes/api/user/notifications.ts"),
  route("/api/comments", "routes/api/pages/comments.ts"),
  route("/api/favorites", "routes/api/pages/favorites.tsx"),
  route("/api/images/*", "routes/api/pages/images.ts"),
  route("/api/wiki/:slug/upload-image", "routes/api/pages/upload-image.ts"),
  route("/api/wiki/import-zip/preview", "routes/api/pages/import-zip-preview.ts"),
  route("/api/wiki/import-zip", "routes/api/pages/import-zip.ts"),
  route("/api/admin/backfill-embeddings", "routes/api/admin/backfill-embeddings.ts"),
  route("/api/fcm-tokens", "routes/api/user/fcm-tokens.ts"),
  route("/api/recent", "routes/api/pages/recent.ts"),
  route("/api/archived", "routes/api/pages/archived.ts"),
  route("/api/page-access/:pageId", "routes/api/pages/access.tsx"),
  route("/api/share-candidates", "routes/api/pages/share-candidates.ts"),
  route("/api/users/search", "routes/api/user/search.ts"),
  route("/api/cli/wiki/snapshot", "routes/api/cli/snapshot.ts"),
  route("/api/cli/wiki/sync", "routes/api/cli/sync.ts"),
  route("/api/cli/wiki/validate-acl", "routes/api/cli/validate-acl.ts"),
  route("/api/cli/wiki/sources", "routes/api/cli/sources.ts"),
  route("/api/cli/wiki/sources/:documentId/content", "routes/api/cli/source-content.ts"),
  route("/api/cli/wiki/chat-senders", "routes/api/cli/chat-senders.ts"),
  route("/api/cli/wiki/agents-md", "routes/api/cli/agents-md.ts"),
  route("/api/cli/wiki/attachments/:attachmentId", "routes/api/cli/attachments.ts"),
  route("/api/agent/ls", "routes/api/agent/ls.ts"),
  route("/api/agent/cat", "routes/api/agent/cat.ts"),
  route("/api/agent/search", "routes/api/agent/search.ts"),
  route("/api/agent/sources", "routes/api/agent/sources.ts"),
  route("/api/agent/sources/inline", "routes/api/agent/sources-inline.ts"),
  route("/api/agent/notes", "routes/api/agent/notes.ts"),
  route("/api/agent/log", "routes/api/agent/log.ts"),
  route("/api/agent/instructions", "routes/api/agent/instructions.ts"),

  // Public OGP image for public and unlisted wiki pages.
  route("/og/wiki/:slug", "routes/wiki/og-image.tsx"),

  // Admin routes — separate layout with admin sidebar.
  // User and chapter management are owned by the accounts IdP and no longer
  // live here; admins land on /admin/pages.
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/index.tsx"),
    route("pages", "routes/admin/pages.tsx"),
    route("tags", "routes/admin/tags.tsx"),
    route("stats", "routes/admin/stats.tsx"),
  ]),

  // About / landing for logged-in users — no app shell
  route("/about", "routes/public/about.tsx"),

  // Legal pages — public, no auth shell
  route("/privacy", "routes/public/privacy.tsx"),
  route("/terms", "routes/public/terms.tsx"),

  // Catch-all: return 404 for any unmatched URL (suppresses React Router warning)
  route("*", "routes/$.tsx"),

  // App routes — wrapped in shared layout (Navbar + PageTree sidebar)
  layout("routes/_app.tsx", [
    index("routes/_index.tsx"),
    route("/search", "routes/wiki/search.tsx"),
    route("/wiki/new", "routes/wiki/new.tsx"),
    route("/wiki/*", "routes/wiki/page.tsx"),
    route("/wiki/:slug/edit", "routes/wiki/edit.tsx"),
    route("/wiki/:slug/history", "routes/wiki/history.tsx"),
    route("/recent", "routes/wiki/recent.tsx"),
    route("/archived", "routes/wiki/archived.tsx"),
    route("/ingest", "routes/ingest/start.tsx"),
    route("/ingest/:sessionId", "routes/ingest/session.tsx"),
    route("/analyze", "routes/ingest/analyze.tsx"),
    route("/sources", "routes/sources/page.tsx"),
    route("/settings", "routes/settings.tsx"),
    route("/tasks/new", "routes/tasks/new.tsx"),
    route("/tasks/:slug", "routes/tasks/detail.tsx"),
    route("/tasks/:slug/settings", "routes/tasks/settings.tsx"),
    route("/tasks/:slug/history", "routes/tasks/history.tsx"),
  ]),
] satisfies RouteConfig;
