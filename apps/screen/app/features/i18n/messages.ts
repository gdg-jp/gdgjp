/**
 * Speaker-facing strings (the only bilingual surface). Most are tooltips and
 * accessible names: the UI itself is icon-first.
 */
export type Lang = "ja" | "en";

export const LANG_COOKIE = "screen-lang";

const ja = {
  name: "お名前",
  join: "参加",
  micOn: "マイクをオフ",
  micOff: "マイクをオン",
  camOn: "カメラをオフ",
  camOff: "カメラをオン",
  share: "画面を共有",
  stopShare: "共有を停止",
  switchShare: "共有する画面を切り替え",
  mic: "マイク",
  camera: "カメラ",
  micSettings: "マイクとスピーカーの設定",
  camSettings: "カメラの設定",
  systemDefault: "システムのデフォルト",
  nameRequired: "お名前を入力してください",
  speaker: "スピーカー",
  testSound: "テスト音を鳴らす",
  defaultDevice: "既定",
  safariAudio: "このブラウザではタブの音声を共有できません",
  earphones: "ハウリング防止のためイヤホンの使用をおすすめします",
  onAir: "ON AIR",
  connected: "CONNECTED",
  reconnecting: "再接続中…",
  offline: "接続できません",
  retry: "再試行",
  permissionTitle: "カメラ・マイクへのアクセスが許可されていません",
  permissionHelp:
    "アドレスバー左の 🔒 アイコン → カメラ・マイクを「許可」にして、ページを再読み込みしてください。",
  deviceInUse: "ほかのアプリがカメラ・マイクを使用中です",
  deviceMissing: "カメラ・マイクが見つかりません",
  reload: "再読み込み",
  shareStopped: "画面共有が停止されました",
  reshare: "再共有",
  chat: "チャット",
  send: "送信",
  miniWindow: "ミニ表示",
  leave: "退出",
  ok: "OK",
  operator: "配信担当",
  you: "あなた",
  remaining: "残り時間",
  replaced: "別のタブでこのステージを開いています",
  deleted: "このステージは削除されました",
  invalid: "リンクが無効です",
  useDesktop: "画面共有のため PC のブラウザで開いてください",
  pipHint: "ミニ表示の小窓は共有する画面に選ばないでください",
  helpLobby:
    "カメラとマイクを確認して「参加」を押してください。参加しても、配信担当が出力に割り当てるまで配信には映りません。",
  helpRoom:
    "● ON AIR が赤いとき、あなたの映像と音声が配信に出ています。配信担当からの指示は画面上部に大きく表示されます。",
  helpPip:
    "ミニ表示は常に最前面に出る小窓です。スライドを全画面にしていても、残り時間と指示が見えます。",
  talking: "話しています",
  left: "退出しました",
  rejoin: "もう一度参加",
} as const;

export type MessageKey = keyof typeof ja;

const en: Record<MessageKey, string> = {
  name: "Your name",
  join: "Join",
  micOn: "Turn off microphone",
  micOff: "Turn on microphone",
  camOn: "Turn off camera",
  camOff: "Turn on camera",
  share: "Share screen",
  stopShare: "Stop sharing",
  switchShare: "Share a different screen",
  mic: "Microphone",
  camera: "Camera",
  micSettings: "Microphone and speaker settings",
  camSettings: "Camera settings",
  systemDefault: "System default",
  nameRequired: "Please enter your name",
  speaker: "Speaker",
  testSound: "Play test sound",
  defaultDevice: "Default",
  safariAudio: "This browser cannot share tab audio",
  earphones: "Use earphones to avoid echo",
  onAir: "ON AIR",
  connected: "CONNECTED",
  reconnecting: "Reconnecting…",
  offline: "Cannot connect",
  retry: "Retry",
  permissionTitle: "Camera / microphone access is blocked",
  permissionHelp:
    "Click the 🔒 icon at the left of the address bar, allow camera and microphone, then reload.",
  deviceInUse: "Another app is using the camera / microphone",
  deviceMissing: "No camera / microphone found",
  reload: "Reload",
  shareStopped: "Screen sharing stopped",
  reshare: "Share again",
  chat: "Chat",
  send: "Send",
  miniWindow: "Mini window",
  leave: "Leave",
  ok: "OK",
  operator: "Operator",
  you: "You",
  remaining: "Time left",
  replaced: "This stage is open in another tab",
  deleted: "This stage has been deleted",
  invalid: "This link is not valid",
  useDesktop: "Please open this page in a desktop browser to share your screen",
  pipHint: "Do not pick the mini window as the screen to share",
  helpLobby:
    "Check your camera and microphone, then press Join. You are not on the stream until the operator puts you on an output.",
  helpRoom:
    "When ● ON AIR is red, your video and audio are on the stream. Cues from the operator appear large at the top.",
  helpPip:
    "The mini window stays on top of everything, so you can see the time left and cues even with full-screen slides.",
  talking: "is talking",
  left: "You left the stage",
  rejoin: "Join again",
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { ja, en };

export function isLang(value: unknown): value is Lang {
  return value === "ja" || value === "en";
}

/** Cookie first, then Accept-Language; Japanese by default. */
export function pickLang(cookieHeader: string | null, acceptLanguage: string | null): Lang {
  const cookie = cookieHeader
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LANG_COOKIE}=`))
    ?.slice(LANG_COOKIE.length + 1);
  if (isLang(cookie)) return cookie;
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first && !first.startsWith("ja")) return "en";
  return "ja";
}
