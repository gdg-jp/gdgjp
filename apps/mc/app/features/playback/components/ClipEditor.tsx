import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  Button,
  FormField,
  IconButton,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Spinner,
  Textarea,
  toast,
} from "@gdgjp/design-system";
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { fixNotation, segmentsFromLines, splitPhrases } from "~/features/clips/align";
import { type AudioAnalysis, analyzeAudio } from "~/features/clips/analyze-audio";
import { type Clip, type UploadedClip, tracks } from "~/features/clips/catalog";
import { useCatalog } from "~/features/clips/catalog-context";
import { UPLOAD_ACCEPT } from "~/features/clips/clip-input";
import { formatTime } from "~/features/clips/transcript";
import { useController } from "./controller-context";

export type EditorMode = { kind: "new"; track: string | null } | { kind: "edit"; clipId: string };

const EditorContext = createContext<((mode: EditorMode) => void) | null>(null);

export function useOpenEditor(): (mode: EditorMode) => void {
  const open = useContext(EditorContext);
  if (!open) throw new Error("useOpenEditor outside ClipEditorProvider");
  return open;
}

/** One add/edit sheet per screen; every ＋ and ✎ opens it. */
export function ClipEditorProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ id: number; mode: EditorMode } | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const start = (mode: EditorMode) => {
    seq.current += 1;
    setSession({ id: seq.current, mode });
    setOpen(true);
  };
  return (
    <EditorContext.Provider value={start}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="mc-editor">
          {session && (
            <EditorBody key={session.id} mode={session.mode} onDone={() => setOpen(false)} />
          )}
        </SheetContent>
      </Sheet>
    </EditorContext.Provider>
  );
}

const COMMON = "common";
const FIRST = "__first__";

function groupOf(track: string | null): string {
  return track ?? COMMON;
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function EditorBody({ mode, onDone }: { mode: EditorMode; onDone: () => void }) {
  const { catalog, uploaded, setUploaded } = useCatalog();
  const { confirmExtra } = useController();
  // Snapshot at open: a room push while the sheet is open must not reset the form.
  const [editing] = useState(() =>
    mode.kind === "edit" ? (uploaded.find((c) => c.id === mode.clipId) ?? null) : null,
  );
  const groupClips = (group: string): Clip[] =>
    (group === COMMON ? catalog.common : (catalog.byTrack[group] ?? [])).filter(
      (c) => c.id !== editing?.id,
    );
  const lastOf = (group: string) => groupClips(group).at(-1)?.id ?? "";

  const initialGroup = editing
    ? groupOf(editing.track)
    : groupOf(mode.kind === "new" ? mode.track : null);
  const [group, setGroup] = useState(initialGroup);
  const [after, setAfter] = useState(editing ? (editing.after ?? "") : lastOf(initialGroup));
  const [title, setTitle] = useState(editing?.title ?? "");
  const [text, setText] = useState(editing ? editing.segments.map((s) => s.t).join("\n") : "");
  const [file, setFile] = useState<{ name: string; durationMs: number } | null>(
    editing ? { name: editing.file, durationMs: editing.durationMs } : null,
  );
  const [uploadId, setUploadId] = useState<string | null>(editing?.id ?? null);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "uploading" | "ready">(
    editing ? "ready" : "idle",
  );
  const [saving, setSaving] = useState(false);
  const analysis = useRef<Promise<AudioAnalysis | null> | null>(null);
  const textTouched = useRef(false);
  const committed = useRef(false);
  const pendingId = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Editing re-aligns typed lines onto the audio's pauses: decode it once.
  useEffect(() => {
    if (!editing) return;
    analysis.current = fetch(editing.src)
      .then((r) => r.blob())
      .then(analyzeAudio)
      .catch(() => null);
  }, [editing]);

  // A new upload that is never registered is removed again.
  useEffect(
    () => () => {
      const id = pendingId.current;
      if (id && !committed.current) {
        void fetch(`/api/clips/${id}`, { method: "DELETE", keepalive: true });
      }
    },
    [],
  );

  const onFile = async (picked: File | undefined) => {
    if (!picked) return;
    setPhase("analyzing");
    const decoded = analyzeAudio(picked).catch(() => null);
    analysis.current = decoded;
    const result = await decoded;
    if (!result) {
      toast.error("この音声は読み込めません", { id: "decode-failed" });
      setPhase("idle");
      return;
    }
    setFile({ name: picked.name, durationMs: result.durationMs });
    setTitle((t) => t || stem(picked.name));
    setPhase("uploading");

    const form = new FormData();
    form.set("file", picked);
    try {
      const res = await fetch("/api/clips/upload", { method: "POST", body: form });
      const data = (await res.json()) as {
        id?: string;
        text?: string;
        transcribeError?: string;
        error?: string;
      };
      if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      pendingId.current = data.id;
      setUploadId(data.id);
      if (data.text && !textTouched.current) {
        setText(splitPhrases(fixNotation(data.text)).join("\n"));
      } else if (data.transcribeError && data.transcribeError !== "no-key") {
        toast.error("文字起こしできませんでした", {
          id: "transcribe-failed",
          description: data.transcribeError,
        });
      }
      setPhase("ready");
    } catch (err) {
      toast.error("アップロードできませんでした", {
        id: "upload-failed",
        description: String(err),
      });
      setFile(null);
      setPhase("idle");
    }
  };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const canSave = phase === "ready" && uploadId && file && title.trim() && lines.length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const unchanged =
        editing && lines.join("\n") === editing.segments.map((s) => s.t.trim()).join("\n");
      const durationMs = file.durationMs;
      const segments = unchanged
        ? editing.segments
        : segmentsFromLines(lines, (await analysis.current)?.silences ?? [], durationMs);
      const body = {
        track: group === COMMON ? null : group,
        after: after || null,
        title: title.trim(),
        segments,
      };
      const res = editing
        ? await fetch(`/api/clips/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/clips", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...body, id: uploadId, file: file.name, durationMs }),
          });
      const data = (await res.json()) as { clips?: UploadedClip[]; error?: string };
      if (!res.ok || !data.clips) throw new Error(data.error ?? `HTTP ${res.status}`);
      committed.current = true;
      setUploaded(data.clips);
      onDone();
    } catch (err) {
      toast.error(editing ? "保存できませんでした" : "登録できませんでした", {
        id: "save-failed",
        description: String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || !(await confirmExtra("deleteClip"))) return;
    const res = await fetch(`/api/clips/${editing.id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { clips?: UploadedClip[] };
    if (!res.ok || !data.clips) {
      toast.error("削除できませんでした", { id: "delete-failed" });
      return;
    }
    committed.current = true;
    setUploaded(data.clips);
    onDone();
  };

  const busy = phase === "analyzing" || phase === "uploading";

  return (
    <div className="mc-editor-body">
      <SheetTitle className="mc-editor-title">
        {editing ? (
          <Icons name="Pencil" size={18} aria-hidden="true" />
        ) : (
          <Icons name="Plus" size={18} aria-hidden="true" />
        )}
        <span className="sr-only">{editing ? "音声を編集" : "音声を追加"}</span>
      </SheetTitle>
      <SheetDescription className="sr-only">音声ファイルと表示テキスト</SheetDescription>

      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        hidden
        data-testid="clip-file"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <Attachment
          state={
            phase === "uploading" ? "uploading" : phase === "analyzing" ? "processing" : "done"
          }
          className="mc-editor-file"
        >
          <AttachmentMedia>
            {busy ? <Spinner label="処理中" /> : <Icons name="Mic" size={18} aria-hidden="true" />}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{file.name}</AttachmentTitle>
            <AttachmentDescription>{formatTime(file.durationMs)}</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ) : (
        <button
          type="button"
          className="mc-dropzone"
          aria-label="音声ファイルを選択"
          aria-busy={busy || undefined}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
        >
          {busy ? <Spinner label="処理中" /> : <Icons name="Upload" size={24} aria-hidden="true" />}
        </button>
      )}

      <div className="mc-editor-row">
        <FormField label="トラック">
          <Select
            value={group}
            onValueChange={(value) => {
              setGroup(value);
              setAfter(lastOf(value));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tracks.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
              <SelectItem value={COMMON}>共通</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="位置" className="mc-editor-after">
          {/* Radix Select items cannot use "" as a value; FIRST stands for "no predecessor". */}
          <Select
            value={after || FIRST}
            onValueChange={(value) => setAfter(value === FIRST ? "" : value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FIRST}>先頭</SelectItem>
              {groupClips(group).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.uploaded ? c.title : `${c.id} ${c.title}`} の後
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField label="見出し">
        <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </FormField>

      <FormField label="テキスト" className="mc-editor-text">
        <Textarea
          rows={10}
          value={text}
          aria-busy={phase === "uploading" || undefined}
          placeholder={phase === "uploading" ? "文字起こし中…" : undefined}
          onChange={(e) => {
            textTouched.current = true;
            setText(e.target.value);
          }}
        />
      </FormField>

      <div className="mc-editor-actions">
        {editing && (
          <IconButton
            aria-label="削除"
            variant="ghost"
            className="mc-editor-delete"
            onClick={remove}
          >
            <Icons name="Trash2" size={18} aria-hidden="true" />
          </IconButton>
        )}
        <Button variant="outline" onClick={onDone}>
          キャンセル
        </Button>
        <Button variant="primary" disabled={!canSave} loading={saving} onClick={save}>
          {editing ? "保存" : "登録"}
        </Button>
      </div>
    </div>
  );
}
