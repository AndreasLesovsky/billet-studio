import {
  applyThemePreset,
  FONT_ROLES,
  type BilletDocument,
  type BilletPalette,
  type FontRef,
  type FontRole,
  type HexColor,
} from '../../../../billet/billet-document';
import { FONT_BY_ID, type FontCatalogEntry } from '../../../../billet/fonts/font-catalog.generated';
import { deriveDarkPalette } from '../../../../billet/palette';

// The design panel's edits that touch more than one field. Each returns a new value and keeps every
// object it does not change (see EditorHistory); the panel writes them through the form or as one
// EditorCommands.commit step.

type Palettes = BilletDocument['palette'];
type Typography = BilletDocument['typography'];
export type PaletteRole = keyof BilletPalette;

/** The palette roles in the order the panel lists them. */
export const PALETTE_ROLES = [
  'accent',
  'accentSoft',
  'border',
  'background',
  'ink',
  'inkSoft',
  'surface',
] as const satisfies readonly PaletteRole[];

const FONTS: ReadonlyMap<string, FontCatalogEntry> = FONT_BY_ID;

/** A light colour changed: while the dark palette is linked, it is derived again from the new one. */
export function withLightColor(palette: Palettes, role: PaletteRole, hex: HexColor): Palettes {
  const light = { ...palette.light, [role]: hex };
  return { ...palette, light, dark: palette.darkLinked ? deriveDarkPalette(light) : palette.dark };
}

/** Linking derives the dark palette at once; unlinking keeps the derived colours to edit by hand. */
export function withDarkLinked(palette: Palettes, darkLinked: boolean): Palettes {
  return {
    ...palette,
    darkLinked,
    dark: darkLinked ? deriveDarkPalette(palette.light) : palette.dark,
  };
}

/** The weights a role offers: the family's shipped ones, plus the current one when it is not. */
export function weightsFor(ref: FontRef): number[] {
  const shipped = FONTS.get(ref.fontId)?.weights ?? [];
  return [...new Set([...shipped, ref.weight])].sort((a, b) => a - b);
}

export function italicAvailable(fontId: string, weight: number): boolean {
  return FONTS.get(fontId)?.italicWeights.includes(weight) ?? false;
}

function nearestWeight(weights: readonly number[], target: number): number {
  return weights.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

/**
 * Another family for a role: never a weight it does not ship (the browser would synthesise one),
 * so the nearest shipped weight, and italic only where the family has it at that weight.
 */
export function withRoleFont(typography: Typography, role: FontRole, fontId: string): Typography {
  const current = typography[role];
  if (current.fontId === fontId) return typography;
  const shipped = FONTS.get(fontId)?.weights ?? [];
  const weight = shipped.length > 0 ? nearestWeight(shipped, current.weight) : current.weight;
  const italic = current.italic && italicAvailable(fontId, weight);
  return { ...typography, [role]: { ...current, fontId, weight, italic } };
}

/** Another weight for a role; italic goes where the family has none at that weight. */
export function withRoleWeight(typography: Typography, role: FontRole, weight: number): Typography {
  const current = typography[role];
  if (current.weight === weight) return typography;
  const italic = current.italic && italicAvailable(current.fontId, weight);
  return { ...typography, [role]: { ...current, weight, italic } };
}

const sameFont = (a: FontRef, b: FontRef) =>
  a.fontId === b.fontId && a.weight === b.weight && a.italic === b.italic && a.size === b.size;

export function sameTypography(a: Typography, b: Typography): boolean {
  return a.emphasis === b.emphasis && FONT_ROLES.every((role) => sameFont(a[role], b[role]));
}

const samePalette = (a: BilletPalette, b: BilletPalette) =>
  PALETTE_ROLES.every((role) => a[role] === b[role]);

/** True while the billet still has its theme's colours, fonts and particle colours. */
export function matchesThemePreset(document: BilletDocument): boolean {
  const preset = applyThemePreset(document, document.theme);
  const colors = document.particles.colors;
  const presetColors = preset.particles.colors;
  return (
    document.palette.darkLinked === preset.palette.darkLinked &&
    samePalette(document.palette.light, preset.palette.light) &&
    samePalette(document.palette.dark, preset.palette.dark) &&
    sameTypography(document.typography, preset.typography) &&
    colors.length === presetColors.length &&
    colors.every((color, i) => color === presetColors[i])
  );
}

/** Another theme's fonts; the billet keeps its colours. */
export function withTypographyOf(document: BilletDocument, themeId: string): BilletDocument {
  return { ...document, typography: applyThemePreset(document, themeId).typography };
}
