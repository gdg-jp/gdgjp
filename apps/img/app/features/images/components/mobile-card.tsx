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
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

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
    <Card className="flex flex-col gap-4">
      <div>
        <Inline>
          <Heading className="text-base">Mobile image</Heading>
        </Inline>
        <Text tone="muted" size="sm">
          {image.mobile
            ? `${image.mobile.filename ?? "Mobile variant"} · ${((image.mobile.byteSize ?? 0) / 1024).toFixed(1)} KB. Mobile devices now receive this image.`
            : "Optional. Until uploaded, every device receives the default image."}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2">
        {image.mobile ? (
          <div className="basis-full overflow-hidden rounded-md border bg-surface/30">
            <img
              src={`${image.mobile.url}&v=${image.mobile.updatedAt}`}
              alt={`Mobile preview of ${image.mobile.filename ?? image.filename ?? image.id}`}
              className="mx-auto max-h-[60vh] object-contain"
            />
          </div>
        ) : null}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} />
        <Button variant="secondary" loading={busy} onClick={() => inputRef.current?.click()}>
          <Icons name="Upload" size={16} aria-hidden="true" className="size-4" />
          {image.mobile ? "Replace mobile image" : "Upload mobile image"}
        </Button>
        {image.mobile ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                <Icons name="Trash2" size={16} aria-hidden="true" className="size-4" /> Remove
                mobile image
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Remove the mobile image?</AlertDialogTitle>
              <AlertDialogDescription>
                Mobile devices will receive the default image.
              </AlertDialogDescription>
              <Inline className="justify-end">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="danger" onClick={remove}>
                    Remove mobile image
                  </Button>
                </AlertDialogAction>
              </Inline>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {error ? (
          <p role="alert" className="basis-full text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
