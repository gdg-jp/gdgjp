import { auth, canUseQrScanner } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  if (!canUseQrScanner(req.auth.user?.chapters)) {
    return NextResponse.redirect(new URL("/forbidden", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/checkin/:path*", "/checkin/"],
};
