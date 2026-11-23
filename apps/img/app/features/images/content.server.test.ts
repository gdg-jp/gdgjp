import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { replaceImageForActor, setMobileImageForActor } from "./content.server";
import { fakeImageBindings, imageRecord } from "./test-bindings";

const actor = {
  user: { id: "owner", email: "owner@example.com", name: "Owner", image: null } as AuthUser,
  chapters: [{ chapterId: 1, chapterSlug: "one", role: "member" as const }],
};

function svg(name = "new.svg") {
  return new File(["<svg/>"], name, { type: "image/svg+xml" });
}

describe("replaceImageForActor", () => {
  it("records the new bytes in D1 before overwriting the public R2 object", async () => {
    const h = fakeImageBindings({ images: [imageRecord()] });
    const result = await replaceImageForActor(h.env, h.ctx, actor, "img12345", svg());
    expect(result.ok).toBe(true);
    expect(h.events).toEqual(["d1:update images", "r2:put img12345"]);
  });

  it("leaves the public R2 object untouched when D1 rejects the update", async () => {
    const h = fakeImageBindings({
      images: [imageRecord()],
      failD1: (sql) => sql.startsWith("UPDATE images"),
    });
    await expect(replaceImageForActor(h.env, h.ctx, actor, "img12345", svg())).rejects.toThrow(
      "D1 failed",
    );
    expect(h.events.filter((event) => event.startsWith("r2:"))).toEqual([]);
  });

  it("restores the previous D1 metadata when the R2 write fails", async () => {
    const h = fakeImageBindings({ images: [imageRecord()], failR2Put: true });
    await expect(replaceImageForActor(h.env, h.ctx, actor, "img12345", svg())).rejects.toThrow(
      "R2 failed",
    );
    expect(h.events).toEqual(["d1:update images", "r2:put img12345", "d1:update images"]);
    expect(h.image("img12345")).toMatchObject({
      content_type: "image/png",
      byte_size: 100,
      filename: "old.png",
    });
  });
});

describe("setMobileImageForActor", () => {
  it("records the mobile variant in D1 before writing it to R2", async () => {
    const h = fakeImageBindings({ images: [imageRecord()] });
    const result = await setMobileImageForActor(h.env, h.ctx, actor, "img12345", svg());
    expect(result.ok).toBe(true);
    expect(h.events).toEqual(["d1:update images", "r2:put img12345/mobile"]);
  });

  it("clears the mobile variant again when the R2 write fails", async () => {
    const h = fakeImageBindings({ images: [imageRecord()], failR2Put: true });
    await expect(setMobileImageForActor(h.env, h.ctx, actor, "img12345", svg())).rejects.toThrow(
      "R2 failed",
    );
    expect(h.image("img12345")).toMatchObject({ mobile_r2_key: null, mobile_content_type: null });
  });
});
