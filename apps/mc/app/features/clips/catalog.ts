import data from "./clips.json";

export type Segment = { s: number; e: number; t: string };

export type Clip = {
  id: string;
  track: string | null;
  file: string;
  title: string;
  src: string;
  durationMs: number;
  loop: boolean;
  segments: Segment[];
  uploaded?: true;
};

export type UploadedClip = Clip & { uploaded: true; after: string | null; createdAt: number };

export const bundledClips: Clip[] = (data as { clips: Clip[] }).clips;

export const tracks: string[] = [...new Set(bundledClips.map((c) => c.track))]
  .filter((t): t is string => t !== null)
  .sort();

export function isTrack(id: string | null | undefined): id is string {
  return tracks.some((t) => t === id);
}

export function playableOn(clip: Pick<Clip, "track">, track: string): boolean {
  return clip.track === null || clip.track === track;
}

export function uploadedSrc(id: string): string {
  return `/media/${id}`;
}

function placeGroup(bundled: Clip[], uploaded: UploadedClip[]): Clip[] {
  const ordered = [...uploaded].sort((a, b) => a.createdAt - b.createdAt);
  const followers = new Map<string | null, UploadedClip[]>();
  for (const u of ordered) {
    const list = followers.get(u.after) ?? [];
    list.push(u);
    followers.set(u.after, list);
  }
  const out: Clip[] = [];
  const seen = new Set<string>();
  const emit = (clip: Clip) => {
    if (seen.has(clip.id)) return;
    seen.add(clip.id);
    out.push(clip);
    for (const f of followers.get(clip.id) ?? []) emit(f);
  };
  for (const f of followers.get(null) ?? []) emit(f);
  for (const clip of bundled) emit(clip);
  for (const u of ordered) emit(u);
  return out;
}

export type Catalog = {
  all: Clip[];
  common: Clip[];
  byTrack: Record<string, Clip[]>;
  get: (id: string | null | undefined) => Clip | undefined;
  forTrack: (track: string) => Clip[];
};

export function buildCatalog(uploaded: UploadedClip[] = []): Catalog {
  const group = (track: string | null) =>
    placeGroup(
      bundledClips.filter((c) => c.track === track),
      uploaded.filter((c) => c.track === track),
    );
  const common = group(null);
  const byTrack = Object.fromEntries(tracks.map((t) => [t, group(t)]));
  const all = [...common, ...tracks.flatMap((t) => byTrack[t])];
  const byId = new Map(all.map((c) => [c.id, c]));
  return {
    all,
    common,
    byTrack,
    get: (id) => (id ? byId.get(id) : undefined),
    forTrack: (track) => [...common, ...(byTrack[track] ?? [])],
  };
}
