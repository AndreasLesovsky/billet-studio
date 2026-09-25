import { max, min, schema } from '@angular/forms/signals';

import type { BilletDocument } from '../../../../billet/billet-document';
import { NUMBER_LIMITS } from '../../../../billet/billet-limits';

type SpacingKey = keyof BilletDocument['spacing'];

/** The spacing steps, in the order they appear on the page. */
export const SPACING_KEYS = [
  'gutter',
  'heroTop',
  'heroBottom',
  'dividerGap',
  'blockGap',
  'signatureGap',
  'pageBottom',
] as const satisfies readonly SpacingKey[];

/**
 * Rules for the fields the spacing panel binds (the spacing steps, the scene height), bounds from
 * billet-limits.ts. billetSchema applies it; the sliders read their min/max from here.
 */
export const spacingSchema = schema<BilletDocument>((p) => {
  for (const key of SPACING_KEYS) {
    min(p.spacing[key], NUMBER_LIMITS.spaceStep.min, { message: 'FORMS.MIN' });
    max(p.spacing[key], NUMBER_LIMITS.spaceStep.max, { message: 'FORMS.MAX' });
  }
  min(p.scene.height, NUMBER_LIMITS.sceneHeight.min, { message: 'FORMS.MIN' });
  max(p.scene.height, NUMBER_LIMITS.sceneHeight.max, { message: 'FORMS.MAX' });
});
