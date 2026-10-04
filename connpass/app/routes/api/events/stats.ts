import type { LoaderFunctionArgs } from "react-router";
import { authorizeEventRoute } from "~/features/auth/event-route.server";
import { getEventStatisticsInBrowser } from "~/features/connpass/connpass-browser-read.server";

export async function loader(args: LoaderFunctionArgs) {
  const access = await authorizeEventRoute(args, false);
  if ("error" in access) return access.error;
  try {
    return Response.json({
      statistics: await getEventStatisticsInBrowser(access.env, access.eventId),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "connpass_browser_error" },
      { status: 502 },
    );
  }
}
