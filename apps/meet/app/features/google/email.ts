/**
 * メールアドレスの簡易構文チェックを行う。
 * 制御文字・空白を含まず、単一の `@` で空でないローカル部とドメイン部に分かれることを確認する。
 */
export function isValidEmail(raw: string): boolean {
  if (raw.length === 0 || raw.length > 254) return false;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  const atIndex = raw.indexOf("@");
  if (atIndex <= 0 || atIndex === raw.length - 1) return false;
  if (raw.indexOf("@", atIndex + 1) !== -1) return false;

  const domain = raw.slice(atIndex + 1);
  if (
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return false;
  }
  return true;
}

/**
 * 招待者照合および Drive 共有権限の突合に使うメールアドレス正規化を行う。
 * - 前後空白を除去して小文字化する
 * - ドメインが gmail.com / googlemail.com の場合のみローカル部の `.` をすべて除去する
 * - `+tag` 以降は除去せずそのまま保持する
 * - 独自ドメイン（gdgoc.jp 等）のローカル部の `.` は保持する
 */
export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || trimmed.indexOf("@", atIndex + 1) !== -1) {
    return trimmed;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replaceAll(".", "")}@${domain}`;
  }
  return `${local}@${domain}`;
}
