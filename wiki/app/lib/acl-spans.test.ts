import { describe, expect, it, vi } from "vitest";
import {
  ACL_REDACTION_PLACEHOLDER,
  aclSpanSourceIds,
  computeAclSourceIdsJson,
  metadataContainsAclTag,
  parseAclSpans,
  redactAclSpans,
  removeAclSpans,
  scrubResidualAclMarkup,
  stripAclSpans,
  validateAclSpans,
} from "./acl-spans";
import {
  audienceContains,
  buildAclSpanPolicy,
  pageAclClearance,
  parseLevelAudienceKey,
  sourceAudienceKey,
  validatePageAclForSync,
  validateReadSourcesTagged,
} from "./acl-spans.server";

describe("parseAclSpans", () => {
  it("parses inline spans", () => {
    const md = 'hello <acl src="abc">secret</acl> world';
    const spans = parseAclSpans(md);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.srcIds).toEqual(["abc"]);
    expect(spans[0]?.body).toBe("secret");
    expect(spans[0]?.block).toBe(false);
  });

  it("parses multi-source src as space-separated ids", () => {
    const spans = parseAclSpans('<acl src="a b">x</acl>');
    expect(spans[0]?.srcIds).toEqual(["a", "b"]);
  });

  it("parses block spans", () => {
    const md = 'before\n<acl src="s1">\nsecret\n</acl>\nafter\n';
    const spans = parseAclSpans(md);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.block).toBe(true);
    expect(spans[0]?.body).toBe("secret");
  });

  it("ignores tags inside code fences", () => {
    const md = '```\n<acl src="x">nope</acl>\n```\n<acl src="y">yes</acl>';
    const spans = parseAclSpans(md);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.srcIds).toEqual(["y"]);
  });

  it("does not throw on malformed input", () => {
    expect(() => parseAclSpans('<acl src="x">unclosed')).not.toThrow();
    expect(parseAclSpans('<acl src="x">unclosed')).toEqual([]);
  });
});

describe("validateAclSpans", () => {
  it("rejects nesting, dual attrs, and missing attrs", () => {
    expect(validateAclSpans('<acl src="a"><acl src="b">x</acl></acl>').ok).toBe(false);
    expect(validateAclSpans('<acl src="a" level="member">x</acl>').ok).toBe(false);
    expect(validateAclSpans("<acl>x</acl>").ok).toBe(false);
    expect(validateAclSpans('<acl src="a">x').ok).toBe(false);
  });

  it("accepts well-formed spans", () => {
    expect(validateAclSpans('a <acl src="x">b</acl> c').ok).toBe(true);
    expect(validateAclSpans('<acl level="organizer">x</acl>').ok).toBe(true);
  });

  it("does not treat fenced examples as ACL tags", () => {
    expect(validateAclSpans('```\n<acl src="x">demo</acl>\n```\nok').ok).toBe(true);
  });
});

describe("redactAclSpans", () => {
  it("never leaves <acl in output when allowed or denied", () => {
    const md = 'visible <acl src="s">secret</acl> end';
    const denied = redactAclSpans(md, () => false);
    expect(denied.markdown).not.toContain("<acl");
    expect(denied.markdown).toContain(ACL_REDACTION_PLACEHOLDER);
    expect(denied.redactedCount).toBe(1);

    const allowed = redactAclSpans(md, () => true);
    expect(allowed.markdown).not.toContain("<acl");
    expect(allowed.markdown).toContain("secret");
    expect(allowed.redactedCount).toBe(0);
  });

  it("collapses block spans to one redaction line", () => {
    const md = 'before\n<acl src="s">\nsecret line\n</acl>\nafter';
    const { markdown } = redactAclSpans(md, () => false);
    expect(markdown).toBe(`before\n${ACL_REDACTION_PLACEHOLDER}\nafter`);
  });

  it("scrubs residual tags from nested and unclosed markup", () => {
    const nested = redactAclSpans('<acl src="a"><acl src="b">x</acl></acl>', () => false);
    expect(nested.markdown).not.toContain("<acl");
    expect(nested.markdown).not.toContain("</acl>");
    expect(nested.markdown).toContain(ACL_REDACTION_PLACEHOLDER);

    const unclosed = redactAclSpans('hi <acl src="x">secret', () => false);
    expect(unclosed.markdown).not.toContain("<acl");
    expect(unclosed.markdown).toBe("hi secret");
  });
});

describe("strip/remove/sourceIds", () => {
  it("strip keeps body; remove drops body", () => {
    const md = 'a <acl src="s">hid</acl> b';
    expect(stripAclSpans(md)).toBe("a hid b");
    expect(removeAclSpans(md)).toBe("a  b");
  });

  it("collects deduplicated source ids", () => {
    expect(aclSpanSourceIds('<acl src="a b">x</acl><acl src="a">y</acl>').sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("unions both locales for acl_source_ids", () => {
    expect(computeAclSourceIdsJson('<acl src="ja1">x</acl>', '<acl src="en1 ja1">y</acl>')).toBe(
      JSON.stringify(["en1", "ja1"]),
    );
  });
});

describe("metadataContainsAclTag", () => {
  it("detects tags in metadata fields", () => {
    expect(metadataContainsAclTag('Title <acl src="x">')).toBe(true);
    expect(metadataContainsAclTag("plain")).toBe(false);
  });
});

describe("audienceContains", () => {
  it("defaults to false for unlisted combinations and public/unlisted pages", () => {
    expect(audienceContains({ kind: "member" }, { visibility: "public", access: [] })).toBe(false);
    expect(audienceContains({ kind: "member" }, { visibility: "unlisted", access: [] })).toBe(
      false,
    );
    expect(audienceContains({ kind: "private" }, { visibility: "organizer", access: [] })).toBe(
      false,
    );
    expect(
      audienceContains(
        { kind: "chapter-organizer", chapterId: "tokyo" },
        { visibility: "restricted", access: [{ subjectType: "chapter", subjectKey: "tokyo" }] },
      ),
    ).toBe(false);
  });

  it("accepts only proven inclusions from the decision table", () => {
    expect(audienceContains({ kind: "member" }, { visibility: "member", access: [] })).toBe(true);
    expect(audienceContains({ kind: "member" }, { visibility: "organizer", access: [] })).toBe(
      true,
    );
    expect(
      audienceContains(
        { kind: "member" },
        {
          visibility: "restricted",
          access: [{ subjectType: "chapter", subjectKey: "tokyo" }],
        },
      ),
    ).toBe(true);
    expect(
      audienceContains(
        { kind: "member" },
        {
          visibility: "restricted",
          access: [
            { subjectType: "chapter", subjectKey: "tokyo" },
            { subjectType: "email", subjectKey: "a@example.com" },
          ],
        },
      ),
    ).toBe(false);
    expect(audienceContains({ kind: "organizer" }, { visibility: "organizer", access: [] })).toBe(
      true,
    );
    expect(audienceContains({ kind: "organizer" }, { visibility: "member", access: [] })).toBe(
      false,
    );
  });

  it("requires spans for incomparable chapter combinations", () => {
    expect(
      audienceContains(
        { kind: "chapter-member", chapterId: "tokyo" },
        {
          visibility: "restricted",
          access: [
            { subjectType: "chapter", subjectKey: "tokyo" },
            { subjectType: "chapter", subjectKey: "osaka" },
          ],
        },
      ),
    ).toBe(false);
    expect(
      audienceContains(
        { kind: "chapter-member", chapterId: "tokyo" },
        {
          visibility: "restricted",
          access: [{ subjectType: "chapter", subjectKey: "tokyo" }],
        },
      ),
    ).toBe(true);
  });

  it("parses level forms used in escape-hatch tags", () => {
    expect(parseLevelAudienceKey("organizer")).toEqual({ kind: "organizer" });
    expect(parseLevelAudienceKey("chapter-member:tokyo")).toEqual({
      kind: "chapter-member",
      chapterId: "tokyo",
    });
    expect(sourceAudienceKey("chapter-organizer", "osaka")).toEqual({
      kind: "chapter-organizer",
      chapterId: "osaka",
    });
  });
});

function mockDb(sourceRows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          all: vi.fn().mockResolvedValue(sourceRows),
        }),
      }),
    }),
  } as never;
}

const tokyoSource = {
  id: "tokyo",
  addedBy: "owner",
  chapterId: "tokyo",
  visibility: "chapter-member",
  status: "ready",
};
const osakaSource = {
  id: "osaka",
  addedBy: "owner",
  chapterId: "osaka",
  visibility: "chapter-member",
  status: "ready",
};
const organizerSource = {
  id: "org-src",
  addedBy: "owner",
  chapterId: null,
  visibility: "organizer",
  status: "ready",
};

describe("independent chapter spans", () => {
  const markdown =
    'open <acl src="tokyo">tokyo-secret</acl> mid <acl src="osaka">osaka-secret</acl> end';

  it("lets a Tokyo-only member read only the Tokyo span", async () => {
    const allow = await buildAclSpanPolicy(
      mockDb([tokyoSource, osakaSource]),
      ["tokyo", "osaka"],
      {
        id: "u1",
        email: "t@example.com",
        name: "T",
        image: null,
        isAdmin: false,
      },
      [{ chapterId: "tokyo", role: "member" }],
    );

    const { markdown: out, redactedCount } = redactAclSpans(markdown, allow);
    expect(out).toContain("tokyo-secret");
    expect(out).toContain(ACL_REDACTION_PLACEHOLDER);
    expect(out).not.toContain("osaka-secret");
    expect(out).not.toContain("<acl");
    expect(redactedCount).toBe(1);
  });

  it("requires membership in both chapters to edit", async () => {
    const user = {
      id: "u1",
      email: "t@example.com",
      name: "T",
      image: null,
      isAdmin: false,
    };
    const db = mockDb([tokyoSource, osakaSource]);
    await expect(
      pageAclClearance(db, [markdown], user, [{ chapterId: "tokyo", role: "member" }]),
    ).resolves.toBe(false);
    await expect(
      pageAclClearance(db, [markdown], user, [
        { chapterId: "tokyo", role: "member" },
        { chapterId: "osaka", role: "member" },
      ]),
    ).resolves.toBe(true);
  });
});

describe("validatePageAclForSync", () => {
  const memberUser = {
    id: "author-1",
    email: "author@example.com",
    name: "Author",
    image: null,
    isAdmin: false,
  };

  it("rejects malformed body and ACL tags in metadata", async () => {
    const db = mockDb([]);
    await expect(
      validatePageAclForSync(
        db,
        { ja: { content: '<acl src="a"><acl src="b">x</acl></acl>' } },
        { pageVisibility: "member", pageAccess: [], citedSourceIds: [], contentJa: "x" },
        memberUser,
        [{ chapterId: "tokyo", role: "member" }],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_malformed" });

    await expect(
      validatePageAclForSync(
        db,
        { ja: { title: 'Title <acl src="x">', content: "ok" } },
        { pageVisibility: "member", pageAccess: [], citedSourceIds: [], contentJa: "ok" },
        memberUser,
        [],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_in_metadata" });
  });

  it("rejects unknown or unreadable span sources", async () => {
    await expect(
      validatePageAclForSync(
        mockDb([]),
        { ja: { content: '<acl src="missing">x</acl>' } },
        {
          pageVisibility: "member",
          pageAccess: [],
          citedSourceIds: [],
          contentJa: '<acl src="missing">x</acl>',
        },
        memberUser,
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_unknown_source", sourceId: "missing" });

    await expect(
      validatePageAclForSync(
        mockDb([organizerSource]),
        { ja: { content: '<acl src="org-src">x</acl>' } },
        {
          pageVisibility: "member",
          pageAccess: [],
          citedSourceIds: [],
          contentJa: '<acl src="org-src">x</acl>',
        },
        memberUser,
        [{ chapterId: "tokyo", role: "member" }],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_unknown_source", sourceId: "org-src" });
  });

  it("requires a span when a cited confidential source is not audience-covered", async () => {
    await expect(
      validatePageAclForSync(
        mockDb([organizerSource]),
        { ja: { content: "plain body with no span" } },
        {
          pageVisibility: "member",
          pageAccess: [],
          citedSourceIds: ["org-src"],
          contentJa: "plain body with no span",
        },
        {
          ...memberUser,
          isAdmin: true,
        },
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_required", sourceId: "org-src" });
  });

  it("accepts a cited organizer source when wrapped in an acl span", async () => {
    const content = 'visible <acl src="org-src">secret</acl>';
    await expect(
      validatePageAclForSync(
        mockDb([organizerSource]),
        { ja: { content } },
        {
          pageVisibility: "member",
          pageAccess: [],
          citedSourceIds: ["org-src"],
          contentJa: content,
        },
        {
          ...memberUser,
          isAdmin: true,
        },
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("unions the stored opposite locale when validating partial-locale content", async () => {
    const contentEn = '<acl src="en1">hidden</acl>';
    const enSource = {
      id: "en1",
      addedBy: "owner",
      chapterId: null,
      visibility: "member",
      status: "ready",
    };
    // First query: span ids from ja∪en; second would be cited (none).
    const db = mockDb([enSource]);
    await expect(
      validatePageAclForSync(
        db,
        { ja: { content: "ja-only update" } },
        {
          pageVisibility: "member",
          pageAccess: [],
          citedSourceIds: [],
          contentJa: "ja-only update",
          storedContentEn: contentEn,
        },
        {
          ...memberUser,
          isAdmin: true,
        },
        [{ chapterId: "tokyo", role: "member" }],
      ),
    ).resolves.toEqual({ ok: true });
    expect(computeAclSourceIdsJson("ja-only update", contentEn)).toBe(JSON.stringify(["en1"]));
  });
});

describe("validateReadSourcesTagged", () => {
  const memberUser = {
    id: "author-1",
    email: "author@example.com",
    name: "Author",
    image: null,
    isAdmin: false,
  };

  it("ignores member-visibility reads and requires a tag for organizer reads", async () => {
    const memberSrc = {
      id: "mem-src",
      visibility: "member",
      chapterId: null,
      status: "ready",
    };
    await expect(
      validateReadSourcesTagged(
        mockDb([memberSrc]),
        [{ slug: "a", visibility: "public", access: [], content: "plain" }],
        ["mem-src"],
        memberUser,
        [],
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      validateReadSourcesTagged(
        mockDb([organizerSource]),
        [
          { slug: "a", visibility: "member", access: [], content: "plain" },
          { slug: "b", visibility: "member", access: [], content: "also plain" },
        ],
        ["org-src"],
        memberUser,
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toMatchObject({ ok: false, error: "acl_untagged_read_source", sourceId: "org-src" });
  });

  it("passes when any one submitted page tags the read source", async () => {
    await expect(
      validateReadSourcesTagged(
        mockDb([organizerSource]),
        [
          { slug: "a", visibility: "member", access: [], content: "plain" },
          {
            slug: "b",
            visibility: "member",
            access: [],
            content: 'tagged <acl src="org-src">secret</acl>',
          },
          { slug: "c", visibility: "public", access: [], content: "untagged" },
        ],
        ["org-src"],
        memberUser,
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("passes when every submitted page audience-covers the source", async () => {
    await expect(
      validateReadSourcesTagged(
        mockDb([organizerSource]),
        [
          { slug: "a", visibility: "organizer", access: [], content: "plain" },
          { slug: "b", visibility: "organizer", access: [], content: "also plain" },
        ],
        ["org-src"],
        memberUser,
        [{ chapterId: "tokyo", role: "organizer" }],
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("server-side run-level check fails on empty pages (CLI short-circuits before calling)", async () => {
    // Direct API / library callers with readSourceIds and no pages still fail
    // acl_untagged_read_source. `gdg wiki verify-acl` intentionally returns OK
    // without calling the server when dirty/diff, tip history, and Writes are
    // all empty — so this empty-pages failure is not the CLI contract.
    await expect(
      validateReadSourcesTagged(mockDb([organizerSource]), [], ["org-src"], memberUser, [
        { chapterId: "tokyo", role: "organizer" },
      ]),
    ).resolves.toMatchObject({ ok: false, error: "acl_untagged_read_source", sourceId: "org-src" });
  });
});

describe("scrubResidualAclMarkup", () => {
  it("is a no-op when no acl markers remain", () => {
    expect(scrubResidualAclMarkup("plain")).toBe("plain");
  });
});
