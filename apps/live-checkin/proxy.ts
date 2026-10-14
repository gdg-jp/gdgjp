// Next.js proxy (旧 middleware)
import { auth, canUseQrScanner } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  // gdg-kwansai に所属していないユーザーは checkin を利用不可
  if (!canUseQrScanner(req.auth.user?.chapters)) {
    return NextResponse.redirect(new URL("/forbidden", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/checkin/:path*", "/checkin/"],
};
