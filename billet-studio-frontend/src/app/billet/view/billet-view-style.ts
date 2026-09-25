import {
  spaceRem,
  type BilletBlock,
  type BilletDocument,
  type SpaceStep,
} from '../billet-document';
import { paletteToCssVars } from '../palette';
import { roleCss } from '../typography';

export type BilletViewMode = BilletDocument['colorMode'];
export type BilletMode = 'light' | 'dark';

export function resolveBilletMode(mode: BilletViewMode, systemDark: boolean): BilletMode {
  if (mode === 'auto') return systemDark ? 'dark' : 'light';
  return mode;
}

/**
 * The billet root's inline style: its colour-scheme and every --billet-* property the renderer
 * styles read - the palette of the resolved mode, the typography roles and the spacing steps.
 */
export function billetRootStyle(
  document: BilletDocument,
  mode: BilletMode,
): Record<string, string> {
  const { spacing } = document;
  return {
    'color-scheme': mode,
    ...paletteToCssVars(document.palette[mode]),
    ...roleCss(document.typography),
    '--billet-space-gutter': spaceRem(spacing.gutter),
    '--billet-space-hero-top': spaceRem(spacing.heroTop),
    '--billet-space-hero-bottom': spaceRem(spacing.heroBottom),
    '--billet-space-divider': spaceRem(spacing.dividerGap),
    '--billet-space-signature': spaceRem(spacing.signatureGap),
    '--billet-space-page-bottom': spaceRem(spacing.pageBottom),
  };
}

/**
 * The space above each block: blockGap plus the block's own adjustment. The first block sits
 * right under the divider's gap, so only its adjustment counts (never below zero).
 */
export function blockSpaces(
  blocks: readonly Pick<BilletBlock, 'spaceAdjust'>[],
  blockGap: SpaceStep,
): string[] {
  return blocks.map((block, index) => spaceRem((index === 0 ? 0 : blockGap) + block.spaceAdjust));
}
