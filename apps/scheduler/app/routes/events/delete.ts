import { redirect } from "react-router";
import { deleteEvent } from "~/features/events/manage.server";
import type { Route } from "./+types/delete";

export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/e/${params.id}`);
}

export function action(args: Route.ActionArgs) {
  return deleteEvent(args.context.cloudflare.env, args.request, args.params.id);
}
