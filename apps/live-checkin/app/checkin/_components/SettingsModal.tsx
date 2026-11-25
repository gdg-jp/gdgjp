"use client";

import { X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

export type EventsState =
  | { status: "loading" }
  | { status: "ready"; events: EventSummary[] }
  | { status: "error"; message: string };

type SettingsModalProps = {
  groupId: string;
  eventId: string;
  events: EventsState;
  onReloadEvents: () => void;
  onSave: (values: { groupId: string; eventId: string }) => void;
  onClose: () => void;
  configured: boolean;
};

function formatStartAt(startAt: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return startAt;
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SettingsModal({
  groupId,
  eventId,
  events,
  onReloadEvents,
  onSave,
  onClose,
  configured,
}: SettingsModalProps) {
  const [draftGroupId, setDraftGroupId] = useState<string>(groupId);
  const [draftEventId, setDraftEventId] = useState<string>(eventId);

  const choices = events.status === "ready" ? events.events : [];
  const closable = configured || (events.status !== "loading" && choices.length === 0);
  const canSave = draftGroupId.trim() !== "" && choices.some((ev) => ev.id === draftEventId);

  useEffect(() => {
    if (!closable) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closable, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({ groupId: draftGroupId.trim(), eventId: draftEventId.trim() });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled by the window keydown listener
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closable ? onClose : undefined}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: click only stops propagation to the backdrop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-sm rounded-md bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="settings-modal-title" className="text-base font-bold text-zinc-900">
            受付設定
          </h2>
          {closable && (
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="rounded p-1 text-zinc-500 transition hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="mb-3 text-xs text-zinc-600">受付を行うイベントを以下から選択して下さい。</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-zinc-700">
              イベント（直近のものから順に表示）
            </legend>
            {events.status === "loading" && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                イベントを取得中...
              </div>
            )}
            {events.status === "error" && (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 text-xs text-red-600"
              >
                <span className="flex flex-col">
                  <span>イベントの取得に失敗しました</span>
                  <span className="text-zinc-600">{events.message}</span>
                </span>
                <button
                  type="button"
                  onClick={onReloadEvents}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  再読み込み
                </button>
              </div>
            )}
            {events.status === "ready" && choices.length === 0 && (
              <p className="text-xs text-zinc-500">選択可能なイベントがありません</p>
            )}
            {choices.map((ev) => (
              <label
                key={ev.id}
                className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-sm transition ${
                  draftEventId === ev.id
                    ? "border-red-600 bg-red-50"
                    : "border-zinc-300 hover:bg-zinc-50"
                }`}
              >
                <input
                  type="radio"
                  name="eventId"
                  value={ev.id}
                  checked={draftEventId === ev.id}
                  onChange={() => setDraftEventId(ev.id)}
                  className="mt-1 accent-red-600"
                />
                <span className="flex flex-col">
                  <span className="font-medium text-zinc-900">{ev.title}</span>
                  <span className="text-xs text-zinc-500">{formatStartAt(ev.startAt)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="mt-1 flex justify-end gap-2">
            {closable && (
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                キャンセル
              </button>
            )}
            <button
              type="submit"
              disabled={!canSave}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
