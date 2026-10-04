export type ParsedUA = {
  browser: string;
  os: string;
  device: string;
};

export function parseUA(ua: string | null | undefined): ParsedUA {
  const u = ua ?? "";
  return {
    browser: detectBrowser(u),
    os: detectOS(u),
    device: detectDevice(u),
  };
}

function detectBrowser(ua: string): string {
  if (/EdgiOS\//.test(ua)) return "Edge";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/FxiOS\//.test(ua)) return "Firefox";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/MSIE |Trident\//.test(ua)) return "IE";
  return "Other";
}

function detectOS(ua: string): string {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua) && !/Mobile/.test(ua) && !/iPhone|iPad|iPod/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

function detectDevice(ua: string): string {
  if (/bot|crawl|spider|slurp/i.test(ua)) return "Bot";
  if (/iPad/.test(ua) || /Tablet/.test(ua)) return "Tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(ua)) return "Mobile";
  if (/Android/i.test(ua)) return "Tablet";
  return "Desktop";
}
