import { describe, expect, it } from "vitest";
import {
  collectSourceKinds,
  countSourceViews,
  filterSources,
  parseSourceFilters,
  serializeCsvParam,
} from "./filter-sources";

const samples = [
  {
    title: "Organizer Doc",
    url: "https://docs.google.com/document/d/1",
    kind: "google-doc",
    status: "ready",
  },
  {
    title: "Chat Space",
    url: "https://mail.google.com/chat/u/0/#chat/space/AAA",
    kind: "google-chat-space",
    status: "fetching",
  },
  {
    title: "Old Sheet",
    url: "https://docs.google.com/spreadsheets/d/2",
    kind: "google-sheet",
    status: "archived",
  },
  {
    title: "Broken site",
    url: "https://example.com/page",
    kind: "website",
    status: "error",
  },
];

describe("filterSources", () => {
  it("keeps only non-archived sources in the active view", () => {
    expect(
      filterSources(samples, { view: "active", q: "", kind: [], status: [] }).map((s) => s.title),
    ).toEqual(["Organizer Doc", "Chat Space", "Broken site"]);
  });

  it("keeps only archived sources in the archived view", () => {
    expect(
      filterSources(samples, { view: "archived", q: "", kind: [], status: [] }).map((s) => s.title),
    ).toEqual(["Old Sheet"]);
  });

  it("matches q against title and URL case-insensitively", () => {
    expect(
      filterSources(samples, { view: "active", q: "EXAMPLE.COM", kind: [], status: [] }).map(
        (s) => s.title,
      ),
    ).toEqual(["Broken site"]);
    expect(
      filterSources(samples, { view: "active", q: "organizer", kind: [], status: [] }).map(
        (s) => s.title,
      ),
    ).toEqual(["Organizer Doc"]);
  });

  it("applies kind and status as an intersection in the active view", () => {
    expect(
      filterSources(samples, {
        view: "active",
        q: "",
        kind: ["google-doc", "website"],
        status: ["error"],
      }).map((s) => s.title),
    ).toEqual(["Broken site"]);
  });

  it("ignores status filter in the archived view", () => {
    expect(
      filterSources(samples, {
        view: "archived",
        q: "",
        kind: [],
        status: ["ready"],
      }).map((s) => s.title),
    ).toEqual(["Old Sheet"]);
  });

  it("returns all sources in the view when filters are empty", () => {
    expect(filterSources(samples, { view: "active", q: "", kind: [], status: [] })).toHaveLength(3);
  });
});

describe("parseSourceFilters", () => {
  it("parses view, q, kind, and status from search params", () => {
    const params = new URLSearchParams(
      "view=archived&q=hello&kind=google-doc,website&status=ready,bogus,error",
    );
    expect(parseSourceFilters(params)).toEqual({
      view: "archived",
      q: "hello",
      kind: ["google-doc", "website"],
      status: ["ready", "error"],
    });
  });

  it("defaults view to active", () => {
    expect(parseSourceFilters(new URLSearchParams()).view).toBe("active");
  });
});

describe("helpers", () => {
  it("counts active and archived sources", () => {
    expect(countSourceViews(samples)).toEqual({ active: 3, archived: 1 });
  });

  it("collects sorted unique kinds", () => {
    expect(collectSourceKinds(samples)).toEqual([
      "google-chat-space",
      "google-doc",
      "google-sheet",
      "website",
    ]);
  });

  it("serializes csv params", () => {
    expect(serializeCsvParam(["google-doc", "website"])).toBe("google-doc,website");
    expect(serializeCsvParam([])).toBeNull();
  });
});
