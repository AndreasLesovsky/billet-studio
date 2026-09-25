import { applyEach, hidden, max, maxLength, min, schema } from '@angular/forms/signals';

import type { BilletBlock, BilletDocument } from '../../../../billet/billet-document';
import {
  BLOCK_TEXT_LIMITS,
  MAX_BLOCKS,
  NUMBER_LIMITS,
  TEXT_LIMITS,
} from '../../../../billet/billet-limits';

/**
 * One block. Every block has the same fields (one element shape for the array); its type decides
 * the text limit and hides the fields it does not use, and a hidden field is never validated.
 */
const blockSchema = schema<BilletBlock>((block) => {
  hidden(block.text, { when: ({ valueOf }) => valueOf(block.type) === 'divider' });
  hidden(block.icon, { when: ({ valueOf }) => valueOf(block.type) !== 'card' });
  hidden(block.ariaLabel, { when: ({ valueOf }) => valueOf(block.type) !== 'card' });
  hidden(block.dividerStyle, { when: ({ valueOf }) => valueOf(block.type) !== 'divider' });

  maxLength(block.text, ({ valueOf }) => BLOCK_TEXT_LIMITS[valueOf(block.type)], {
    message: 'FORMS.MAX_LENGTH',
  });
  maxLength(block.icon, TEXT_LIMITS.cardIcon, { message: 'FORMS.MAX_LENGTH' });
  maxLength(block.ariaLabel, TEXT_LIMITS.cardAriaLabel, {
    message: 'FORMS.MAX_LENGTH',
  });
  min(block.spaceAdjust, NUMBER_LIMITS.spaceAdjust.min, { message: 'FORMS.MIN' });
  max(block.spaceAdjust, NUMBER_LIMITS.spaceAdjust.max, { message: 'FORMS.MAX' });
});

/** The content panel's fields: page title, hero, blocks and signature (limits: billet-limits.ts). */
export const contentSchema = schema<BilletDocument>((p) => {
  maxLength(p.pageTitle, TEXT_LIMITS.pageTitle, { message: 'FORMS.MAX_LENGTH' });
  maxLength(p.hero.label, TEXT_LIMITS.heroLabel, { message: 'FORMS.MAX_LENGTH' });
  maxLength(p.hero.titleLine1, TEXT_LIMITS.heroTitleLine, {
    message: 'FORMS.MAX_LENGTH',
  });
  maxLength(p.hero.titleLine2, TEXT_LIMITS.heroTitleLine, {
    message: 'FORMS.MAX_LENGTH',
  });
  maxLength(p.hero.sub, TEXT_LIMITS.heroSub, { message: 'FORMS.MAX_LENGTH' });
  maxLength(p.blocks, MAX_BLOCKS, { message: 'EDITOR.VALIDATION.MAX_BLOCKS' });
  applyEach(p.blocks, blockSchema);
  maxLength(p.signature.name, TEXT_LIMITS.signatureName, {
    message: 'FORMS.MAX_LENGTH',
  });
  maxLength(p.signature.sub, TEXT_LIMITS.signatureSub, {
    message: 'FORMS.MAX_LENGTH',
  });
});
