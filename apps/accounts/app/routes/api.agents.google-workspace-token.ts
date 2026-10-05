import { vendWorkspaceToken } from "~/features/google-workspace/token-vending.server";
import type { Route } from "./+types/api.agents.google-workspace-token";

export function action(args: Route.ActionArgs) {
  return vendWorkspaceToken(args);
}
