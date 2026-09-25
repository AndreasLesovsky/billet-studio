import { max, min, schema } from '@angular/forms/signals';

import { NUMBER_LIMITS } from '../../../billet/billet-limits';

/** A slice of a billet, one field per editor control, for the dev ui-kit. */
export interface ControlsSampleModel {
  accent: string;
  ink: string;
  titleSize: number;
  gutter: number;
  titleFont: string;
  modelSlug: string;
  icon: string;
}

/** The Muttertag card's values. */
export const SAMPLE_CONTROLS_MODEL: ControlsSampleModel = {
  accent: '#c8614a',
  ink: '#2a1f1a',
  titleSize: 1,
  gutter: 8,
  titleFont: 'cormorant-garamond',
  modelSlug: 'flower-bouquet',
  icon: '🌸',
};

// The range sliders read their bounds from these rules through [formField].
export const controlsSampleSchema = schema<ControlsSampleModel>((p) => {
  min(p.titleSize, NUMBER_LIMITS.fontSize.min, { message: 'FORMS.MIN' });
  max(p.titleSize, NUMBER_LIMITS.fontSize.max, { message: 'FORMS.MAX' });
  min(p.gutter, NUMBER_LIMITS.spaceStep.min, { message: 'FORMS.MIN' });
  max(p.gutter, NUMBER_LIMITS.spaceStep.max, { message: 'FORMS.MAX' });
});
