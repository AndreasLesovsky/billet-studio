import type { BilletDocument } from '../../../billet/billet-document';

// The home page hero's textures as billet documents: each is the template's own document with the
// parts a printed card or a thumbnail does not show switched off. Only document data changes; the
// real BilletView draws every one of them.

const NO_SIGNATURE: BilletDocument['signature'] = { name: '', sub: '' };
const NO_HERO: BilletDocument['hero'] = { label: '', titleLine1: '', titleLine2: '', sub: '' };

function withoutScene(document: BilletDocument): BilletDocument {
  return { ...document, scene: { ...document.scene, enabled: false } };
}

/**
 * The card's front: the hero alone, with the divider under it, on paper in the hero's own soft
 * accent (the page background takes it, so the hero band and its fade vanish into the paper).
 */
export function frontDocument(document: BilletDocument): BilletDocument {
  const light = document.palette.light;
  return {
    ...withoutScene(document),
    colorMode: 'light',
    palette: { ...document.palette, light: { ...light, background: light.accentSoft } },
    blocks: [],
    signature: NO_SIGNATURE,
    // The hero keeps its bottom padding: its fade to the background lies there, not over the sub.
    spacing: { ...document.spacing, heroTop: 0, dividerGap: 0, pageBottom: 0 },
  };
}

export interface InsidePages {
  readonly left: BilletDocument;
  readonly right: BilletDocument;
}

/**
 * The inside spread: the opening paragraphs on the left under the divider, the rest (card, note)
 * and the signature on the right. No hero: its band collapses to nothing with zero spacing.
 */
export function insidePages(document: BilletDocument): InsidePages {
  const firstOther = document.blocks.findIndex(
    (block) => block.type !== 'paragraph' && block.type !== 'heading',
  );
  const split = firstOther === -1 ? document.blocks.length : firstOther;
  const page: BilletDocument = {
    ...withoutScene(document),
    colorMode: 'light',
    hero: NO_HERO,
    spacing: { ...document.spacing, heroTop: 0, heroBottom: 0, pageBottom: 0 },
  };
  return {
    left: { ...page, blocks: document.blocks.slice(0, split), signature: NO_SIGNATURE },
    right: {
      ...page,
      divider: { style: 'none' },
      blocks: document.blocks
        .slice(split)
        .map((block, index) => (index === 0 ? { ...block, spaceAdjust: 0 } : block)),
      spacing: { ...page.spacing, dividerGap: 0 },
    },
  };
}

/** The link preview's thumbnail: the hero as the billet opens with it. */
export function thumbnailDocument(document: BilletDocument): BilletDocument {
  return {
    ...withoutScene(document),
    blocks: [],
    divider: { style: 'none' },
    signature: NO_SIGNATURE,
  };
}
