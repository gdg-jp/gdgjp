import {
  Button,
  Card,
  FormField,
  Heading,
  Icons,
  Inline,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from "@gdgjp/design-system";
import { useEffect, useMemo, useRef, useState } from "react";
import { WIDTH_LADDER, resolveDelivery } from "~/features/images/img-transform";
import { type TransformOpts, deliveryUrl } from "~/features/images/img-url";

type BuilderImage = {
  id: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  updatedAt: number;
  mobile: null | { contentType: string | null; byteSize: number | null; updatedAt: number | null };
};

export function UrlBuilderCard({ image, appUrl }: { image: BuilderImage; appUrl: string }) {
  const [width, setWidth] = useState("auto");
  const [height, setHeight] = useState("");
  const [radius, setRadius] = useState("");
  const [fit, setFit] = useState<NonNullable<TransformOpts["fit"]>>("scale-down");
  const [quality, setQuality] = useState("auto");
  const [format, setFormat] = useState<NonNullable<TransformOpts["f"]>>("auto");
  const [dpr, setDpr] = useState("1");
  const [variant, setVariant] = useState("default");
  const [afterBytes, setAfterBytes] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const opts = useMemo<TransformOpts>(() => {
    if (format === "original") return { f: "original" };
    return {
      ...(width === "auto" ? {} : { w: Number(width) }),
      ...(height ? { h: Number(height) } : {}),
      fit,
      ...(radius ? { radius: Number(radius) } : {}),
      ...(quality === "auto" ? {} : { q: Number(quality) }),
      f: format,
      ...(dpr === "1" ? {} : { dpr: Number(dpr) }),
      ...(variant === "mobile" ? { variant: "mobile" as const } : {}),
    };
  }, [dpr, fit, format, height, quality, radius, variant, width]);
  const builtUrl = `${appUrl}${deliveryUrl(image.id, opts)}`;
  const selectedSource =
    variant === "mobile" && image.mobile
      ? {
          contentType: image.mobile.contentType ?? image.contentType,
          byteSize: image.mobile.byteSize ?? image.byteSize,
          width: null,
          height: null,
        }
      : {
          contentType: image.contentType,
          byteSize: image.byteSize,
          width: image.width,
          height: image.height,
        };
  const resolved = resolveDelivery({
    params: opts,
    accept: "image/avif,image/webp,*/*",
    autoMaxWidth: 0,
    source: selectedSource,
  });
  const nonCanonical = resolved.kind === "derive" && !resolved.canonical;

  useEffect(() => {
    const controller = new AbortController();
    setAfterBytes(null);
    setNatural(null);
    fetch(builtUrl, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => setAfterBytes(blob.size))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAfterBytes(null);
      });
    return () => controller.abort();
  }, [builtUrl]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(builtUrl);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  const previewUrl = `${builtUrl}${builtUrl.includes("?") ? "&" : "?"}v=${image.updatedAt}`;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <Inline>
          <Icons name="Sparkles" size={16} aria-hidden="true" className="size-4" />
          <Heading className="text-base">Optimization URL builder</Heading>
        </Inline>
        <Text tone="muted" size="sm">
          Build a responsive, negotiated image URL and preview the delivered result.
        </Text>
      </div>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Control label="Width">
            <Select value={width} onValueChange={setWidth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                {WIDTH_LADDER.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Control label="Height">
            <Input
              value={height}
              onChange={(event) => setHeight(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="Auto"
            />
          </Control>
          <Control label="Fit">
            <Select value={fit} onValueChange={(value) => setFit(value as typeof fit)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["scale-down", "contain", "cover", "crop", "pad"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Control label="Corner radius">
            <Input
              value={radius}
              onChange={(event) => setRadius(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="None"
            />
          </Control>
          <Control label="Quality">
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (82)</SelectItem>
                {[60, 70, 82, 90, 100].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Control label="Format">
            <Select value={format} onValueChange={(value) => setFormat(value as typeof format)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["auto", "avif", "webp", "jpeg", "png", "original"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Control label="DPR">
            <Select value={dpr} onValueChange={setDpr}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          {image.mobile ? (
            <Control label="Variant">
              <Select value={variant} onValueChange={setVariant}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                </SelectContent>
              </Select>
            </Control>
          ) : null}
        </div>
        {nonCanonical ? (
          <p className="text-xs text-muted">
            This combination is delivered normally, but is not stored as a preset rendition.
          </p>
        ) : null}
        <div className="overflow-hidden rounded-md border bg-surface/30">
          <img
            src={previewUrl}
            alt="Optimization preview"
            className="mx-auto max-h-[48vh] object-contain"
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>
            Before: {(selectedSource.byteSize / 1024).toFixed(1)} KB
            {selectedSource.width && selectedSource.height
              ? ` · ${selectedSource.width}×${selectedSource.height}`
              : ""}
          </span>
          <span>
            After: {afterBytes === null ? "…" : `${(afterBytes / 1024).toFixed(1)} KB`}
            {natural ? ` · ${natural.width}×${natural.height}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input readOnly value={builtUrl} aria-label="Built image URL" />
          <Button variant="outline" onClick={copy}>
            {copied ? (
              <Icons name="Check" size={16} aria-hidden="true" className="size-4" />
            ) : (
              <Icons name="Copy" size={16} aria-hidden="true" className="size-4" />
            )}
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <FormField label={label}>{children}</FormField>;
}
