import { describe, expect, it } from "vitest";
import { collectPhotos } from "./server.mjs";

describe("collectPhotos", () => {
  it("accumulates photos from every virtualized album viewport", async () => {
    const viewports = Array.from({ length: 5 }, (_, viewport) =>
      Array.from({ length: 27 }, (_, index) => {
        const id = viewport * 27 + index;
        return {
          stableId: `photo-${id}`,
          url: `https://lh3.googleusercontent.com/photo-${id}=w1600`,
          idSource: "dom",
        };
      }),
    );
    let viewport = 0;
    let extracting = true;
    const page = {
      evaluate: async () => {
        if (extracting) {
          extracting = false;
          return viewports[viewport];
        }
        extracting = true;
        const advanced = viewport < viewports.length - 1;
        if (advanced) viewport += 1;
        return { advanced, atEnd: !advanced };
      },
      waitForTimeout: async () => {},
    };

    const photos = await collectPhotos(page);

    expect(photos).toHaveLength(135);
    expect(new Set(photos.map((photo) => photo.stableId))).toHaveLength(135);
  });
});
