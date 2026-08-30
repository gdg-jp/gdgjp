import { prefersMobileImage } from "~/lib/device";
import type { ImageRow } from "./repository";

export const DEVICE_VARY = "Sec-CH-UA-Mobile, CF-Device-Type, User-Agent";

export type SourceVariant = {
  r2Key: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  variant: "d" | "m";
  sourceVersion: number;
  deviceVary?: string;
};

export function selectSourceVariant(image: ImageRow, url: URL, headers: Headers): SourceVariant {
  const hasMobile =
    image.mobileR2Key !== null &&
    image.mobileContentType !== null &&
    image.mobileByteSize !== null &&
    image.mobileUpdatedAt !== null;
  const mobileRequested = url.searchParams.get("variant") === "mobile";
  if (
    image.mobileR2Key !== null &&
    image.mobileContentType !== null &&
    image.mobileByteSize !== null &&
    image.mobileUpdatedAt !== null &&
    (mobileRequested || prefersMobileImage(headers))
  ) {
    return {
      r2Key: image.mobileR2Key,
      contentType: image.mobileContentType,
      byteSize: image.mobileByteSize,
      width: null,
      height: null,
      variant: "m",
      sourceVersion: image.mobileUpdatedAt,
      ...(mobileRequested ? {} : { deviceVary: DEVICE_VARY }),
    };
  }
  return {
    r2Key: image.r2Key,
    contentType: image.contentType,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height,
    variant: "d",
    sourceVersion: image.updatedAt,
    ...(hasMobile && !mobileRequested ? { deviceVary: DEVICE_VARY } : {}),
  };
}
