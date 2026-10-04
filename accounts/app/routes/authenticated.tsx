import { loadAuthenticated } from "~/features/auth/authenticated.server";
import Page from "~/layouts/authenticated-layout";
import type { Route } from "./+types/authenticated";

export function loader(args: Route.LoaderArgs) {
  return loadAuthenticated(args);
}

export default function AuthenticatedLayout(props: Route.ComponentProps) {
  return <Page {...props} />;
}
