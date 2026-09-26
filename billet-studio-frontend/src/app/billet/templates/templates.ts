import { GEBURTSTAG } from './geburtstag';
import { HOCHZEIT } from './hochzeit';
import { MUTTERTAG } from './muttertag';
import type { BilletTemplate } from './template';
import { VALENTINSTAG } from './valentinstag';
import { WEIHNACHTEN } from './weihnachten';

/** Picker order. A complete document from one: createDocument({ templateId, lang }). */
export const TEMPLATE_IDS = [
  'valentinstag',
  'geburtstag',
  'weihnachten',
  'hochzeit',
  'muttertag',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATES: Readonly<Record<TemplateId, BilletTemplate>> = {
  valentinstag: VALENTINSTAG,
  geburtstag: GEBURTSTAG,
  weihnachten: WEIHNACHTEN,
  hochzeit: HOCHZEIT,
  muttertag: MUTTERTAG,
};
