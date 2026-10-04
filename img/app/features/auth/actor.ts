import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";

/** Authenticated identity and its chapter memberships, shared by app features. */
export type Actor = { user: AuthUser; chapters: UserChapter[] };
