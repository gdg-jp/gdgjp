import { Tag, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import {
  X_COUNTER_NUMBER_THRESHOLD,
  X_POST_CHARACTER_LIMIT,
  getXPostLinkRanges,
  type parseXPostText,
  xCounterDisplayRemaining,
} from "../x-text";

export function XPostComposer({
  text,
  textAreaRef,
  onTextChange,
}: {
  text: string;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextChange: (text: string) => void;
}) {
  const ranges = getXPostLinkRanges(text);
  let cursor = 0;

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none whitespace-pre-wrap break-words text-base leading-6"
      >
        {ranges.map(({ start, end }) => {
          const plainText = text.slice(cursor, start);
          cursor = end;
          return (
            <span key={`${start}-${end}`}>
              {plainText}
              <span className="text-primary">{text.slice(start, end)}</span>
            </span>
          );
        })}
        {text.slice(cursor)}
        {text.endsWith("\n") ? "\u200b" : null}
      </div>
      <textarea
        id="post-text"
        ref={textAreaRef}
        name="text"
        value={text}
        required
        rows={2}
        placeholder="いまどうしてる？"
        className="relative w-full resize-none border-0 bg-transparent text-base leading-6 text-transparent outline-none caret-foreground placeholder:text-muted-foreground/80 selection:bg-primary/30"
        onChange={(event) => {
          onTextChange(event.currentTarget.value);
          event.currentTarget.style.height = "auto";
          event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
        }}
      />
    </div>
  );
}

export function XCharacterCounter({
  text,
  result,
}: {
  text: string;
  result: ReturnType<typeof parseXPostText>;
}) {
  const remaining = X_POST_CHARACTER_LIMIT - result.weightedLength;
  const displayRemaining = xCounterDisplayRemaining(text, result.weightedLength);
  const progress = Math.min(result.weightedLength / X_POST_CHARACTER_LIMIT, 1);
  const circumference = 2 * Math.PI * 15.5;
  const showNumber =
    (displayRemaining > 0 && displayRemaining <= X_COUNTER_NUMBER_THRESHOLD) ||
    displayRemaining < 0;
  const color = remaining < 0 ? "text-destructive" : "text-primary";

  return (
    <output
      className={`relative flex size-9 shrink-0 items-center justify-center ${color}`}
      aria-label={`Xの残り文字数: ${displayRemaining}`}
    >
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth="3"
          className="transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
        />
      </svg>
      {showNumber ? (
        <span className="absolute text-xs leading-none tabular-nums">{displayRemaining}</span>
      ) : null}
    </output>
  );
}

export function MediaGrid({
  existingMedia,
  newImages,
  onRemoveExisting,
  onRemoveNew,
}: {
  existingMedia: { id: string; altText: string }[];
  newImages: { file: File; url: string }[];
  onRemoveExisting: (id: string) => void;
  onRemoveNew: (url: string) => void;
}) {
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const images = [
    ...existingMedia.map((image) => ({
      id: image.id,
      src: `/api/media/${image.id}`,
      alt: image.altText,
      inputName: `alt-${image.id}`,
      isNew: false,
      remove: () => onRemoveExisting(image.id),
    })),
    ...newImages.map((image, index) => ({
      src: image.url,
      alt: "",
      inputName: `new-alt-${index}`,
      isNew: true,
      remove: () => onRemoveNew(image.url),
    })),
  ];
  if (images.length === 0) return null;
  return (
    <div
      className={`grid overflow-hidden rounded-2xl bg-muted ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {images.map((image, index) => (
        <div
          key={image.src}
          className={`relative min-w-0 ${image.isNew ? "animate-in fade-in-0 zoom-in-95 animation-duration-150 ease-out motion-reduce:animation-duration-100" : ""} ${images.length === 3 && index === 0 ? "row-span-2" : ""}`}
          style={
            images.length === 1 ? { aspectRatio: imageAspectRatios[image.src] ?? 3 / 4 } : undefined
          }
        >
          <img
            src={image.src}
            alt={image.alt}
            className={`h-full w-full object-cover ${images.length === 1 ? "" : "aspect-square"}`}
            onLoad={(event) => {
              if (images.length !== 1) return;
              const { naturalHeight, naturalWidth } = event.currentTarget;
              if (!naturalWidth || !naturalHeight) return;
              setImageAspectRatios((ratios) => ({
                ...ratios,
                [image.src]: Math.max(naturalWidth / naturalHeight, 3 / 4),
              }));
            }}
          />
          <button
            type="button"
            onClick={image.remove}
            className="absolute top-2 right-2 rounded-full bg-black/55 p-1 text-white/75 shadow-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-primary/70"
            aria-label="画像を削除"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <AltTextDialog inputName={image.inputName} defaultValue={image.alt} />
        </div>
      ))}
    </div>
  );
}

export function AltTextDialog({
  inputName,
  defaultValue,
}: { inputName: string; defaultValue: string }) {
  const [altText, setAltText] = useState(defaultValue);
  return (
    <DialogPrimitive.Root>
      <input type="hidden" name={inputName} value={altText} />
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="absolute right-2 bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white/75 shadow-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-primary/70"
          aria-label="画像の説明（Alt）を編集"
        >
          Alt
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-xl outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="font-semibold">画像の説明</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                画像を見られない人にも内容が伝わるように説明します。
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="rounded-full p-1 hover:bg-muted" aria-label="閉じる">
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <label className="mt-4 block">
            <span className="sr-only">画像の説明</span>
            <textarea
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              rows={3}
              placeholder="画像の説明を入力"
              className="w-full resize-none rounded-xl border bg-background p-3 text-sm"
            />
          </label>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function TagUsersDialog() {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <Tag className="size-3" aria-hidden="true" />
          タグ付けするユーザー
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-xl outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="font-semibold">
                タグ付けするユーザー
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                ユーザー名を空白またはカンマで区切って入力します。
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="rounded-full p-1 hover:bg-muted" aria-label="閉じる">
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <input
            form="schedule-form"
            name="tagHandles"
            placeholder="@gdg_tokyo @gdg_osaka"
            className="mt-4 w-full rounded-xl border bg-background p-3"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function XAccountAvatar({
  account,
}: {
  account: { displayName: string; profileImageUrl: string | null; username: string };
}) {
  return (
    <span className="flex size-10 shrink-0 overflow-hidden rounded-full bg-foreground text-background">
      {account.profileImageUrl ? (
        <img
          src={account.profileImageUrl}
          alt={`${account.displayName} のXアカウントアイコン`}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-lg" aria-hidden="true">
          𝕏
        </span>
      )}
    </span>
  );
}
