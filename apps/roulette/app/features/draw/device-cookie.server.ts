import { parseCookies, serializeCookie } from "@gdgjp/gdg-lib";

/**
 * Anonymous per-browser identity for the "one spin per device" rule.
 *
 * Not authenticated — clearing cookies or a private window gets another spin.
 * That is acceptable for an event lottery where staff hand prizes over in
 * person and check the draw number on the result screen.
 */
export const DEVICE_COOKIE = "roulette-device";

const ONE_YEAR_S = 60 * 60 * 24 * 365;
const DEVICE_RE = /^[0-9a-f-]{36}$/;

export function readDeviceId(request: Request): string | null {
  const value = parseCookies(request.headers.get("cookie"))[DEVICE_COOKIE];
  return value && DEVICE_RE.test(value) ? value : null;
}

/**
 * Return the request's device id, minting one when absent. `setCookie` is only
 * present when a fresh id was generated and must be echoed on the response.
 */
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
