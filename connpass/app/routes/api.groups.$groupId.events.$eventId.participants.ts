import type { ActionFunctionArgs } from "react-router";
import { getParticipantsInBrowser } from "~/lib/connpass-browser-read.server";
import { authorizeEventRoute } from "~/lib/event-route.server";

export async function loader(args: ActionFunctionArgs) {
  const access = await authorizeEventRoute(args, false);
  if ("error" in access) return access.error;
  try {
    return Response.json({
      groupId: access.group.groupSlug,
      eventId: access.eventId,
      participants: await getParticipantsInBrowser(access.env, access.eventId),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "connpass_browser_error" },
      { status: 502 },
    );
  }
}
