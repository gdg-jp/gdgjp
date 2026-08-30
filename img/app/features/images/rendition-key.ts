import { type ResolvedDelivery, SCHEMA_VERSION, renditionParamSlug } from "~/lib/img-transform";
import type { SourceVariant } from "./variant";

type KeySource = Pick<SourceVariant, "variant" | "sourceVersion">;

export function renditionKey(id: string, source: KeySource, delivery: ResolvedDelivery): string {
  if (delivery.kind !== "derive") throw new Error("passthrough delivery has no rendition key");
  const slug = renditionParamSlug(delivery.transform);
  return `${id}/${source.variant}/${source.sourceVersion}/${SCHEMA_VERSION}_${slug}.${delivery.transform.format}`;
}

export function renditionCacheUrl(origin: string, key: string): string {
  return `${origin.replace(/\/$/, "")}/_cache/${key}`;
}

export function deliveryEtag(id: string, source: KeySource, delivery: ResolvedDelivery): string {
  const tag =
    delivery.kind === "derive"
      ? `${renditionParamSlug(delivery.transform)}.${delivery.transform.format}`
      : "orig";
  return `"${id}-${source.variant}-${source.sourceVersion}-${tag}"`;
}

export function renditionPrefixForImage(id: string): string {
  return `${id}/`;
}

export function renditionPrefixForSource(id: string, source: KeySource): string {
  return `${id}/${source.variant}/${source.sourceVersion}/`;
}
