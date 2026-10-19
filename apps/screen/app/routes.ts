import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"), // "/" — stage list (auth + chapter)
  route("stages/:stageId", "routes/stages.$stageId.tsx"), // control room (auth + chapter)
  route("join/:token", "routes/join.$token.ts"), // old invite links → /:invite/
  route("out/:stageId/:slot/:kind", "routes/out.$stageId.$slot.$kind.tsx"), // OBS — output token
  route("api/stages", "routes/api.stages.ts"), // create / rename / reissue / delete
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.tsx"), // 404 when ENVIRONMENT === "production"
  // Speaker lobby + room at screen.gdgs.jp/<three-words>/ — public, invite words. Last so every
  // static path above wins.
  route(":invite", "routes/$invite.tsx"),
] satisfies RouteConfig;
