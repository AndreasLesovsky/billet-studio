import { billetPresetFor } from '../core/theme/billet-theme-presets.generated';
import { DEFAULT_THEME } from '../core/theme/theme-registry.generated';
import { FONT_ROLES, type BilletDocument, type FontRef, type FontRole } from './billet-document';
import { FONT_BY_ID, type FontCatalogEntry } from './fonts/font-catalog.generated';

const FONTS: ReadonlyMap<string, FontCatalogEntry> = FONT_BY_ID;

const ROLE_SLUG = {
  title: 'title',
  titleAccent: 'title-accent',
  heading: 'heading',
  body: 'body',
  signature: 'signature',
  ui: 'ui',
} as const satisfies Record<FontRole, string>;

type RoleSlug = (typeof ROLE_SLUG)[FontRole];

export type BilletTypographyVar =
  `--billet-${'font' | 'weight' | 'style' | 'size'}-${RoleSlug}` | '--billet-emphasis';

/**
 * The font-family stack of a role. A font the catalog does not ship falls back to the default
 * theme's font for that role (the generator checks every preset font against the catalog).
 */
export function fontStack(ref: FontRef, role: FontRole): string {
  const roleDefault = billetPresetFor(DEFAULT_THEME).typography[role].fontId;
  return (FONTS.get(ref.fontId) ?? FONTS.get(roleDefault))?.fallback ?? 'serif';
}

/**
 * The typography as the billet root's custom properties, per role: font stack, weight, style and
 * the size multiplier (unitless - the view multiplies each role's base size by it). Emphasis names
 * the palette variable its colour comes from.
 */
export function roleCss(
  typography: BilletDocument['typography'],
): Record<BilletTypographyVar, string> {
  const vars: Partial<Record<BilletTypographyVar, string>> = {};
  for (const role of FONT_ROLES) {
    const ref = typography[role];
    const slug = ROLE_SLUG[role];
    vars[`--billet-font-${slug}`] = fontStack(ref, role);
    vars[`--billet-weight-${slug}`] = String(ref.weight);
    vars[`--billet-style-${slug}`] = ref.italic ? 'italic' : 'normal';
    vars[`--billet-size-${slug}`] = String(ref.size);
  }
  vars['--billet-emphasis'] =
    typography.emphasis === 'accent' ? 'var(--billet-accent)' : 'var(--billet-ink-soft)';
  return vars as Record<BilletTypographyVar, string>;
}
