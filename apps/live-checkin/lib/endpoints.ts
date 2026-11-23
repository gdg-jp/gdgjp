export function accountsUrl(): string {
  return (process.env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp").replace(/\/+$/, "");
}

export function connpassUrl(): string {
  return (process.env.CONNPASS_URL ?? "https://connpass.gdgs.jp").replace(/\/+$/, "");
}
