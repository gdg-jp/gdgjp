import { searchAccountUsers } from "~/features/users/search.server";
import type { Route } from "./+types/api.users.search";

export function loader(args: Route.LoaderArgs) {
  return searchAccountUsers(args);
}
