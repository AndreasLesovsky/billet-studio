import { FONT_ROLES, type BilletDocument, type FontRole } from './billet-document';
import { parseInlineMarkup, type InlineNode } from './text/inline-markup';
import { truncateGraphemes } from './text/text-sanitize';

/** The longest role sample the editor shows before it cuts at a word boundary. */
const SAMPLE_MAX = 40;

/** The billet's texts each typography role sets, in reading order; a part that is off is ''. */
export function roleTexts(document: BilletDocument): Record<FontRole, string[]> {
  const { hero, scene, blocks, signature } = document;
  const blockTexts = (...types: string[]) =>
    blocks.filter((block) => types.includes(block.type)).map((block) => block.text);
  return {
    title: [hero.titleLine1],
    titleAccent: [hero.titleLine2],
    heading: blockTexts('heading'),
    body: blockTexts('paragraph', 'card', 'note'),
    signature: [signature.name],
    ui: [hero.label, hero.sub, scene.enabled ? scene.hint : '', signature.sub],
  };
}

function plain(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.text;
      return node.type === 'break' ? ' ' : plain(node.children);
    })
    .join('');
}

/** A role's texts as one plain line, cut at a word boundary with an ellipsis past about 40. */
function roleSample(texts: readonly string[]): string {
  const text = texts
    .flatMap((part) => parseInlineMarkup(part).map(plain))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= SAMPLE_MAX) return text;
  const cut = text.slice(0, SAMPLE_MAX + 1);
  const space = cut.lastIndexOf(' ');
  const head = space > 0 ? cut.slice(0, space) : truncateGraphemes(text, SAMPLE_MAX);
  return `${head.replace(/[\s,.;:·–—-]+$/u, '')}…`;
}

/**
 * Per role a short sample of the billet's own text in it, for the font picker: markup stripped,
 * whitespace collapsed, shortened at a word boundary. '' for a role that sets no text.
 */
export function roleSamples(document: BilletDocument): Record<FontRole, string> {
  const texts = roleTexts(document);
  const samples = {} as Record<FontRole, string>;
  for (const role of FONT_ROLES) samples[role] = roleSample(texts[role]);
  return samples;
}
