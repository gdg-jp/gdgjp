import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"), // "/" — dashboard: chapter events + create (auth + chapter)

  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.tsx"), // 404 when ENVIRONMENT === "production"
  route("dev/seed", "routes/dev.seed.tsx"), // 404 when ENVIRONMENT === "production"

  route(":slug", "routes/board.tsx"), // participant: submit + 投票する dialog (public)
  route(":slug/screen", "routes/screen.tsx"), // projector: themes + drag-merge (auth + chapter)
  route(":slug/tables", "routes/tables.tsx"), // projector: desk → assigned theme (auth + chapter)
  route(":slug/edit", "routes/edit.tsx"), // desk layout + auto-assign + topic admin (auth + chapter)
] satisfies RouteConfig;
