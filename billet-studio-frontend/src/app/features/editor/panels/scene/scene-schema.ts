import { max, maxLength, min, schema } from '@angular/forms/signals';

import type { BilletDocument } from '../../../../billet/billet-document';
import { NUMBER_LIMITS, TEXT_LIMITS } from '../../../../billet/billet-limits';
import { ASSET_DEFAULT_KEYS } from '../../../../billet/asset-defaults';

/**
 * Rules for the fields the scene panel binds (the stage settings, hint and label), bounds from
 * billet-limits.ts. billetSchema applies it; the sliders read their min/max from here.
 */
export const sceneSchema = schema<BilletDocument>((p) => {
  for (const key of ASSET_DEFAULT_KEYS) {
    min(p.scene[key], NUMBER_LIMITS[key].min, { message: 'FORMS.MIN' });
    max(p.scene[key], NUMBER_LIMITS[key].max, { message: 'FORMS.MAX' });
  }
  maxLength(p.scene.hint, TEXT_LIMITS.sceneHint, { message: 'FORMS.MAX_LENGTH' });
  maxLength(p.scene.ariaLabel, TEXT_LIMITS.sceneAriaLabel, {
    message: 'FORMS.MAX_LENGTH',
  });
});
