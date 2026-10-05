import type { UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canEditApplication } from "./permissions";

const event = { chapterId: 42 };
const chapters: UserChapter[] = [{ chapterId: 42, chapterSlug: "tokyo", role: "member" }];
const otherChapters: UserChapter[] = [{ chapterId: 99, chapterSlug: "osaka", role: "member" }];

describe("canEditApplication", () => {
  it("allows a member of the owning chapter to edit any application", () => {
    const application = { userId: "user_stranger" };
    expect(canEditApplication({ userId: "user_owner" }, chapters, event, application)).toBe(true);
  });

  it("allows an unauthenticated caller through the chapter check alone", () => {
    const application = { userId: "user_stranger" };
    expect(canEditApplication(null, chapters, event, application)).toBe(true);
  });

  it("allows a signed-in viewer to edit their own application, Chapter-less", () => {
    const application = { userId: "user_1" };
    expect(canEditApplication({ userId: "user_1" }, otherChapters, event, application)).toBe(true);
  });

  it("denies a signed-in viewer editing someone else's application outside their chapter", () => {
    const application = { userId: "user_2" };
    expect(canEditApplication({ userId: "user_1" }, otherChapters, event, application)).toBe(false);
  });

  it("denies an unauthenticated visitor with no chapter membership", () => {
    const application = { userId: "user_1" };
    expect(canEditApplication(null, otherChapters, event, application)).toBe(false);
  });

  it("denies editing a proxy-registered (userId null) application from outside the chapter", () => {
    const application = { userId: null };
    expect(canEditApplication({ userId: "user_1" }, otherChapters, event, application)).toBe(false);
  });
});
