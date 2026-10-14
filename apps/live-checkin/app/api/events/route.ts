// app/api/events/route.ts
import { auth, canUseQrScanner } from "@/auth";
import { NextResponse } from "next/server";

const GROUP_ID = "gdgkwansai";
const MAX_EVENTS = 3;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 今日 0:00 (JST) のタイムスタンプ
function startOfTodayJst(): number {
  const jstNow = Date.now() + JST_OFFSET_MS;
  return Math.floor(jstNow / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "認証が必要です。ログインし直してください。" },
      { status: 401 },
    );
  }

  if (!canUseQrScanner(session.user.chapters)) {
    return NextResponse.json(
      { error: "このチャプターのメンバーのみ利用できます。" },
      { status: 403 },
    );
  }

  try {
    const connpassRes = await fetch(`https://connpass.gdgs.jp/api/groups/${GROUP_ID}/events`, {
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
  } catch (error) {
    console.error("Events Proxy Error:", error);
    return NextResponse.json(
      { error: "サーバー間リクエストでエラーが発生しました" },
      { status: 500 },
    );
  }
}
