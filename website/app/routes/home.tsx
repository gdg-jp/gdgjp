import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
import { SiteLayout } from "~/components/site-layout";

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

      <section aria-labelledby="apps-heading" className="mx-auto mt-14 max-w-3xl">
        <h2 id="apps-heading" className="text-center text-lg font-semibold text-slate-900">
          アプリケーション
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {GDG_APP_LINKS.map((app) => (
            <li key={app.url}>
              <a
                href={app.url}
                className="group flex min-h-40 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <img
                  src={app.iconUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="size-16 object-contain"
                />
                <span className="mt-3 font-medium text-slate-800 group-hover:text-blue-700">
                  {app.label}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}
