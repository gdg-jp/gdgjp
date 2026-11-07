import { Alert, Button, Icons, Textarea } from "@gdgjp/design-system";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

const MAX_SIDE = 2048;
const RESIZE_OVER = 1_500_000;

/** Phone photos are large: shrink images in the browser before they are sent (JPEG, 2048px). */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= RESIZE_OVER) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  return blob
    ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" })
    : file;
}

/** Where people write to the assistant: text, URLs and files in one box. */
export function Composer({ disabled }: { disabled?: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      form.current?.reset();
      setFiles([]);
    }
  }, [fetcher.state, fetcher.data]);
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = await Promise.all([...(event.target.files ?? [])].slice(0, 6).map(shrink));
    const transfer = new DataTransfer();
    for (const f of picked) transfer.items.add(f);
    if (input.current) input.current.files = transfer.files;
    setFiles(picked);
  };
  return (
    <fetcher.Form
      ref={form}
      method="post"
      encType="multipart/form-data"
      className="sticky bottom-0 rounded-lg border border-border bg-surface p-3 shadow-sm"
      id="composer"
    >
      <input type="hidden" name="intent" value="message" />
      {fetcher.data && !fetcher.data.ok ? (
        <Alert tone="danger" title="送れませんでした" className="mb-2">
          {fetcher.data.error}
        </Alert>
      ) : null}
      <Textarea
        name="body"
        rows={3}
        placeholder="URL、資料の内容、指示をどうぞ（例: https://… を読んで / 申込目標は 150 / 11/9 の投稿を先に作って）"
        disabled={disabled}
        aria-label="秘書へのメッセージ"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={disabled}
        >
          <Icons name="AttachFile" size={16} aria-hidden="true" />
          画像・テキストを添付
        </Button>
        <input
          ref={input}
          type="file"
          name="files"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv"
          className="hidden"
          onChange={pick}
        />
        {files.length ? (
          <span className="text-sm text-muted">{files.map((f) => f.name).join("、")}</span>
        ) : null}
        <Button type="submit" size="sm" className="ml-auto" loading={busy} disabled={disabled}>
          <Icons name="Send" size={16} aria-hidden="true" />
          送る
        </Button>
      </div>
    </fetcher.Form>
  );
}
