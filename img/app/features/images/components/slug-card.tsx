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
  Input,
  Label,
  Text,
} from "@gdgjp/design-system";
import { useState } from "react";
import { useNavigate } from "react-router";

export function SlugCard({ image }: { image: { id: string; slug: string | null } }) {
  const navigate = useNavigate();
  const [slug, setSlug] = useState(image.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(value: string) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("slug", value);
      const response = await fetch(`/api/slug/${image.id}`, { method: "POST", body: form });
      if (!response.ok)
        throw new Error((await response.text()) || "Could not update the custom URL.");
      setSlug(value);
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
          <Icons name="Link2" size={16} aria-hidden="true" className="size-4" />
          <Heading className="text-base">Custom URL</Heading>
        </Inline>
        <Text tone="muted" size="sm">
          Optional. Give this image a memorable link. Letters, numbers, hyphens and underscores, up
          to 64 characters.
        </Text>
      </div>
      <div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(slug.trim());
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="slug" className="sr-only">
            Custom slug
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">img.gdgs.jp/</span>
            <Input
              id="slug"
              name="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="my-image"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-48"
            />
            <Button type="submit" disabled={busy || slug.trim() === (image.slug ?? "")}>
              Save
            </Button>
            {image.slug ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    <Icons name="Trash2" size={16} aria-hidden="true" />
                    Clear
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>Remove the custom URL?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The image stays reachable at its id URL.
                  </AlertDialogDescription>
                  <Inline className="justify-end">
                    <AlertDialogCancel asChild>
                      <Button variant="outline">Cancel</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button variant="danger" onClick={() => void submit("")}>
                        Remove custom URL
                      </Button>
                    </AlertDialogAction>
                  </Inline>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </Card>
  );
}
