import {
  createBlock,
  type BilletBlock,
  type BilletDocument,
} from '../../../../billet/billet-document';

// The block list's edits, each one EditorCommands.commit step. Blocks that stay keep their object:
// Signal Forms know a block's fields by the object (see EditorHistory).

const withBlocks = (document: BilletDocument, blocks: BilletBlock[]): BilletDocument => ({
  ...document,
  blocks,
});

/** After the block `afterId`, or at the end without one (or when it is gone). */
export function insertBlock(
  document: BilletDocument,
  block: BilletBlock,
  afterId: string | null,
): BilletDocument {
  const blocks = [...document.blocks];
  const after = blocks.findIndex((b) => b.id === afterId);
  blocks.splice(after < 0 ? blocks.length : after + 1, 0, block);
  return withBlocks(document, blocks);
}

export function moveBlock(document: BilletDocument, from: number, to: number): BilletDocument {
  const last = document.blocks.length - 1;
  const target = Math.min(last, Math.max(0, to));
  if (from === target || from < 0 || from > last) return document;
  const blocks = [...document.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(target, 0, moved);
  return withBlocks(document, blocks);
}

/**
 * A fresh block with the same content. Built with createBlock, never by spreading the original:
 * that would copy the form's identity mark and make both one field.
 */
export function copyBlock(block: BilletBlock): BilletBlock {
  const { type, text, icon, ariaLabel, dividerStyle, spaceAdjust } = block;
  return createBlock(type, { text, icon, ariaLabel, dividerStyle, spaceAdjust });
}

export function removeBlock(document: BilletDocument, id: string): BilletDocument {
  return withBlocks(
    document,
    document.blocks.filter((b) => b.id !== id),
  );
}

export function setBlockText(document: BilletDocument, id: string, text: string): BilletDocument {
  return withBlocks(
    document,
    document.blocks.map((b) => (b.id === id ? { ...b, text } : b)),
  );
}
