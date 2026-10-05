export type ChannelCandidate = {
  id: string;
  label: string;
  aliases?: string[];
};

export const DEFAULT_CHANNELS: ChannelCandidate[] = [
  { id: "X", label: "X", aliases: ["Twitter", "X (Twitter)"] },
  { id: "Instagram", label: "Instagram", aliases: ["Insta"] },
  { id: "Discord", label: "Discord" },
  { id: "connpass", label: "connpass", aliases: ["コンパス"] },
  { id: "チラシ", label: "チラシ", aliases: ["フライヤー"] },
  { id: "知人から", label: "知人から", aliases: ["知人", "友人", "紹介"] },
  { id: "その他", label: "その他" },
];

export type ChannelMapping = {
  answer: string;
  channelIds: string[];
};

export function extractChannelQuestions(questions: string[]): string[] {
  const patterns = [
    /どこ.*知り/i,
    /何.*知り/i,
    /知った.*(?:場所|きっかけ|経路)/i,
    /(?:流入|認知).*(?:経路|きっかけ|チャネル)/i,
    /how did you (?:hear|learn|find)/i,
  ];
  return questions.filter((question) => patterns.some((pattern) => pattern.test(question)));
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

const KNOWN_ALIASES: Record<string, string> = {
  twitter: "x",
  "x (twitter)": "x",
  insta: "instagram",
  コンパス: "connpass",
  フライヤー: "チラシ",
  知人: "知人から",
  友人: "知人から",
  友人から: "知人から",
  紹介: "知人から",
};

function extractChannelIds(answer: string, channels: ChannelCandidate[]): string[] {
  const idsByAlias = new Map<string, string>();
  for (const channel of channels) {
    for (const alias of [channel.id, channel.label, ...(channel.aliases ?? [])]) {
      idsByAlias.set(normalized(alias), channel.id);
    }
  }
  return [
    ...new Set(
      answer
        .split(/[,、，/／\n]+/)
        .map(normalized)
        .filter(Boolean)
        .map((part) => KNOWN_ALIASES[part] ?? part)
        .map((part) => idsByAlias.get(part))
        .filter((channelId): channelId is string => channelId !== undefined),
    ),
  ];
}

export function extractChannelMappings(
  answers: string[],
  channels: ChannelCandidate[] = DEFAULT_CHANNELS,
): ChannelMapping[] {
  return answers.map((answer) => ({
    answer,
    channelIds: extractChannelIds(answer, channels),
  }));
}
