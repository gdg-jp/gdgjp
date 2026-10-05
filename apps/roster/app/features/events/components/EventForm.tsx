import { Form, useNavigation } from "react-router";
import type { UserChapter } from "~/features/auth/chapter.server";

const STEP_OPTIONS = [15, 30, 60] as const;

/**
 * `/events/new`'s creation form (docs/roster/02-domain-schema.md "Design"
 * §6). Chapter is only shown as a picker when the user belongs to more than
 * one — matching `ost/app/routes/home.tsx`'s creation form, which is this
 * app's closest UI precedent (ADR-001: no local UI-primitive layer, plain
 * Tailwind on top of gdg-lib's color tokens).
 */
export function EventForm({
  chapters,
  error,
}: {
  chapters: readonly UserChapter[];
  error?: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <Form method="post" className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">イベント名</span>
        <input
          name="name"
          required
          maxLength={120}
          placeholder="DevFest Tokyo 2026"
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        />
      </label>

      {chapters.length > 1 ? (
        <label className="block space-y-1">
          <span className="text-sm font-medium">チャプター</span>
          <select
            name="chapterId"
            required
            defaultValue={chapters[0]?.chapterId}
            className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          >
            {chapters.map((c) => (
              <option key={c.chapterId} value={c.chapterId}>
                {c.chapterSlug}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="chapterId" value={chapters[0]?.chapterId} />
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">開催日</span>
        <input
          name="date"
          type="date"
          required
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">開始</span>
          <input
            name="startTime"
            type="time"
            required
            defaultValue="09:00"
            className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">終了</span>
          <input
            name="endTime"
            type="time"
            required
            defaultValue="19:00"
            className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">刻み幅</span>
        <select
          name="stepMin"
          required
          defaultValue={60}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          {STEP_OPTIONS.map((min) => (
            <option key={min} value={min}>
              {min}分
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95 disabled:opacity-60"
      >
        {submitting ? "作成中…" : "作成する"}
      </button>
    </Form>
  );
}
