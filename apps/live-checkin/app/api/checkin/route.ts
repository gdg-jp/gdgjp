import { connpassUrl } from "@/lib/endpoints";
import { withAuth } from "@/lib/middleware/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return withAuth(req, "checkin", async (req, session) => {
    const { url } = await req.json();
    const connpassRes = await fetch(`${connpassUrl()}/api/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        url: url,
      }),
    });

    const data = await connpassRes.json().catch(() => null);

    if (!connpassRes.ok) {
      return NextResponse.json(
        { ...(data ?? {}), error: data?.error ?? "upstream_error", upstream: true },
        { status: connpassRes.status },
      );
    }

    return NextResponse.json(data);
  });
}
