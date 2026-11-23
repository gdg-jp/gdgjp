import type { AppLoadContext } from "react-router";

export type RouteRequestArgs = {
  request: Request;
  context: AppLoadContext;
  params: Record<string, string | undefined>;
};
