import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import LandingContent from "~/components/LandingContent";
import { requireUser } from "~/lib/auth-utils.server";

export const meta: MetaFunction = ({ matches }) => {
  const origin = (matches.find((m) => m.id === "root")?.data as { origin?: string })?.origin ?? "";
  const parentMeta = matches.flatMap((m) => m.meta ?? []);
  return [
    ...parentMeta,
    { title: "About — GDG Japan Wiki" },
    {
      name: "description",
      content:
        "Learn about GDG Japan Wiki — an AI-powered bilingual knowledge sharing platform built for GDG Japan chapters.",
    },
    { property: "og:title", content: "About — GDG Japan Wiki" },
    {
      property: "og:description",
      content:
        "Learn about GDG Japan Wiki — an AI-powered bilingual knowledge sharing platform built for GDG Japan chapters.",
    },
    { property: "og:url", content: `${origin}/about` },
    { property: "og:image", content: `${origin}/og-image.png` },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(request, context.cloudflare.env);
  return {};
}

export default function AboutPage() {
  const { t } = useTranslation();

  const ctaSlot = (
    <Link
      to="/"
      className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-gray-900 px-6 py-3 text-base font-semibold text-white shadow-[4px_4px_0px_0px_#000] transition-[transform,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:translate-x-[2px] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]"
    >
      {t("lp.go_home")}
    </Link>
  );

  return <LandingContent ctaSlot={ctaSlot} />;
}
