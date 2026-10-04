import { searchContributorCandidates } from "~/features/contributors/candidates.server";
import type { Route } from "./+types/api.contributor-candidates";

export function loader({ request, context }: Route.LoaderArgs) {
  return searchContributorCandidates(request, context.cloudflare.env);
}
