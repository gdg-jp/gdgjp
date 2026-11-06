import { describe, expect, it } from "vitest";
import { validateListing } from "./listing";

const base = {
  mode: "mirror",
  title: "DevFest Kansai 2026",
  summary: "AI と越境のカンファレンス",
  description: "本文",
  startAt: "2026-10-18T10:30:00+09:00",
  endAt: "2026-10-18T18:00:00+09:00",
  venue: { name: "国際工科専門職大学 大阪キャンパス" },
  organizer: { name: "GDG Greater Kwansai" },
};

describe("validateListing", () => {
  it("accepts a complete listing", () => {
    expect(validateListing(base)).toMatchObject({ ok: true });
  });
  it("names the missing field", () => {
    expect(validateListing({ ...base, title: "" })).toEqual({ ok: false, error: "missing:title" });
    expect(validateListing({ ...base, venue: {} })).toEqual({
      ok: false,
      error: "missing:venue.name",
    });
  });
  it("needs an https registration URL for a pointer listing", () => {
    expect(validateListing({ ...base, mode: "pointer" })).toEqual({
      ok: false,
      error: "missing:registrationUrl",
    });
    expect(
      validateListing({ ...base, mode: "pointer", registrationUrl: "https://gdgs.jp/df" }),
    ).toMatchObject({ ok: true });
  });
  it("refuses HTML and backwards times", () => {
    expect(validateListing({ ...base, description: "<b>x</b>" })).toEqual({
      ok: false,
      error: "invalid:html",
    });
    expect(validateListing({ ...base, endAt: base.startAt })).toEqual({
      ok: false,
      error: "invalid:time",
    });
  });
});
