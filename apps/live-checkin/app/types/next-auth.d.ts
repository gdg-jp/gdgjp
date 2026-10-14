import type { GdgChapter } from "@/auth";
import type { DefaultSession } from "next-auth";

// 1. Session 型の拡張
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      chapters: GdgChapter[];
      isAdmin: boolean;
    } & DefaultSession["user"];
  }
}

// 2. JWT 型の拡張
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    chapters?: GdgChapter[];
    isAdmin?: boolean;
  }
}
