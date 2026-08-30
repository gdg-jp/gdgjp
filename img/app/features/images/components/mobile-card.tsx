import { Smartphone, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function MobileCard({
  image,
}: {
  image: {
    id: string;
    filename: string | null;
    mobile: null | {
      filename: string | null;
      byteSize: number | null;
      updatedAt: number | null;
      url: string;
    };
  };
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/mobile/${image.id}`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      navigate(".", { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function remove() {
    if (!confirm("Remove the mobile image? Mobile devices will receive the default image.")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/mobile/${image.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      navigate(".", { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      className="motion-stagger transition-shadow duration-300 hover:shadow-md"
      style={{ "--motion-index": 2 } as React.CSSProperties}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" /> Mobile image
        </CardTitle>
        <CardDescription>
          {image.mobile
            ? `${image.mobile.filename ?? "Mobile variant"} · ${((image.mobile.byteSize ?? 0) / 1024).toFixed(1)} KB. Mobile devices now receive this image.`
            : "Optional. Until uploaded, every device receives the default image."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {image.mobile ? (
          <div className="basis-full overflow-hidden rounded-md border bg-muted/30">
            <img
              src={`${image.mobile.url}&v=${image.mobile.updatedAt}`}
              alt={`Mobile preview of ${image.mobile.filename ?? image.filename ?? image.id}`}
              className="motion-image-reveal mx-auto max-h-[60vh] object-contain"
            />
          </div>
        ) : null}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} />
        <Button disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {image.mobile ? "Replace mobile image" : "Upload mobile image"}
        </Button>
        {image.mobile ? (
          <Button variant="outline" disabled={busy} onClick={remove}>
            <Trash2 className="size-4" /> Remove mobile image
          </Button>
        ) : null}
        {error ? <p className="basis-full text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
