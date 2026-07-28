import { SiteLayout } from "~/components/site-layout";

export function meta() {
  return [
    { title: "利用規約 | GDG Japan" },
    { name: "description", content: "GDG Japan の利用規約です。" },
    { property: "og:title", content: "利用規約 | GDG Japan" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://gdgs.jp/terms" },
  ];
}

export default function TermsPage() {
  return (
    <SiteLayout>
      <article className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">利用規約</h1>
        <p className="mt-2 text-sm text-slate-500">最終更新日: 2026年7月28日</p>

        <div className="mt-10 space-y-8 leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. 適用</h2>
            <p className="mt-3">
              本規約は、GDG Japan が提供する gdgs.jp 配下の公開 Web サービスおよび GDG Accounts
              の利用条件を定めるものです。サービスを利用することで、本規約に同意したものとします。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. アカウント</h2>
            <p className="mt-3">
              利用者は、アカウント情報を正確に保ち、認証情報を適切に管理する責任を負います。アカウントの不正利用、または本規約に違反する利用が認められる場合、GDG
              Japan は利用を制限または停止することがあります。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. コンテンツと利用制限</h2>
            <p className="mt-3">
              利用者は、自らが投稿・アップロードするコンテンツについて必要な権利を有するものとし、サービス提供に必要な範囲で
              GDG Japan
              に保存・表示・配信を許諾します。法令違反、他者の権利・プライバシーの侵害、嫌がらせ、不正アクセス、セキュリティ対策の回避、またはサービス運営を妨げる行為を禁止します。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. 免責</h2>
            <p className="mt-3">
              本サービスは現状有姿で提供されます。GDG Japan
              は、法令上認められる最大限の範囲で、サービスの継続性、完全性、正確性、特定目的への適合性を保証しません。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. 規約の変更</h2>
            <p className="mt-3">
              GDG Japan
              は必要に応じて本規約を変更できます。変更後の規約はこのページへの掲載時から効力を生じ、変更後もサービスを利用した場合は改定後の規約に同意したものとします。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. お問い合わせ</h2>
            <p className="mt-3">
              本規約に関するお問い合わせは、
              <a
                className="text-blue-700 underline hover:text-blue-900"
                href="https://github.com/gdg-jp/gdgjp"
              >
                GDG Japan の GitHub リポジトリ
              </a>
              を通じてお寄せください。
            </p>
          </section>
        </div>
      </article>
    </SiteLayout>
  );
}
