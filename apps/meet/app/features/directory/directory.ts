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
