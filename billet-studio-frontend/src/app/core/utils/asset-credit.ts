/** A model's attribution, split for a credit line: the text and, when it ends in one, its link. */
export interface AssetCredit {
  readonly text: string;
  readonly url: string | null;
}

/** The asset pipeline writes '<title> by <author> (<licence>) <source url>'; the URL is the link. */
export function splitCredit(credit: string): AssetCredit {
  const match = /^(.*\S)\s+(https?:\/\/\S+)$/.exec(credit);
  return match ? { text: match[1], url: match[2] } : { text: credit, url: null };
}
