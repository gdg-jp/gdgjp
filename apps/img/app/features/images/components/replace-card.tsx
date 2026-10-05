import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  Text,
} from "@gdgjp/design-system";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

export function ReplaceCard({
  image,
  publicUrl,
}: {
  image: {
    id: string;
    filename: string | null;
    contentType: string;
    byteSize: number;
    updatedAt: number;
    url: string;
  };
  publicUrl: string;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the URL. Please copy it from the field.");
    }
  }

  async function replace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/replace/${image.id}`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/delete/${image.id}`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      navigate("/");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading className="truncate text-base">{image.filename ?? image.id}</Heading>
          <Text tone="muted" size="sm">
            {image.contentType} · {(image.byteSize / 1024).toFixed(1)} KB
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={copy} aria-live="polite">
            {copied ? (
              <Icons name="Check" size={16} aria-hidden="true" className="size-4" />
            ) : (
              <Icons name="Copy" size={16} aria-hidden="true" className="size-4" />
            )}
            {copied ? "Copied!" : "Copy URL"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="danger" disabled={busy}>
                <Icons name="Trash2" size={16} aria-hidden="true" className="size-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete this image?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              <Inline className="justify-end">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="danger" onClick={remove}>
                    Delete
                  </Button>
                </AlertDialogAction>
              </Inline>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-md border bg-surface/30">
          <img
            key={refreshKey}
            src={`${image.url}&v=${image.updatedAt}-${refreshKey}`}
            alt={image.filename ?? image.id}
            className="mx-auto max-h-[60vh] object-contain"
          />
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={replace} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" loading={busy} onClick={() => inputRef.current?.click()}>
            <Icons name="Upload" size={16} aria-hidden="true" className="size-4" />
            Replace
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
