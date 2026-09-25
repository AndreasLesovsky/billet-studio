import { describe, expect, it } from 'vitest';

import { formFor } from '../../../test-helpers';
import {
  createBlock,
  createDocument,
  type BilletBlock,
  type BilletDocument,
  type BlockType,
} from '../../billet/billet-document';
import { billetSchema } from './editor-schema';

const OPTIONAL_FIELDS = ['text', 'icon', 'ariaLabel', 'dividerStyle'] as const;

describe('billetSchema', () => {
  function billetForm(patch: Partial<BilletDocument>) {
    return formFor<BilletDocument>({ ...createDocument({ lang: 'de' }), ...patch }, billetSchema);
  }

  it.each<[BlockType, number, readonly (typeof OPTIONAL_FIELDS)[number][]]>([
    ['paragraph', 2000, ['text']],
    ['heading', 160, ['text']],
    ['card', 1200, ['text', 'icon', 'ariaLabel']],
    ['note', 600, ['text']],
    ['divider', 0, ['dividerStyle']],
  ])('a %s takes %i characters and uses only %j', (type, limit, used) => {
    const { model, tree } = billetForm({
      blocks: [createBlock(type, { text: 'x'.repeat(limit) })],
    });
    const block = tree.blocks[0];
    const setText = (text: string) =>
      model.update((doc) => ({ ...doc, blocks: [{ ...doc.blocks[0], text } as BilletBlock] }));

    expect(OPTIONAL_FIELDS.filter((field) => !block[field]().hidden())).toEqual(used);
    expect(block().valid()).toBe(true);

    setText('x'.repeat(limit + 1));
    // A divider's text is hidden, and a hidden field is never validated.
    expect(block.text().errors()[0]?.message).toBe(
      type === 'divider' ? undefined : 'FORMS.MAX_LENGTH',
    );
  });

  it.each([
    ['', 'EDITOR.VALIDATION.TITLE_REQUIRED'],
    [' \n ', 'EDITOR.VALIDATION.TITLE_REQUIRED'],
    ['x'.repeat(121), 'FORMS.MAX_LENGTH'],
    ['Für Mama', undefined],
  ])('the title %j fails with %s', (title, key) => {
    expect(billetForm({ title }).tree.title().errors()[0]?.message).toBe(key);
  });
});
