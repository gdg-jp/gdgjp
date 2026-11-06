import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Brief } from "~/features/briefs/brief";
import { constants, runChecks } from "~/features/playbook/playbook";
import { livePostsFromTimetable } from "./live-posts-from-timetable";

const brief = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Brief;
const live = constants.live;

describe("livePostsFromTimetable", () => {
  const posts = livePostsFromTimetable(brief, live);
  const sessionPosts = posts.filter((p) => p.purpose === "live");

  it("makes one start post per public session, in time order", () => {
    const publicSessions = brief.sessions.filter((s) => s.status === "public" && s.startAt);
    expect(sessionPosts).toHaveLength(publicSessions.length);
    const times = posts.map((p) => p.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("is deterministic and independent of the brief's session order", () => {
    const shuffled = { ...brief, sessions: [...brief.sessions].reverse() };
    expect(livePostsFromTimetable(shuffled, live)).toEqual(posts);
  });

  it("adds notes from flags and a stream line only where the track streams", () => {
    const flagged = {
      ...brief,
      event: { ...brief.event, streamUrls: { "Track A": "https://gdgs.jp/a" } },
      sessions: [
        {
          id: "s1",
          title: "A",
          track: "Track A",
          startAt: "2026-10-18T11:00:00+09:00",
          speakerIds: [],
          status: "public" as const,
          flags: ["no_recording" as const, "english" as const],
        },
        {
          id: "s2",
          title: "B",
          track: "Track D",
          startAt: "2026-10-18T11:00:00+09:00",
          speakerIds: [],
          status: "public" as const,
        },
      ],
    };
    const [a, b] = livePostsFromTimetable(flagged, live);
    expect(a?.text).toContain(live.flagNotes.noRecording);
    expect(a?.text).toContain(live.flagNotes.english);
    expect(a?.text).toContain("https://gdgs.jp/a");
    expect(b?.text).not.toContain(live.streamPrefix);
  });

  it("carries the event hashtag and passes the live rules", () => {
    for (const post of sessionPosts.slice(0, 5)) {
      expect(post.text).toContain(brief.event.hashtag);
      const report = runChecks({
        kind: "x_post",
        draft: {
          channel: "x",
          posts: [
            {
              purpose: "live",
              text: post.text,
              textAboveFold: post.text,
              textBelowFold: "",
              attachment: { kind: "image", imageSlots: null, link: null },
            },
          ],
          notes: null,
        },
        brief,
      });
      const byId = Object.fromEntries(report.results.map((r) => [r.ruleId, r.status]));
      expect(byId["LIVE-EVENT-HASHTAG"]).not.toBe("fail");
      expect(byId["X-NO-HASHTAG"]).not.toBe("fail");
    }
  });
});
