/**
 * ブラウザへ共有してよいチャプターの基本情報。
 * チャプターメンバーのメールアドレス等の個人情報はクライアント向け型に一切含めない。
 */
export type ChapterSummary = {
  id: number;
  slug: string;
  name: string;
  kind: string;
  region: string;
};

const MAX_AVATAR_URL_LENGTH = 2048;

/**
 * 招待者アバター URL として安全な `https:` URL のみを通し、それ以外は `null` を返す。
 * `javascript:` / `data:` / `http:` / 資格情報付き URL を拒否する。
 */
export function sanitizeAvatarUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_AVATAR_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
