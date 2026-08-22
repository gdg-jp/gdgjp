import type { LoaderFunctionArgs } from "react-router";
import { getEventStatisticsInBrowser } from "~/lib/connpass-browser-read.server";
import { authorizeEventRoute } from "~/lib/event-route.server";

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
