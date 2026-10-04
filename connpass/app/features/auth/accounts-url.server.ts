export function accountsBaseUrl(env: Env): string {
  const e2e = import.meta.env.CONNPASS_E2E_ACCOUNTS_URL;
  if (typeof e2e === "string" && e2e.length > 0) return e2e;
  return env.ACCOUNTS_URL;
}
