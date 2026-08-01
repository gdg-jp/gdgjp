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

  const twitterText: {
    parseTweet(text: string): ParsedTweet;
  };

  export default twitterText;
}
