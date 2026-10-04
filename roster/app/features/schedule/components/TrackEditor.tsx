import { Form } from "react-router";
import type { Track } from "~/features/schedule/tracks.server";

const DEFAULT_COLORS = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#673ab7", "#00acc1"];

/**
 * The "トラックの追加・並べ替え・削除" card on `/e/:id/design`
 * (docs/roster/index.md §3 "トラック"). Reordering is two adjacent-swap
 * buttons rather than drag-and-drop — no extra dependency, and the route
 * action recomputes the full sort_order list from the swap
 * (`tracks.server.ts#reorderTracks` takes the whole ordered id list, not a
 * single-step move).
 */
export function TrackEditor({ tracks, sheetId }: { tracks: Track[]; sheetId: string }) {
  return (
    <div className="space-y-4">
      {tracks.length === 0 ? (
        <p className="text-sm text-neutral-600">トラックはまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((track, i) => (
            <li
              key={track.id}
              className="flex items-center justify-between gap-3 rounded-xl border-2 border-border bg-surface p-3"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-4 rounded-full border border-border"
                  style={{ backgroundColor: track.color }}
                />
                <span className="font-medium">{track.name}</span>
                {track.shared ? (
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-bold text-neutral-700">
                    全体
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3">
                <Form method="post">
                  <input type="hidden" name="intent" value="moveTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="direction" value="up" />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <button
                    type="submit"
                    disabled={i === 0}
                    className="disabled:opacity-30"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="moveTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="direction" value="down" />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <button
                    type="submit"
                    disabled={i === tracks.length - 1}
                    className="disabled:opacity-30"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="deleteTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <button type="submit" className="text-sm font-medium text-gdg-red underline">
                    削除
                  </button>
                </Form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="createTrack" />
        <input type="hidden" name="sheetId" value={sheetId} />
        <label className="space-y-1">
          <span className="block text-sm font-medium">名前</span>
          <input
            name="name"
            required
            maxLength={40}
            placeholder="Track A"
            className="rounded-xl border-2 border-border bg-surface p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-medium">色</span>
          <input
            name="color"
            type="color"
            defaultValue={DEFAULT_COLORS[tracks.length % DEFAULT_COLORS.length]}
            className="h-11 w-16 rounded-xl border-2 border-border bg-surface p-1"
          />
        </label>
        <label className="flex items-center gap-2 pb-2.5">
          <input name="shared" type="checkbox" value="1" className="size-4" />
          <span className="text-sm font-medium">全体（shared）</span>
        </label>
        <button
          type="submit"
          className="rounded-full border-2 border-border bg-surface px-4 py-2 font-bold transition hover:bg-neutral-100"
        >
          トラックを追加
        </button>
      </Form>
    </div>
  );
}
