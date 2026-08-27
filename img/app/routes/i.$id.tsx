import { Check, Copy, Link2, Smartphone, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PageShell } from "~/components/page-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isValidImageId } from "~/features/images/id";
import { getImageForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { deliveryUrl } from "~/lib/img-url";
import type { Route } from "./+types/i.$id";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Image ${params.id} — GDG Japan Image` }];
}

export async function loader(args: Route.LoaderArgs) {
  const id = args.params.id;
  if (!isValidImageId(id)) throw new Response("Not found", { status: 404 });
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  const result = await getImageForActor(env, { user, chapters: [chapter] }, id);
  if (!result.ok) {
    throw new Response(result.error === "not_found" ? "Not found" : "Forbidden", {
      status: result.error === "not_found" ? 404 : 403,
    });
  }
  const image = result.value;
  const appUrl = env.APP_URL.replace(/\/$/, "");
  return {
    user: { email: user.email, image: user.image, name: user.name },
    image: {
      id: image.id,
      slug: image.slug,
      url: deliveryUrl(image.id, { w: 1600 }),
      filename: image.filename,
      contentType: image.contentType,
      byteSize: image.byteSize,
      updatedAt: image.updatedAt,
      mobile: image.mobileR2Key
        ? {
            filename: image.mobileFilename,
            contentType: image.mobileContentType,
            byteSize: image.mobileByteSize,
            updatedAt: image.mobileUpdatedAt,
            url: deliveryUrl(image.id, { w: 1600, variant: "mobile" }),
          }
        : null,
    },
    publicUrl: image.slug ? `${appUrl}/${image.slug}` : `${appUrl}/${image.id}`,
    idUrl: `${appUrl}/${image.id}`,
  };
}

export default function ImageDetail({ loaderData }: Route.ComponentProps) {
  const { user, image, publicUrl, idUrl } = loaderData;
  const navigate = useNavigate();
  const replaceRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [slug, setSlug] = useState(image.slug ?? "");
  const [slugBusy, setSlugBusy] = useState(false);
  const [slugErr, setSlugErr] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("Could not copy the URL. Please copy it from the field.");
    }
  }

  async function onReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/replace/${image.id}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (replaceRef.current) replaceRef.current.value = "";
    }
  }

  async function onDelete() {
    if (!confirm("Delete this image? This cannot be undone.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/delete/${image.id}`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      navigate("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function onMobileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/mobile/${image.id}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      navigate(".", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (mobileRef.current) mobileRef.current.value = "";
    }
  }

  async function onMobileDelete() {
    if (!confirm("Remove the mobile image? Mobile devices will receive the default image.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/mobile/${image.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      navigate(".", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitSlug(value: string) {
    setSlugBusy(true);
    setSlugErr(null);
    try {
      const form = new FormData();
      form.append("slug", value);
      const res = await fetch(`/api/slug/${image.id}`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text()) || "Could not update the custom URL.");
      setSlug(value);
      navigate(".", { replace: true });
    } catch (e) {
      setSlugErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSlugBusy(false);
    }
  }

  async function onSaveSlug(e: React.FormEvent) {
    e.preventDefault();
    await submitSlug(slug.trim());
  }

  async function onClearSlug() {
    if (!confirm("Remove the custom URL? The image stays reachable at its id URL.")) return;
    await submitSlug("");
  }

  return (
    <PageShell user={user} size="md">
      <div className="flex flex-col gap-6">
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
                onClick={onCopy}
                className={copied ? "border-gdg-green/60 text-gdg-green" : undefined}
                aria-live="polite"
              >
                <span
                  key={copied ? "copied" : "copy"}
                  className="motion-enter-scale inline-flex items-center gap-2"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied!" : "Copy URL"}
                </span>
              </Button>
              <Button variant="destructive" disabled={busy} onClick={onDelete}>
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
            <input
              ref={replaceRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onReplace}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={() => replaceRef.current?.click()}>
                <Upload className="size-4" />
                Replace
              </Button>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </div>
          </CardContent>
        </Card>

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
            <input
              ref={mobileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onMobileUpload}
            />
            <Button disabled={busy} onClick={() => mobileRef.current?.click()}>
              <Upload className="size-4" />
              {image.mobile ? "Replace mobile image" : "Upload mobile image"}
            </Button>
            {image.mobile ? (
              <Button variant="outline" disabled={busy} onClick={onMobileDelete}>
                <Trash2 className="size-4" /> Remove mobile image
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card
          className="motion-stagger transition-shadow duration-300 hover:shadow-md"
          style={{ "--motion-index": 1 } as React.CSSProperties}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="size-4" /> Custom URL
            </CardTitle>
            <CardDescription>
              Optional. Give this image a memorable link. Letters, numbers, hyphens and underscores,
              up to 64 characters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSaveSlug} className="flex flex-col gap-2">
              <Label htmlFor="slug" className="sr-only">
                Custom slug
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">img.gdgs.jp/</span>
                <Input
                  id="slug"
                  name="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-image"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-48"
                />
                <Button type="submit" disabled={slugBusy || slug.trim() === (image.slug ?? "")}>
                  Save
                </Button>
                {image.slug ? (
                  <Button type="button" variant="outline" disabled={slugBusy} onClick={onClearSlug}>
                    <Trash2 className="size-4" /> Clear
                  </Button>
                ) : null}
              </div>
              {slugErr ? <p className="text-sm text-destructive">{slugErr}</p> : null}
            </form>
          </CardContent>
        </Card>

        <Card
          className="motion-stagger transition-shadow duration-300 hover:shadow-md"
          style={{ "--motion-index": 3 } as React.CSSProperties}
        >
          <CardHeader>
            <CardTitle className="text-base">Public URL</CardTitle>
            <CardDescription>
              {image.slug
                ? "Anyone with this link can view the image. It also stays reachable at its id URL."
                : "Anyone with this link can view the image."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="public-url" className="sr-only">
                Public URL
              </Label>
              <Input id="public-url" readOnly value={publicUrl} />
            </div>
            {image.slug ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="id-url" className="sr-only">
                  Id URL
                </Label>
                <Input id="id-url" readOnly value={idUrl} className="text-muted-foreground" />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
