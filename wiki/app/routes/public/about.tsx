import { Button } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import LandingContent from "~/routes/public/_components/LandingContent";

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
    <Button asChild>
      <Link to="/">{t("lp.go_home")}</Link>
    </Button>
  );

  return <LandingContent ctaSlot={ctaSlot} />;
}
