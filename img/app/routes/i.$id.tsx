import { Check, Copy, Smartphone, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PageShell } from "~/components/page-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { isValidImageId } from "~/lib/id";
import { getImage } from "~/lib/images";
import { deliveryUrl } from "~/lib/img-url";
import { canMutateImage } from "~/lib/permissions";
import type { Route } from "./+types/i.$id";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Image ${params.id} — GDG Japan Image` }];
}

export async function loader(args: Route.LoaderArgs) {
  const id = args.params.id;
  if (!isValidImageId(id)) throw new Response("Not found", { status: 404 });
  const env = args.context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, args.request);
  const image = await getImage(env.DB, id);
  if (!image) throw new Response("Not found", { status: 404 });
  if (!canMutateImage(user, image)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return {
    user: { email: user.email, name: user.name },
    image: {
      id: image.id,
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
    publicUrl: `${env.APP_URL}/${image.id}`,
  };
}

export default function ImageDetail({ loaderData }: Route.ComponentProps) {
  const { user, image, publicUrl } = loaderData;
  const navigate = useNavigate();
  const replaceRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>(null);

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

  return (
    <PageShell user={user} size="md">
      <div className="flex flex-col gap-6">
        <Card
          className="motion-stagger transition-shadow duration-300 hover:shadow-md"
          style={{ "--motion-index": 0 } as React.CSSProperties}
        >
          <CardHeader>
            <CardTitle className="text-base">{image.filename ?? image.id}</CardTitle>
            <CardDescription>
              {image.contentType} · {(image.byteSize / 1024).toFixed(1)} KB
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border bg-muted/30">
              <img
                key={refreshKey}
                src={`${image.url}&v=${image.updatedAt}-${refreshKey}`}
                alt={image.filename ?? image.id}
                className="motion-image-reveal mx-auto max-h-[60vh] object-contain"
              />
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
            <CardTitle className="text-base">Public URL</CardTitle>
            <CardDescription>Anyone with this link can view the image.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="public-url" className="sr-only">
                Public URL
              </Label>
              <Input id="public-url" readOnly value={publicUrl} />
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
                  {copied ? "Copied!" : "Copy"}
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card
          className="motion-stagger transition-shadow duration-300 hover:shadow-md"
          style={{ "--motion-index": 3 } as React.CSSProperties}
        >
          <CardHeader>
            <CardTitle className="text-base">Manage</CardTitle>
            <CardDescription>
              Replace the image bytes (URL stays the same) or delete.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <input
              ref={replaceRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onReplace}
            />
            <Button disabled={busy} onClick={() => replaceRef.current?.click()}>
              <Upload className="size-4" />
              Replace
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            {err ? <p className="basis-full text-sm text-destructive">{err}</p> : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
