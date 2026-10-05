import type { AppLoadContext } from "react-router";

/** Feature request handlers retain the application context type outside generated routes. */
export type RouteRequestArgs = {
  request: Request;
  context: AppLoadContext;
  params: Record<string, string | undefined>;
};
