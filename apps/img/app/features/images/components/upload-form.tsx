import { Button, Icons } from "@gdgjp/design-system";
import { cn } from "@gdgjp/design-system";
import { type ChangeEvent, type DragEvent, useRef, useState, useTransition } from "react";
import { useNavigate } from "react-router";

export function UploadForm({ folderId }: { folderId?: number | null } = {}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pending = busy || isNavigating;

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (folderId != null) form.append("folderId", String(folderId));
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `upload failed: ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      startNavigation(() => navigate(`/i/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!pending) setIsDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (pending) return;

    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <input
        ref={inputRef}
        id="image-upload"
        aria-label="Choose image"
        type="file"
        accept="image/*"
        className="hidden"
        disabled={pending}
        onChange={onChange}
      />
      <div
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "group flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border-2",
          "border-dashed px-6 py-8 text-center transition-[border-color,background-color,transform]",
          "duration-200 ease-out",
          isDragging
            ? "scale-[1.01] border-primary bg-primary/10"
            : "border-border bg-surface/20 hover:border-primary/60 hover:bg-surface/40",
          pending && "pointer-events-none opacity-75",
        )}
      >
        <div
          className={cn(
            "grid size-11 place-items-center rounded-full bg-primary/10 text-primary transition-transform",
            isDragging && "scale-110",
          )}
        >
          {pending ? (
            <Icons
              name="LoaderCircle"
              size={16}
              aria-hidden="true"
              className="size-5 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Icons name="Upload" size={16} aria-hidden="true" className="size-5" />
          )}
        </div>
        <div className="space-y-1">
          <p className="font-medium">
            {busy
              ? "Uploading your image…"
              : isNavigating
                ? "Opening image…"
                : "Drop an image here"}
          </p>
          <p className="text-sm text-muted">
            {pending
              ? "You can keep this page open while we finish."
              : "or choose one from your device"}
          </p>
        </div>
        <Button
          size="lg"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="min-w-40"
        >
          {pending ? (
            <Icons
              name="LoaderCircle"
              size={16}
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Icons name="Upload" size={16} aria-hidden="true" className="size-4" />
          )}
          {pending ? "Please wait…" : "Choose image"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
