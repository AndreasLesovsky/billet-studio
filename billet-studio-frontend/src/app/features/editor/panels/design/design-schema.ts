import { disabled, max, min, pattern, schema } from '@angular/forms/signals';

import { FONT_ROLES, type BilletDocument } from '../../../../billet/billet-document';
import { HEX_COLOR_PATTERN, NUMBER_LIMITS } from '../../../../billet/billet-limits';
import { italicAvailable, PALETTE_ROLES } from './design-edits';

/**
 * Rules for the fields the design panel binds (palette, typography, colour mode), bounds from
 * billet-limits.ts. billetSchema applies it; the size sliders read their min/max from here. Italic
 * is disabled where the family ships no italic face at the chosen weight.
 */
export const designSchema = schema<BilletDocument>((p) => {
  for (const role of PALETTE_ROLES) {
    pattern(p.palette.light[role], HEX_COLOR_PATTERN, { message: 'EDITOR.VALIDATION.HEX_COLOR' });
    pattern(p.palette.dark[role], HEX_COLOR_PATTERN, { message: 'EDITOR.VALIDATION.HEX_COLOR' });
  }
  for (const role of FONT_ROLES) {
    const font = p.typography[role];
    min(font.size, NUMBER_LIMITS.fontSize.min, { message: 'FORMS.MIN' });
    max(font.size, NUMBER_LIMITS.fontSize.max, { message: 'FORMS.MAX' });
    disabled(font.italic, {
      when: ({ valueOf }) => !italicAvailable(valueOf(font.fontId), valueOf(font.weight)),
    });
  }
});
