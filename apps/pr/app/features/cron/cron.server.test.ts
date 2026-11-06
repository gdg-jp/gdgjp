import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOURLY_CRON, MINUTE_CRON, WEEKLY_CRON } from "./cron.server";

describe("crons", () => {
  it("match [triggers] crons in wrangler.toml", () => {
    const toml = readFileSync(new URL("../../../wrangler.toml", import.meta.url), "utf8");
    const line = toml.split("\n").find((l) => l.startsWith("crons ="));
    expect(JSON.parse(line?.slice("crons =".length) ?? "[]")).toEqual([
      MINUTE_CRON,
      HOURLY_CRON,
      WEEKLY_CRON,
    ]);
  });
});
