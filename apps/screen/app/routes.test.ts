import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isStageId } from "~/features/stage/stage-id";
import routes from "./routes";

const WORKER_SEGMENTS = ["ws", "rtc"];
const BUILD_ASSET_SEGMENTS = ["assets"];

const publicEntries = readdirSync(fileURLToPath(new URL("../public", import.meta.url)));

const firstSegment = (path: string) => path.split("/")[0] ?? "";

describe("route table", () => {
  it("ends with the /:invite catch-all and has no other dynamic first segment", () => {
    const paths = routes.map((r) => r.path ?? "");
    expect(paths.at(-1)).toBe(":invite");
    const dynamic = paths.filter((p) => firstSegment(p).startsWith(":"));
    expect(dynamic).toEqual([":invite"]);
  });

  it("reserves every first segment the app serves, so no stage id shadows it", () => {
    const served = [
      ...routes
        .filter((r) => !r.index)
        .map((r) => firstSegment(r.path ?? ""))
        .filter((s) => !s.startsWith(":")),
      ...WORKER_SEGMENTS,
      ...BUILD_ASSET_SEGMENTS,
      ...publicEntries,
    ];
    for (const segment of new Set(served)) {
      expect(isStageId(segment), segment).toBe(false);
    }
  });
});
