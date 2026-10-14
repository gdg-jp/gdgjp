import NextAuth from "next-auth";
import { GDGAccounts } from "./gdg-provider";

const CHAPTERS_CLAIM = "https://gdgs.jp/claims/chapters";
const IS_ADMIN_CLAIM = "https://gdgs.jp/claims/is_admin";

// checkin の利用を許可するチャプター
export const ALLOWED_CHAPTER_SLUG = "gdg-kwansai";

export type GdgChapter = {
  chapterId: number;
  chapterSlug: string;
  role: "organizer" | "member";
};

function parseChapters(value: unknown): GdgChapter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is GdgChapter =>
      typeof c?.chapterId === "number" &&
      typeof c?.chapterSlug === "string" &&
      (c?.role === "organizer" || c?.role === "member"),
  );
}

// 所属チャプターに gdg-kwansai が含まれるか
export function canUseQrScanner(chapters: GdgChapter[] | undefined): boolean {
  return !!chapters?.some((c) => c.chapterSlug === ALLOWED_CHAPTER_SLUG);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GDGAccounts()],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      // profile は検証済みの ID トークンのクレーム。ログイン時だけ渡される
      if (profile) {
        token.chapters = parseChapters(profile[CHAPTERS_CLAIM]);
        token.isAdmin = profile[IS_ADMIN_CLAIM] === true;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.user.chapters = (token.chapters as GdgChapter[] | undefined) ?? [];
      session.user.isAdmin = token.isAdmin === true;
      return session;
    },
  },
});
