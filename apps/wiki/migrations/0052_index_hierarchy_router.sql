-- Fresh-install / legacy flat-index rows: replace ns-index body with the type router.
-- Guarded so already-migrated clones (content no longer starts with ## Events) are skipped.
-- Existing production catalogs move via git push of pages/**, not this migration.

UPDATE pages
SET
  content_ja =
    'このページは索引の入口。目的の型を1つ選び、その名前空間ページを読んでから個別ページへ進む。' || char(10) || char(10) ||
    '## 使い方' || char(10) || char(10) ||
    '1. 下表から該当する名前空間ページを1つ読む。各名前空間ページにその型の全ページ一覧と要約がある。' || char(10) ||
    '2. 型が特定できないときは wiki_search を path で絞って使う。' || char(10) ||
    '3. イベント固有の事実(誰が登壇したか、いくらかかったか、何が起きたか)は、まず該当する events ページを読む。会場・業者・人物の型別ページには、そのエンティティ自体の恒常的な性質だけがある。' || char(10) || char(10) ||
    '## 名前空間' || char(10) || char(10) ||
    '- [イベント](events) — 個々の開催記録。日付・会場・参加者数・予算・集客チャネル別実績・当日タイムライン・意思決定と振り返り。slug は `YYYY-MM-DD-<name>`。' || char(10) ||
    '- [会場](venues) — 収容人数、費用、設備、アクセス、利用実績と現地で起きた問題。' || char(10) ||
    '- [業者](vendors) — ケータリング・印刷・ノベルティ等。単価、対応エリア、発注リードタイム、取引履歴。' || char(10) ||
    '- [人物](people) — 確定した登壇者・スタッフ。登壇歴、連絡手段(方法のみ)、依頼への応じやすさ。' || char(10) ||
    '- [組織](orgs) — スポンサー企業・提携団体。窓口と過去の協賛内容。' || char(10) ||
    '- [プレイブック](playbooks) — 一般化された手順とテンプレート。対象業務、時系列、判断基準。' || char(10) ||
    '- [回答](answers) — Chat クエリから起票された回答ページ。信頼度は最低クラス。一次情報として扱わない。' || char(10) ||
    '- [ログ](log) — 追記専用の作業ログ。通常のクエリでは読まない。' || char(10),
  content_en =
    'This page is the catalog entry point. Pick one type, read that namespace page, then open individual pages.' || char(10) || char(10) ||
    '## How to use' || char(10) || char(10) ||
    '1. Read one namespace page from the list below. Each namespace page lists all pages of that type with summaries.' || char(10) ||
    '2. When the type is unclear, use wiki_search scoped with path.' || char(10) ||
    '3. Event-specific facts (who spoke, what it cost, what happened) start on the relevant events page. Venue, vendor, and person pages hold only durable properties of that entity.' || char(10) || char(10) ||
    '## Namespaces' || char(10) || char(10) ||
    '- [Events](events) — Per-event records: date, venue, attendance, budget, channel performance, day-of timeline, decisions and retrospectives. Slug: `YYYY-MM-DD-<name>`.' || char(10) ||
    '- [Venues](venues) — Capacity, cost, facilities, access, usage history, and on-site issues.' || char(10) ||
    '- [Vendors](vendors) — Catering, printing, novelties: unit prices, service area, lead time, history.' || char(10) ||
    '- [People](people) — Confirmed speakers and staff: speaking history, contact method only, receptiveness to requests.' || char(10) ||
    '- [Organizations](orgs) — Sponsors and partners: contacts and past sponsorship details.' || char(10) ||
    '- [Playbooks](playbooks) — Generalized procedures and templates: task, timeline, decision criteria.' || char(10) ||
    '- [Answers](answers) — Answer pages filed from Chat queries. Lowest trust class; not primary sources.' || char(10) ||
    '- [Log](log) — Append-only operational log. Do not read for ordinary queries.' || char(10),
  summary_ja = '型別名前空間へのルータ。ページ一覧は各名前空間ページにある。',
  summary_en = 'Router to type namespaces. Page listings live on each namespace page.',
  updated_at = unixepoch(),
  sync_revision = sync_revision + 1
WHERE id = 'ns-index'
  AND content_ja LIKE '## Events%';
