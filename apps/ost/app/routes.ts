import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/events/home.tsx"), // "/" — dashboard: chapter events + create (auth + chapter)

  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/auth/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.tsx"), // 404 when ENVIRONMENT === "production"
  route("dev/seed", "routes/dev.seed.tsx"), // 404 when ENVIRONMENT === "production"

  route(":slug", "routes/board/board.tsx"), // participant: submit + 投票する dialog (public)
  route(":slug/screen", "routes/board/screen.tsx"), // projector: themes + drag-merge (auth + chapter)
  route(":slug/tables", "routes/layout/tables.tsx"), // projector: desk → assigned theme (auth + chapter)
  route(":slug/edit", "routes/layout/edit.tsx"), // desk layout + auto-assign + topic admin (auth + chapter)
] satisfies RouteConfig;
