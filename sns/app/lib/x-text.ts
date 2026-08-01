import twitterText from "twitter-text";

export const X_POST_CHARACTER_LIMIT = 280;
export const X_COUNTER_NUMBER_THRESHOLD = 10;

export function parseXPostText(text: string) {
  return twitterText.parseTweet(text);
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
