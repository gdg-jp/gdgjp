import { redirect } from "react-router";
import { getOptionalUser } from "~/lib/auth-redirect.server";
import { createEventWithSlots } from "~/lib/db";
import { parseEventForm } from "~/lib/validate";
import type { Route } from "./+types/events.new";

export function loader() {
  throw redirect("/");
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const form = await args.request.formData();
  const parsed = parseEventForm(form);
  if (!parsed.ok) {
    return new Response(parsed.errors.join("\n"), { status: 400 });
  }
  const user = await getOptionalUser(env, args.request);
  const { event } = await createEventWithSlots(env.DB, {
    title: parsed.value.title,
    description: parsed.value.description,
    ownerUserId: user?.id ?? null,
    slots: parsed.value.slots,
  });
  throw redirect(`/e/${event.id}`);
}
