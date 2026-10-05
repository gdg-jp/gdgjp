import { ApplicationLinks } from "~/features/site/components/application-links";
import { SiteLayout } from "~/layouts/site-layout";

export function meta() {
  return [
    { title: "GDG Japan" },
    {
      name: "description",
      content: "GDG Japan のコミュニティ運営を支えるサービスです。",
    },
    { property: "og:title", content: "GDG Japan" },
    { property: "og:description", content: "GDG Japan のコミュニティ運営を支えるサービスです。" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://gdgs.jp/" },
  ];
}

export default function HomePage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-3xl text-center">
        <p className="mb-3 text-sm font-medium tracking-wide text-blue-700">GDG Japan</p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          コミュニティの活動を、もっと身近に。
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg">
          GDG Japan は、Google
          技術を学び、共有し、つながるコミュニティのためのサービスを提供しています。
        </p>
      </section>

      <ApplicationLinks />
    </SiteLayout>
  );
}
