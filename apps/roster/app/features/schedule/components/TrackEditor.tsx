import { Badge, Button, Checkbox, FormField, Input } from "@gdgjp/design-system";
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
        <p className="gdg-muted text-sm">
          トラックはまだありません。担当場所や運営チームを追加してください。
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((track, i) => (
            <li
              key={track.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-4 rounded-full border"
                  style={{ backgroundColor: track.color }}
                />
                <span className="font-medium">{track.name}</span>
                {track.shared ? <Badge tone="neutral">全体</Badge> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="moveTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="direction" value="up" />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={i === 0}
                    aria-label={`「${track.name}」を上へ移動`}
                  >
                    ↑
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="moveTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="direction" value="down" />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={i === tracks.length - 1}
                    aria-label={`「${track.name}」を下へ移動`}
                  >
                    ↓
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="deleteTrack" />
                  <input type="hidden" name="trackId" value={track.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <Button type="submit" variant="outline" size="sm">
                    削除
                  </Button>
                </Form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="createTrack" />
        <input type="hidden" name="sheetId" value={sheetId} />
        <FormField label="名前" required className="min-w-44 flex-1">
          <Input name="name" required maxLength={40} placeholder="Track A" />
        </FormField>
        <label className="space-y-1">
          <span className="block text-sm font-medium">色</span>
          <input
            name="color"
            type="color"
            defaultValue={DEFAULT_COLORS[tracks.length % DEFAULT_COLORS.length]}
            className="h-11 w-16 rounded-lg border bg-background p-1"
          />
        </label>
        <label htmlFor="track-shared" className="flex min-h-11 items-center gap-2">
          <Checkbox id="track-shared" name="shared" value="1" />
          <span className="text-sm font-medium">イベント全体</span>
        </label>
        <Button type="submit" variant="secondary">
          トラックを追加
        </Button>
      </Form>
    </div>
  );
}
