import type { ActionFunctionArgs } from "react-router";
import { authorizeEventRoute } from "~/features/auth/event-route.server";
import { getParticipantsInBrowser } from "~/features/connpass/connpass-browser-read.server";

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
