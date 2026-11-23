import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("stages/:stageId", "routes/stages.$stageId.tsx"),
  route("join/:token", "routes/join.$token.ts"),
  route("out/:stageId/:slot/:kind", "routes/out.$stageId.$slot.$kind.tsx"),
  route("api/stages", "routes/api.stages.ts"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("dev/login", "routes/dev.login.ts"),
  route(":invite", "routes/$invite.tsx"),
] satisfies RouteConfig;
