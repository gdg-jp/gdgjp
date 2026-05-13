import { redirect } from "react-router";
import { requireUser } from "~/lib/auth-redirect.server";
import { softDeleteEvent } from "~/lib/db";
import type { Route } from "./+types/e.$id.delete";

export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/e/${params.id}`);
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request);
  const ok = await softDeleteEvent(env.DB, args.params.id, user.id);
  if (!ok) throw new Response("Not found", { status: 404 });
  throw redirect("/events");
}
