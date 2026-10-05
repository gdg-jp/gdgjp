const MOBILE_USER_AGENT =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i;

export function prefersMobileImage(headers: Headers): boolean {
  const uaMobile = headers.get("sec-ch-ua-mobile");
  if (uaMobile === "?1") return true;
  if (uaMobile === "?0") return false;

  const deviceType = headers.get("cf-device-type")?.toLowerCase();
  if (deviceType === "mobile" || deviceType === "tablet") return true;
  if (deviceType === "desktop") return false;

  return MOBILE_USER_AGENT.test(headers.get("user-agent") ?? "");
}
