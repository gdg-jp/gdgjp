import { Check, Copy, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

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
    if (!confirm("Delete this image? This cannot be undone.")) return;
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
    <Card
      className="motion-stagger transition-shadow duration-300 hover:shadow-md"
      style={{ "--motion-index": 0 } as React.CSSProperties}
    >
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{image.filename ?? image.id}</CardTitle>
          <CardDescription>
            {image.contentType} · {(image.byteSize / 1024).toFixed(1)} KB
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={copy}
            className={copied ? "border-gdg-green/60 text-gdg-green" : undefined}
            aria-live="polite"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied!" : "Copy URL"}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={remove}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-md border bg-muted/30">
          <img
            key={refreshKey}
            src={`${image.url}&v=${image.updatedAt}-${refreshKey}`}
            alt={image.filename ?? image.id}
            className="motion-image-reveal mx-auto max-h-[60vh] object-contain"
          />
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={replace} />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" />
            Replace
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
