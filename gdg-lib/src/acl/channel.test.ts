import { describe, expect, it } from "vitest";
import {
  audienceKeyContains,
  canClassesAccessSourceInChannel,
  canClassesSeePageInChannel,
  pageAudienceIncludesChannel,
} from "./channel";
import type { PageSubject, PermissionClass, SourceAudienceKey } from "./types";

const keys: SourceAudienceKey[] = [
  { kind: "private" },
  { kind: "member" },
  { kind: "organizer" },
  { kind: "chapter-member", chapterId: "tokyo" },
  { kind: "chapter-organizer", chapterId: "tokyo" },
];
const channels = keys;
const expected: boolean[][] = [
  [false, false, false, false, false],
  [false, true, false, false, false],
  [false, true, true, false, false],
  [false, true, false, true, false],
  [false, true, true, true, true],
];

describe("audienceKeyContains", () => {
  it("matches every channel/source pair in the decision table", () => {
    for (let outer = 0; outer < channels.length; outer += 1) {
      for (let inner = 0; inner < keys.length; inner += 1) {
        const outerKey = channels[outer];
        const innerKey = keys[inner];
        const expectedRow = expected[outer];
        if (!outerKey || !innerKey || !expectedRow) throw new Error("invalid test matrix");
        expect(audienceKeyContains(outerKey, innerKey)).toBe(expectedRow[inner]);
      }
    }
  });

  it("does not let nationwide channels include chapter-limited sources", () => {
    expect(
      audienceKeyContains({ kind: "member" }, { kind: "chapter-member", chapterId: "tokyo" }),
    ).toBe(false);
    expect(
      audienceKeyContains({ kind: "organizer" }, { kind: "chapter-organizer", chapterId: "tokyo" }),
    ).toBe(false);
  });
});

const page = (visibility: string, access: PageSubject["access"] = []): PageSubject => ({
  visibility,
  chapterId: null,
  access,
});

describe("pageAudienceIncludesChannel", () => {
  it("treats public pages as wider than every channel", () => {
    for (const channel of channels)
      expect(pageAudienceIncludesChannel(page("public"), channel)).toBe(true);
  });

  it("only maps a single chapter restriction to the matching chapter channel", () => {
    const restricted = page("restricted", [{ subjectType: "chapter", subjectKey: "tokyo" }]);
    expect(
      pageAudienceIncludesChannel(restricted, { kind: "chapter-member", chapterId: "tokyo" }),
    ).toBe(true);
    expect(
      pageAudienceIncludesChannel(restricted, { kind: "chapter-organizer", chapterId: "osaka" }),
    ).toBe(false);
    expect(
      pageAudienceIncludesChannel(
        page("restricted", [
          { subjectType: "chapter", subjectKey: "tokyo" },
          { subjectType: "chapter", subjectKey: "osaka" },
        ]),
        { kind: "chapter-member", chapterId: "tokyo" },
      ),
    ).toBe(false);
    expect(
      pageAudienceIncludesChannel(
        page("restricted", [{ subjectType: "email", subjectKey: "a@example.com" }]),
        { kind: "chapter-member", chapterId: "tokyo" },
      ),
    ).toBe(false);
  });
});

describe("channel-aware class evaluators", () => {
  const tokyoMember: PermissionClass = { chapterId: "tokyo", role: "member" };
  it("ANDs class access with the channel ceiling in both directions", () => {
    expect(
      canClassesAccessSourceInChannel(
        { visibility: "chapter-member", chapterId: "tokyo" },
        [tokyoMember],
        { kind: "member" },
      ),
    ).toBe(false);
    expect(
      canClassesAccessSourceInChannel(
        { visibility: "chapter-member", chapterId: "tokyo" },
        [{ chapterId: "osaka", role: "member" }],
        { kind: "chapter-organizer", chapterId: "tokyo" },
      ),
    ).toBe(false);
    expect(
      canClassesAccessSourceInChannel(
        { visibility: "chapter-member", chapterId: "tokyo" },
        [tokyoMember],
        { kind: "chapter-member", chapterId: "tokyo" },
      ),
    ).toBe(true);
  });

  it("ANDs page class access with the page/channel audience ceiling", () => {
    const restricted = page("restricted", [{ subjectType: "chapter", subjectKey: "tokyo" }]);
    expect(canClassesSeePageInChannel(restricted, [tokyoMember], { kind: "member" })).toBe(false);
    expect(
      canClassesSeePageInChannel(restricted, [tokyoMember], {
        kind: "chapter-member",
        chapterId: "tokyo",
      }),
    ).toBe(true);
  });
});
