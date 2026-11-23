import { connpassUrl } from "@/lib/endpoints";
import { withAuth } from "@/lib/middleware/auth";
import { type NextRequest, NextResponse } from "next/server";

const GROUP_ID = "gdgkwansai";
const MAX_EVENTS = 3;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayJst(): number {
  const jstNow = Date.now() + JST_OFFSET_MS;
  return Math.floor(jstNow / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

export async function GET(req: NextRequest) {
  return withAuth(req, "events", async (req, session) => {
    const connpassRes = await fetch(`${connpassUrl()}/api/groups/${GROUP_ID}/events`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });

    const data = await connpassRes.json();

    if (!connpassRes.ok) {
      return NextResponse.json(data, { status: connpassRes.status });
    }

    const threshold = startOfTodayJst();
    const events = ((data.events ?? []) as EventSummary[])
      .filter((e) => e.status === "published" && new Date(e.startAt).getTime() >= threshold)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, MAX_EVENTS);

    return NextResponse.json({ events });
  });
}
