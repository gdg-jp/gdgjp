export type PageMetaInput = {
  description?: string | null;
  imagePath?: string;
  origin: string;
  pathname: string;
  title: string;
  visibility: string;
};

const SITE_NAME = "GDG Japan Wiki";

function normalizeDescription(description: string | null | undefined, title: string) {
  const normalized = description?.replace(/\s+/g, " ").trim();
  return normalized || `「${title}」— ${SITE_NAME}`;
}

export function buildPageMeta({
  description,
  imagePath = "/og-image.png",
  origin,
  pathname,
  title,
  visibility,
}: PageMetaInput) {
  const documentTitle = `${title} — ${SITE_NAME}`;
  const robots = visibility === "public" ? [] : [{ name: "robots", content: "noindex,nofollow" }];

  if (visibility !== "public" && visibility !== "unlisted") {
    return [{ title: documentTitle }, ...robots];
  }

  const pageUrl = new URL(pathname, origin).toString();
  const imageUrl = new URL(imagePath, origin).toString();
  const metaDescription = normalizeDescription(description, title);

  return [
    { title: documentTitle },
    { name: "description", content: metaDescription },
    { tagName: "link", rel: "canonical", href: pageUrl },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: metaDescription },
    { property: "og:url", content: pageUrl },
    { property: "og:image", content: imageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: title },
    { property: "og:type", content: "article" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: metaDescription },
    { name: "twitter:image", content: imageUrl },
    { name: "twitter:image:alt", content: title },
    ...robots,
  ];
}
