# GDG Apps design system — v0.1

## 設計判断

採用日: 2026-09-11。状態: Accepted。

GDG Apps間でばらつくデザイン判断を、トークン→アクセシブルな操作基盤→部品→画面構成の順に統一します。tinyurlは情報密度とナビゲーションの参考であり、既存CSSや業務ロジックを正本にはしません。初期導入は独立ライブラリと架空データによる管理画面に限定します。

- **CSSを唯一のトークン正本にする。** WebとTailwind v4の利用が中心であるため。DTCGとFigmaへの同期は将来必要になった時点で一方向の変換として設計し、現在は別の手編集値を作りません。
- **Radixを操作基盤にする。** 利用者指定とReact 19環境を優先し、focus・ARIA・キーボード処理を自作しません。Base UIを併用しません。
- **名前付きCSSレイヤーで配布する。** コンポーネントは配布物だけで描画でき、利用者のTailwindスキャンに依存しません。レイヤーはgdg-tokens→gdg-base→gdg-components→utilities。グローバルresetは利用者の選択です。
- **privateな単一workspaceにする。** 公開APIはバージョン管理しますがnpm公開・アプリ換装・ホスティングはこの段階で行いません。フォント・CSS・Reactはexportを分け、不要な読み込みを避けます。

## 視覚言語

余白、整列、文字の大小と太さで階層を作ります。通常画面は中立色を主体に、GDG Blueを主要操作へ集中させます。claymorphismの柔らかな立体感は、塗り・外側のふくらみ・内側のハイライトを同じトークンで揃え、装飾ではなく操作対象の面を見分けるために使います。グラデーションやガラス表現、過度なぼかしは使いません。ロゴやイベント固有の装飾は基本UIに混ぜず、公式アセットを無加工で使う場面に限定します。

| トークン | 値／割当 |
| --- | --- |
| white / white-2 | #FFFFFF / #F8F8F8 |
| black / black-2 | #141414 / #1E1E1E |
| background | Light=white-2、Dark=black-2 |
| surface | Light=white、Dark=black |
| text | Light=black-2、Dark=white-2 |
| border / shadow | 区切り線は薄いニュートラル色。部品の輪郭はテーマ別の3段階の影 |
| primary / on-primary | 両テーマとも#4285F4 / #FFFFFF |
| red / green / yellow | #EA4335 / #34A853 / #F9AB00。アクセント用 |
| radius | 小14px、入力・ボタン18px、カード28px、Dialog32px。円・pill・角丸なしは維持 |
| spacing | 4pxを単位に8／12／16／24／32／48px |
| type | Google Sans + Noto Sans JP。本文16px、操作14px、補助12px、見出し20〜32px |
| controls | 通常40px、sm32px、lg44px。タッチ環境では44px以上 |

ブランド色は固定値、操作上の意味はテーマ別の変数で表現します。primaryの文字・アイコンは白です（2026-09-12変更）。GDG Blueとのコントラストは約3.56:1で、通常サイズの文字のWCAG AA基準4.5:1を満たさない既知の制約があります。リンクの青は別トークンです。Red／Green／Yellowをそのまま小さな文字に使わず、danger／success／warningを使います。

カード、ボタン、aside、入力、ポップアップなどは、塗りに対して外側の影と内側の影を重ねたclay面で表現します。操作部品と小さな面はsm、カードとポップアップはmd、Dialogはlgを使います。入力はinsetを主体にして押し込まれた面とし、ボタンの押下時にはpressedトークンへ切り替えます。hoverは精密ポインターだけで少し浮かせ、ghostボタンには影を付けません。Sidebar、Header、Sheetは隣接する領域側へ方向影を落としつつ、内側のエッジハイライトで面を揃えます。表、Accordion、Separatorのように情報を区切る線は、薄いborderトークンを使って残し、Tabsはinsetのトラックとraisedの選択面で表現します。エラー境界とfocusは専用色で識別し、強制カラーモードでは影の代わりに枠線を表示します。通常文字4.5:1、必要な操作部品とfocusは3:1を下限とします。disabled以外の状態を不透明度低下だけで表しません。

## 部品選択

- 一画面の主目的にprimaryを使い、同列の補助操作はsecondaryまたはoutline、低優先操作はghost。危険な確定操作だけdanger。
- 必須情報はTooltipに隠しません。Tooltipは短い補足、Popoverは起点に紐づく小さな操作、Dialogは作業の一時的な集中、Sheetは補助ナビゲーション、AlertDialogは取り消し可能な確認段階に使います。
- 複数候補から一つはRadioGroup、候補が多いときはSelect。即時反映される二値設定はSwitch、同意やフォーム内の選択はCheckbox。
- Cardsを入れ子に重ねず、同一作業内ではStackとSeparatorで整理します。Tableは比較が必要な構造化データに使います。
- Toastは短い操作結果に限り、解決が必要なエラーは該当FormFieldまたはAlertにも残します。
- 高度なDataGrid、チャート、日付選択、検索付き選択は初期API外。必要性が確認された時点で適切なライブラリを選びます。

## Motion契約

目的はフィードバック、状態変化の理解、開閉時の位置関係です。

| 対象 | 時間 | 手段 |
| --- | --- | --- |
| ポインター押下 | 120ms | CSS transform transition、scale(.97) |
| Tooltip | 125ms | 起点からのopacity／transform |
| Popover／Menu／Select | 180ms | 起点からのopacity／transform |
| Dialog／背景 | 250ms | opacity、Dialogのみscale(.97) |
| Sheet | 280ms | 左右それぞれ画面外からtranslateX |
| Accordion | 200ms | Radix計測高とopacity |

基本曲線はcubic-bezier(0.23, 1, 0.32, 1)。Sheetはcubic-bezier(0.32, 0.72, 0, 1)。transform-originはRadixの配置変数を使用します。

表示アニメーションはCSS transition。Radix Presenceには値を描画しない退出寿命アニメーションを渡し、transition中のマウントを保持します。共通ref管理でclosedの内容をinertにし、再オープンで解除します。SelectはRadixにforceMountがないため論理的なopenと退出保持を分離し、CSSから取得した時間だけ保持します。制御値・aria-expandedは論理状態を反映し、退出後にRadixのフォーカス復帰を完了します。

キーボード起因の操作は遷移を省略します。ThemeProviderが文書のpointerdown／keydownを監視するため、Portalも同じ判断を使います。タブ切替、テーマ切替、一覧更新には装飾的な移動を付けません。hoverはhover可能な精密ポインターだけに限定します。

reduced motionは移動・拡縮を除き、短いopacity変化を残します。Spinnerは回転を止めても読込状態を通知します。ToastはSonnerの位置・重なり・dismiss機構を維持し、テーマと時間をトークンへ合わせます。常時動くSkeleton、transition: all、scale(0)、UIへのease-inは禁止です。

## 完成・変更の基準

追加・変更には、用途と非用途、API、Light／Darkの状態、キーボード操作、focus、ラベル、reduced motion、forced-colors、長い日本語、狭い画面の確認を伴わせます。動きはコードだけで判断せず、実ブラウザーの連続開閉と低速再生でも確認します。

Storybookは単体状態だけでなく、管理画面の組み合わせを維持します。VitestはAPIとSSR、Playwrightは操作と画像、axeは自動検査可能なアクセシビリティを担います。axeの成功だけを人による操作確認の代わりにしません。

公開契約はexport名、props、CSS変数、Tailwindの意味ユーティリティ、テーマ設定です。後方互換の修正はpatch、追加はminor、削除・意味変更はmajor相当として扱います。0.x期間も破壊的変更を明示し、移行手順を書きます。削除前に非推奨化期間を置き、旧名は同じ正本を参照するaliasとして維持します。

変更者が用途と根拠を提示し、コード・デザイン・アクセシビリティをレビューします。同じ用途の別実装を追加する前に既存部品の合成で解決できるか確認します。外観変更時は基準画像を目視し、更新理由をPRへ記載します。
