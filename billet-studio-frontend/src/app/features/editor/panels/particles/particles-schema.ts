import { applyEach, max, min, pattern, schema } from '@angular/forms/signals';

import type { BilletDocument } from '../../../../billet/billet-document';
import { HEX_COLOR_PATTERN, NUMBER_LIMITS } from '../../../../billet/billet-limits';

/**
 * Rules for the fields the particles panel binds (colours, density, speed and size), bounds from
 * billet-limits.ts. billetSchema applies it; the sliders read their min/max from here. The number of
 * colours is kept in range by the panel's add and remove buttons.
 */
export const particlesSchema = schema<BilletDocument>((p) => {
  applyEach(p.particles.colors, (color) => {
    pattern(color, HEX_COLOR_PATTERN, { message: 'EDITOR.VALIDATION.HEX_COLOR' });
  });
  min(p.particles.density, NUMBER_LIMITS.particleDensity.min, { message: 'FORMS.MIN' });
  max(p.particles.density, NUMBER_LIMITS.particleDensity.max, { message: 'FORMS.MAX' });
  min(p.particles.speed, NUMBER_LIMITS.particleSpeed.min, { message: 'FORMS.MIN' });
  max(p.particles.speed, NUMBER_LIMITS.particleSpeed.max, { message: 'FORMS.MAX' });
  min(p.particles.size, NUMBER_LIMITS.particleSize.min, { message: 'FORMS.MIN' });
  max(p.particles.size, NUMBER_LIMITS.particleSize.max, { message: 'FORMS.MAX' });
});
