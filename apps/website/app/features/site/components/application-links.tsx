import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";

export function ApplicationLinks() {
  return (
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
  );
}
