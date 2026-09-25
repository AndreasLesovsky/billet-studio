// What the backend accepts in billet text: no C0 control character but the \n line break, no DEL,
// no unpaired UTF-16 surrogate (docs/billet-document.md). The editor cleans input with these
// instead of letting a save fail with VALIDATION_ERROR.

const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Drops \r (so \r\n becomes \n), turns a tab into one space, strips other controls; NFC. */
export function sanitizeText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(LONE_SURROGATE, '')
    .normalize('NFC');
}

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * The longest start of `text` that fits `max` UTF-16 code units (the unit of TEXT_LIMITS), cut
 * only between graphemes: an emoji, a flag or a ZWJ family is kept whole or dropped whole.
 * Without Intl.Segmenter it cuts between code points, which still never halves a character.
 */
export function truncateGraphemes(text: string, max: number): string {
  if (text.length <= max) return text;
  const units = segmenter
    ? Array.from(segmenter.segment(text), (s) => s.segment)
    : Array.from(text);
  const kept: string[] = [];
  let length = 0;
  for (const unit of units) {
    if (length + unit.length > max) break;
    kept.push(unit);
    length += unit.length;
  }
  return kept.join('');
}
