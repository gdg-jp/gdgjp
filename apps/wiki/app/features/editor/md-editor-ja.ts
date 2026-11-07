import { config } from "md-editor-rt";

/** md-editor-rt ships zh-CN and en-US only; this is the Japanese UI for the wiki's editors. */
export const MD_EDITOR_JA = {
  toolbarTips: {
    bold: "太字",
    underline: "下線",
    italic: "斜体",
    strikeThrough: "取り消し線",
    title: "見出し",
    sub: "下付き",
    sup: "上付き",
    quote: "引用",
    unorderedList: "箇条書き",
    orderedList: "番号付きリスト",
    task: "タスクリスト",
    codeRow: "インラインコード",
    code: "コードブロック",
    link: "リンク",
    image: "画像",
    table: "表",
    mermaid: "Mermaid 図",
    katex: "数式",
    revoke: "元に戻す",
    next: "やり直す",
    save: "保存",
    prettier: "整形",
    pageFullscreen: "ページ内で全画面",
    fullscreen: "全画面",
    preview: "プレビュー",
    previewOnly: "プレビューのみ",
    htmlPreview: "HTML プレビュー",
    catalog: "目次",
    github: "ソースコード",
  },
  titleItem: {
    h1: "見出し 1",
    h2: "見出し 2",
    h3: "見出し 3",
    h4: "見出し 4",
    h5: "見出し 5",
    h6: "見出し 6",
  },
  imgTitleItem: {
    link: "画像リンクを追加",
    upload: "画像をアップロード",
    clip2upload: "切り抜いてアップロード",
  },
  linkModalTips: {
    linkTitle: "リンクを追加",
    imageTitle: "画像を追加",
    descLabel: "説明:",
    descLabelPlaceHolder: "説明を入力...",
    urlLabel: "URL:",
    urlLabelPlaceHolder: "URL を入力...",
    buttonOK: "OK",
  },
  clipModalTips: {
    title: "画像を切り抜いてアップロード",
    buttonUpload: "アップロード",
  },
  copyCode: {
    text: "コピー",
    successTips: "コピーしました",
    failTips: "コピーできませんでした",
  },
  mermaid: {
    flow: "フロー図",
    sequence: "シーケンス図",
    gantt: "ガントチャート",
    class: "クラス図",
    state: "状態図",
    pie: "円グラフ",
    relationship: "ER 図",
    journey: "ジャーニー図",
  },
  katex: {
    inline: "インライン数式",
    block: "ブロック数式",
  },
  footer: {
    markdownTotal: "文字数",
    scrollAuto: "同期スクロール",
  },
};

export const MD_EDITOR_LANG_JA = "ja-JP";

let registered = false;
/** Register once per runtime (server and client), before an editor renders with `ja-JP`. */
export function registerMdEditorJa(): void {
  if (registered) return;
  registered = true;
  config({ editorConfig: { languageUserDefined: { [MD_EDITOR_LANG_JA]: MD_EDITOR_JA } } });
}

/** The md-editor UI language for the current UI language. */
export function mdEditorLanguage(uiLanguage: string): string {
  return uiLanguage === "ja" ? MD_EDITOR_LANG_JA : "en-US";
}
