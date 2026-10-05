import twitterText from "twitter-text";

export const X_POST_CHARACTER_LIMIT = 280;
export const X_COUNTER_NUMBER_THRESHOLD = 10;

export type XPostLinkRange = {
  start: number;
  end: number;
};

export function parseXPostText(text: string) {
  return twitterText.parseTweet(text);
}

/**
 * Returns UTF-16 ranges for entities that X displays as links: URLs, mentions,
 * hashtags, and cashtags. These indices can be used directly with String#slice.
 */
export function getXPostLinkRanges(text: string): XPostLinkRange[] {
  return twitterText
    .extractEntitiesWithIndices(text)
    .map(({ indices: [start, end] }) => ({ start, end }))
    .filter(({ start, end }) => start >= 0 && end > start && end <= text.length)
    .sort((a, b) => a.start - b.start);
}

/**
 * X's composer shows the remaining count in the unit of the character currently
 * being entered. Japanese and emoji therefore display half the weighted remainder.
 */
export function xCounterDisplayRemaining(text: string, weightedLength: number) {
  const lastCharacter = Array.from(text).at(-1);
  const lastCharacterWeight = lastCharacter
    ? Math.min(parseXPostText(lastCharacter).weightedLength, 2)
    : 1;
  return Math.trunc((X_POST_CHARACTER_LIMIT - weightedLength) / lastCharacterWeight);
}
