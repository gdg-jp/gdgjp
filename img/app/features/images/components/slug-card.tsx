import { Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

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
    <Card
      className="motion-stagger transition-shadow duration-300 hover:shadow-md"
      style={{ "--motion-index": 1 } as React.CSSProperties}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> Custom URL
        </CardTitle>
        <CardDescription>
          Optional. Give this image a memorable link. Letters, numbers, hyphens and underscores, up
          to 64 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            <span className="text-sm text-muted-foreground">img.gdgs.jp/</span>
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
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirm("Remove the custom URL? The image stays reachable at its id URL."))
                    void submit("");
                }}
              >
                <Trash2 className="size-4" /> Clear
              </Button>
            ) : null}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
