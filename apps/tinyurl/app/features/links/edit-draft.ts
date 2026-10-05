import type { LinkVisibility } from "~/features/links";
import type { LinksPageData } from "~/features/links/detail.server";

export type Draft = {
  domainId: number;
  destinationUrl: string;
  slug: string;
  title: string;
  description: string;
  ogImageUrl: string;
  visibility: LinkVisibility;
  folderId: number | null;
  tagIds: number[];
  newTagNames: string[];
  comment: string;
};

export function buildInitial(loaderData: LinksPageData): Draft {
  return {
    domainId: loaderData.link.domainId ?? 1,
    destinationUrl: loaderData.link.destinationUrl,
    slug: loaderData.link.slug,
    title: loaderData.link.title ?? "",
    description: loaderData.link.description ?? "",
    ogImageUrl: loaderData.link.ogImageUrl ?? "",
    visibility: loaderData.link.visibility,
    folderId: loaderData.link.folderId,
    tagIds: loaderData.tags.map((t) => t.id),
    newTagNames: [],
    comment: loaderData.comment,
  };
}

export function draftEqual(a: Draft, b: Draft): boolean {
  if (
    a.domainId !== b.domainId ||
    a.destinationUrl !== b.destinationUrl ||
    a.slug !== b.slug ||
    a.title !== b.title ||
    a.description !== b.description ||
    a.ogImageUrl !== b.ogImageUrl ||
    a.visibility !== b.visibility ||
    a.folderId !== b.folderId ||
    a.comment !== b.comment ||
    a.tagIds.length !== b.tagIds.length ||
    a.newTagNames.length !== b.newTagNames.length
  ) {
    return false;
  }
  const aTagSet = new Set(a.tagIds);
  for (const id of b.tagIds) if (!aTagSet.has(id)) return false;
  for (let i = 0; i < a.newTagNames.length; i++) {
    if (a.newTagNames[i] !== b.newTagNames[i]) return false;
  }
  return true;
}
