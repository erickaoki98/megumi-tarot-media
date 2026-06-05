export type Token = { raw: string; norm: string };

const COMBINING = /[̀-ͯ]/g;

/** Lowercase, strip accents, keep only a-z0-9. */
export function normalize(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Split text on whitespace into tokens, dropping pure punctuation. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const norm = normalize(raw);
    if (!norm) continue;
    tokens.push({ raw, norm });
  }
  return tokens;
}

const WINDOW = 18; // how far ahead of the pointer to search
const LOOKBACK = 5; // how many recent heard words to align

/**
 * Given the script tokens, the recently heard words, and the current pointer,
 * return the new pointer (index of the next expected token). Never moves
 * backward; guards against single common-word false jumps.
 */
export function matchPosition(
  scriptTokens: Token[],
  heardTokens: string[],
  currentIndex: number,
): number {
  const heard = heardTokens.map(normalize).filter(Boolean).slice(-LOOKBACK);
  if (heard.length === 0) return currentIndex;

  const end = Math.min(scriptTokens.length, currentIndex + WINDOW);
  let best = currentIndex;
  let bestScore = 0;

  for (let p = currentIndex; p < end; p++) {
    let score = 0;
    for (let k = 0; k < heard.length; k++) {
      const sIdx = p - k;
      if (sIdx < currentIndex - 1 || sIdx < 0) break;
      if (scriptTokens[sIdx].norm === heard[heard.length - 1 - k]) score++;
    }
    if (score > 0 && score >= bestScore) {
      bestScore = score;
      best = p + 1; // next expected token
    }
  }

  // A single matched (possibly common) word must not cause a big jump.
  if (bestScore < 2 && best - currentIndex > 3) return currentIndex;
  return Math.max(best, currentIndex);
}
