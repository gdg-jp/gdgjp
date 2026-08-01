declare module "twitter-text" {
  type ParsedTweet = {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    validRangeStart: number;
    validRangeEnd: number;
    displayRangeStart: number;
    displayRangeEnd: number;
  };

  type TextEntity = {
    indices: [number, number];
  };

  const twitterText: {
    parseTweet(text: string): ParsedTweet;
    extractEntitiesWithIndices(text: string): TextEntity[];
  };

  export default twitterText;
}
