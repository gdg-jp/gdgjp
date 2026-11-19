const EMAIL_PATTERN = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * ログ出力向けにメールアドレスのローカル部を伏せる（例: `user@example.com` → `u***@example.com`）。
 * 構文が不正な場合は `"***"` を返す。
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1 || trimmed.indexOf("@", atIndex + 1) !== -1) {
    return "***";
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local[0]}***@${domain}`;
}

/** 文字列に含まれるメールアドレスをすべて {@link maskEmail} で伏せる。 */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_PATTERN, (matched) => maskEmail(matched));
}
