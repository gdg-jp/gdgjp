import { redirect } from "react-router";
import { createEvent } from "~/features/events/manage.server";
import type { Route } from "./+types/new";

export function loader() {
  throw redirect("/");
}

export function action(args: Route.ActionArgs) {
  return createEvent(args.context.cloudflare.env, args.request);
}
