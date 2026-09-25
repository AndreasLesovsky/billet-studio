/**
 * Up to two uppercase initials for the avatar fallback:
 * - two or more words in the name: the first letter of the first two ("Anna Berger" → "AB");
 * - one word: its first two letters ("Anna" → "AN");
 * - no usable name: the first two letters of the email's local part ("info@x.at" → "IN").
 * Empty when neither is usable.
 */
export function getUserInitials(name?: string | null, email?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return (firstLetter(words[0]) + firstLetter(words[1])).toUpperCase();
  }
  if (words.length === 1) {
    return firstLetters(words[0], 2).toUpperCase();
  }

  const localPart = (email ?? '').trim().split('@')[0];
  return firstLetters(localPart, 2).toUpperCase();
}

// By code point, so a letter outside the BMP is never cut in half.
function firstLetters(word: string, count: number): string {
  return Array.from(word).slice(0, count).join('');
}

function firstLetter(word: string): string {
  return firstLetters(word, 1);
}
