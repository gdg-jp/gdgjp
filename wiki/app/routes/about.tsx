import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import LandingContent from "~/components/LandingContent";
import { requireRole } from "~/lib/auth-utils.server";

export const meta: MetaFunction = ({ matches }) => {
  const origin = (matches.find((m) => m.id === "root")?.data as { origin?: string })?.origin ?? "";
  const parentMeta = matches.flatMap((m) => m.meta ?? []);
  return [
    ...parentMeta,
    { title: "About — GDGoC Japan Wiki" },
    {
      name: "description",
      content:
        "Learn about GDGoC Japan Wiki — an AI-powered bilingual knowledge sharing platform built for GDGoC Japan chapters.",
    },
    { property: "og:title", content: "About — GDGoC Japan Wiki" },
    {
      property: "og:description",
      content:
        "Learn about GDGoC Japan Wiki — an AI-powered bilingual knowledge sharing platform built for GDGoC Japan chapters.",
    },
    { property: "og:url", content: `${origin}/about` },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireRole(request, context.cloudflare.env, "viewer");
  return {};
}

export default function AboutPage() {
  const { t } = useTranslation();

  const ctaSlot = (
    <Link
      to="/"
      className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-gray-900 px-6 py-3 text-base font-semibold text-white shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]"
    >
      {t("lp.go_home")}
    </Link>
  );

  return <LandingContent ctaSlot={ctaSlot} />;
}
