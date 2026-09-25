// The only way billet text becomes structure: *emphasis*, **strong**, \n line breaks and blank-line
// paragraphs. Everything else - HTML included - stays literal text; the view renders the nodes
// with @for and never touches innerHTML.

export type InlineNode =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'break' }
  | { readonly type: 'em'; readonly children: readonly InlineNode[] }
  | { readonly type: 'strong'; readonly children: readonly InlineNode[] };

export type MarkupParagraph = readonly InlineNode[];

/** A run of `*`. It may open when text follows it, and close when text precedes it. */
interface Delimiter {
  readonly type: 'delimiter';
  count: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

type Item = InlineNode | Delimiter;

/** A line holding only whitespace counts as blank; several blank lines are one gap. */
const PARAGRAPH_GAP = /\n[^\S\n]*\n\s*/;

export function parseInlineMarkup(text: string): MarkupParagraph[] {
  return text
    .split(PARAGRAPH_GAP)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => resolve(tokenize(paragraph)));
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

function tokenize(paragraph: string): Item[] {
  const items: Item[] = [];
  let text = '';
  const flush = () => {
    if (text) items.push({ type: 'text', text });
    text = '';
  };
  for (let i = 0; i < paragraph.length;) {
    const char = paragraph[i];
    if (char === '\n') {
      flush();
      items.push({ type: 'break' });
      i++;
    } else if (char === '*') {
      let end = i;
      while (paragraph[end] === '*') end++;
      const canOpen = !isSpace(paragraph[end]);
      const canClose = !isSpace(paragraph[i - 1]);
      if (canOpen || canClose) {
        flush();
        items.push({ type: 'delimiter', count: end - i, canOpen, canClose });
      } else {
        text += paragraph.slice(i, end);
      }
      i = end;
    } else {
      text += char;
      i++;
    }
  }
  flush();
  return items;
}

/**
 * Pairs each closing run with the nearest opening run before it (the CommonMark delimiter
 * algorithm without its punctuation rules): two stars from both sides make strong, one makes
 * emphasis, so `***x***` is emphasis around strong. Runs between a pair and runs left unpaired
 * become literal stars.
 */
function resolve(items: Item[]): InlineNode[] {
  for (let i = 0; i < items.length;) {
    const closer = items[i];
    const openerAt = closer.type === 'delimiter' && closer.canClose ? openerBefore(items, i) : -1;
    i = openerAt < 0 ? i + 1 : pair(items, openerAt, i);
  }
  return literal(items);
}

/**
 * Wraps everything between the two runs, consuming stars from both, and answers where to go on:
 * at what is left of the closer, which may close an earlier run too.
 */
function pair(items: Item[], openerAt: number, closerAt: number): number {
  const opener = items[openerAt] as Delimiter;
  const closer = items[closerAt] as Delimiter;
  const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
  const wrapped: InlineNode = {
    type: used === 2 ? 'strong' : 'em',
    children: literal(items.slice(openerAt + 1, closerAt)),
  };
  opener.count -= used;
  closer.count -= used;
  const before = opener.count > 0 ? [opener] : [];
  const after = closer.count > 0 ? [closer] : [];
  items.splice(openerAt, closerAt - openerAt + 1, ...before, wrapped, ...after);
  return openerAt + before.length + 1;
}

function openerBefore(items: readonly Item[], closerAt: number): number {
  for (let j = closerAt - 1; j >= 0; j--) {
    const item = items[j];
    if (item.type === 'delimiter' && item.canOpen) return j;
  }
  return -1;
}

/** Unpaired runs become their stars; neighbouring text merges into one node. */
function literal(items: readonly Item[]): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (const item of items) {
    const node: InlineNode =
      item.type === 'delimiter' ? { type: 'text', text: '*'.repeat(item.count) } : item;
    const last = nodes.at(-1);
    if (node.type === 'text' && last?.type === 'text') {
      nodes[nodes.length - 1] = { type: 'text', text: last.text + node.text };
    } else {
      nodes.push(node);
    }
  }
  return nodes;
}
