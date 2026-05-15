import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("i/:id", "routes/i.$id.tsx"),
  route("api/upload", "routes/api.upload.ts"),
  route("api/replace/:id", "routes/api.replace.$id.ts"),
  route("api/delete/:id", "routes/api.delete.$id.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("auth/signout-iframe", "routes/auth.signout-iframe.ts"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route(":id", "routes/$id.tsx"),
] satisfies RouteConfig;
