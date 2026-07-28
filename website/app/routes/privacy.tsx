import { SiteLayout } from "~/components/site-layout";

export function meta() {
  return [
    { title: "プライバシーポリシー | GDG Japan" },
    { name: "description", content: "GDG Japan のプライバシーポリシーです。" },
    { property: "og:title", content: "プライバシーポリシー | GDG Japan" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://gdgs.jp/privacy" },
  ];
}

export default function PrivacyPage() {
  return (
    <SiteLayout>
      <article className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          プライバシーポリシー
        </h1>
        <p className="mt-2 text-sm text-slate-500">最終更新日: 2026年7月28日</p>

        <div className="mt-10 space-y-8 leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. 適用範囲</h2>
            <p className="mt-3">
              本ポリシーは、GDG Japan が提供する gdgs.jp 配下の公開 Web サービスおよび GDG Accounts
              （accounts.gdgs.jp）に適用されます。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. 取得する情報</h2>
            <p className="mt-3">
              Google アカウントでサインインする際、Google OAuth
              を通じて、氏名、メールアドレス、プロフィール写真などの基本プロフィール情報を取得することがあります。また、サービスの提供・安全な運営のため、アカウント識別子、ログイン状態、作成したコンテンツ、アップロードしたファイル、設定、アクセスログなどを取り扱います。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. 利用目的</h2>
            <p className="mt-3">
              取得した情報は、本人確認、アカウントと権限の管理、サービスの提供・改善、不正利用の防止、問い合わせ対応のために利用します。個人情報を販売することはありません。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. 第三者サービス</h2>
            <p className="mt-3">
              本サービスは、認証・連携のために Google、ホスティング・データ保管・配信のために
              Cloudflare
              を利用します。各事業者による情報の取扱いは、それぞれのプライバシーポリシーに従います。
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                <a
                  className="text-blue-700 underline hover:text-blue-900"
                  href="https://policies.google.com/privacy"
                >
                  Google プライバシーポリシー
                </a>
              </li>
              <li>
                <a
                  className="text-blue-700 underline hover:text-blue-900"
                  href="https://www.cloudflare.com/privacypolicy/"
                >
                  Cloudflare プライバシーポリシー
                </a>
              </li>
            </ul>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. 保持・削除</h2>
            <p className="mt-3">
              情報は、サービス提供に必要な期間または法令上必要な期間に限り保持します。アカウントまたは関連データの削除を希望される場合は、下記の窓口からご連絡ください。
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. お問い合わせと改定</h2>
            <p className="mt-3">
              プライバシーに関するお問い合わせは、
              <a
                className="text-blue-700 underline hover:text-blue-900"
                href="https://github.com/gdg-jp/gdgjp"
              >
                GDG Japan の GitHub リポジトリ
              </a>
              を通じてお寄せください。本ポリシーを改定する場合は、このページに変更後の内容を掲載します。
            </p>
          </section>
        </div>
      </article>
    </SiteLayout>
  );
}
