import { apply, maxLength, schema } from '@angular/forms/signals';

import type { BilletDocument } from '../../billet/billet-document';
import { TEXT_LIMITS } from '../../billet/billet-limits';
import { nonBlank } from '../../core/forms/signal-validators';
import { contentSchema } from './panels/content/content-schema';
import { designSchema } from './panels/design/design-schema';
import { particlesSchema } from './panels/particles/particles-schema';
import { sceneSchema } from './panels/scene/scene-schema';
import { spacingSchema } from './panels/spacing/spacing-schema';

// The editor's form model IS the BilletDocument (CLAUDE.md section 7): the shape stored locally and
// on the server, so there is no mapping in either direction. Each panel keeps the rules of the
// fields it binds beside it; this schema adds the toolbar's title and composes them.

export const billetSchema = schema<BilletDocument>((p) => {
  nonBlank(p.title, 'EDITOR.VALIDATION.TITLE_REQUIRED');
  maxLength(p.title, TEXT_LIMITS.title, { message: 'FORMS.MAX_LENGTH' });
  apply(p, contentSchema);
  apply(p, designSchema);
  apply(p, spacingSchema);
  apply(p, sceneSchema);
  apply(p, particlesSchema);
});
