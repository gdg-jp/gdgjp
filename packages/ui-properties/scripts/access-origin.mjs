const LABELS = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const LOOPBACK = /^(?:localhost|127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|\[::1\])$/;

function parse(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackOrigin(value) {
  const url = parse(value);
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    LOOPBACK.test(url.hostname) &&
    url.origin === value
  );
}

export function accessScope({ domain, localOrigins = [] }) {
  if (domain !== undefined && domain !== null && domain !== "") {
    if (!LABELS.test(domain) || /^[\d.]+$/.test(domain) || domain === "localhost")
      throw new Error(`Invalid slot domain: ${domain}`);
  }
  for (const origin of localOrigins)
    if (!isLoopbackOrigin(origin))
      throw new Error(`A local Access origin must be a loopback origin: ${origin}`);
  return Object.freeze({ domain: domain || null, localOrigins: Object.freeze([...localOrigins]) });
}

export function inAccessScope(scope, value) {
  const url = parse(value);
  if (!url || url.username || url.password) return false;
  if (scope.localOrigins.includes(url.origin)) return true;
  if (!scope.domain || url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname;
  if (!LABELS.test(host)) return false;
  return host === scope.domain || host.endsWith(`.${scope.domain}`);
}

export function isTestDomain(domain) {
  return domain === "test" || String(domain).endsWith(".test");
}
