import type { GdgChapter } from "@/auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      chapters: GdgChapter[];
      isAdmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    chapters?: GdgChapter[];
    isAdmin?: boolean;
  }
}
