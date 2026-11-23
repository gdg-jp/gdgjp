import type { Brief } from "~/features/briefs/brief";
import { renderTemplate } from "~/features/notify/discord";
import { jstTime } from "~/features/schedule/calendar";

type LiveConstants = {
  flagNotes: Record<string, string>;
  streamPrefix: string;
  trackEmoji: string[];
  photoAfterMinutes: number;
  templates: Record<string, string>;
};

export type LivePost = {
  key: string;
  sessionId: string | null;
  purpose: "live" | "photo";
  at: number;
  title: string;
  text: string;
  track: string | null;
  card: {
    time: string;
    track: string;
    sessionTitle: string;
    speakerName: string;
    flags: string[];
  } | null;
};

const FLAG_KEYS: Record<string, string> = {
  no_recording: "noRecording",
  english: "english",
  onsite_only: "onsiteOnly",
  bring_pc: "bringPc",
};
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function livePostsFromTimetable(brief: Brief, live: LiveConstants): LivePost[] {
  const speakers = new Map(brief.speakers.map((s) => [s.id, s.name]));
  const tracks = [
    ...new Set(brief.sessions.map((s) => s.track).filter((t): t is string => !!t)),
  ].sort();
  const hashtag = brief.event.hashtag ?? "";
  const sessions = brief.sessions
    .filter((s) => s.status === "public" && s.startAt)
    .sort(
      (a, b) =>
        epoch(a.startAt as string) - epoch(b.startAt as string) ||
        (a.track ?? "").localeCompare(b.track ?? "") ||
        a.id.localeCompare(b.id),
    );
  const posts: LivePost[] = [];
  for (const s of sessions) {
    const at = epoch(s.startAt as string);
    const time = jstTime(at);
    const track = s.track ?? "";
    const names = s.speakerIds.map((id) => speakers.get(id)).filter(Boolean) as string[];
    const flags = (s.flags ?? [])
      .map((f) => live.flagNotes[FLAG_KEYS[f] ?? ""])
      .filter(Boolean) as string[];
    const stream =
      track && brief.event.streamUrls?.[track]
        ? `${live.streamPrefix} ${brief.event.streamUrls[track]}`
        : "";
    const emoji =
      live.trackEmoji[Math.max(0, tracks.indexOf(track)) % live.trackEmoji.length] ?? "";
    const text = renderTemplate(live.templates.session ?? "", {
      emoji,
      time,
      track,
      title: s.title,
      speakers: names.length ? `${names.join("・")} 氏` : "",
      flags: flags.join("\n"),
      stream,
      hashtag,
    }).replace(/👤\n/, "");
    posts.push({
      key: `live:${s.id}`,
      sessionId: s.id,
      purpose: "live",
      at,
      title: `実況: ${time} ${s.title}`,
      text,
      track: track || null,
      card: { time, track, sessionTitle: s.title, speakerName: names.join("・"), flags },
    });
    if (s.endAt)
      posts.push({
        key: `photo:${s.id}`,
        sessionId: s.id,
        purpose: "photo",
        at: epoch(s.endAt) + live.photoAfterMinutes * 60,
        title: `写真: ${s.title}`,
        text: [`『${s.title}』の様子です！`, hashtag].filter(Boolean).join("\n"),
        track: track || null,
        card: null,
      });
  }
  return posts.sort(
    (a, b) =>
      a.at - b.at || (a.track ?? "").localeCompare(b.track ?? "") || a.key.localeCompare(b.key),
  );
}
