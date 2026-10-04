import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/site/home.tsx"),
  route("privacy", "routes/site/privacy.tsx"),
  route("terms", "routes/site/terms.tsx"),
] satisfies RouteConfig;
