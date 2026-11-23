import { parseCookies, serializeCookie } from "@gdgjp/gdg-lib";

export const DEVICE_COOKIE = "roulette-device";

const ONE_YEAR_S = 60 * 60 * 24 * 365;
const DEVICE_RE = /^[0-9a-f-]{36}$/;

export function readDeviceId(request: Request): string | null {
  const value = parseCookies(request.headers.get("cookie"))[DEVICE_COOKIE];
  return value && DEVICE_RE.test(value) ? value : null;
}

export function ensureDeviceId(
  request: Request,
  opts: { secure: boolean },
): { id: string; setCookie?: string } {
  const existing = readDeviceId(request);
  if (existing) return { id: existing };
  const id = crypto.randomUUID();
  return {
    id,
    setCookie: serializeCookie({
      name: DEVICE_COOKIE,
      value: id,
      path: "/",
      maxAge: ONE_YEAR_S,
      httpOnly: true,
      sameSite: "Lax",
      secure: opts.secure,
    }),
  };
}
