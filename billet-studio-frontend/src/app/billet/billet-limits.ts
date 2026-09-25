import type { BlockType } from './billet-document';

// The frontend's one copy of the document limits. The backend records in
// app.billetstudio.billet.document (+ BilletDocumentRulesValidator) are the source of truth: a
// change there is mirrored here in the same commit.

/**
 * Maximum text lengths in UTF-16 code units - `String.length`, which is what the backend's @Size
 * and an input's `maxlength` count. Shorten text with truncateGraphemes, never with slice.
 */
export const TEXT_LIMITS = {
  title: 120,
  pageTitle: 120,
  heroLabel: 80,
  heroTitleLine: 60,
  heroSub: 120,
  sceneHint: 120,
  sceneAriaLabel: 160,
  signatureName: 60,
  signatureSub: 120,
  cardIcon: 16,
  cardAriaLabel: 120,
} as const;

/** The title is the only text that must not be empty. */
export const TITLE_MIN_LENGTH = 1;

/** A divider carries no text; icon and ariaLabel belong to cards, dividerStyle to dividers. */
export const BLOCK_TEXT_LIMITS: Readonly<Record<BlockType, number>> = {
  paragraph: 2000,
  heading: 160,
  card: 1200,
  note: 600,
  divider: 0,
};

export const MAX_BLOCKS = 30;

export const PARTICLE_COLOR_COUNT = { min: 1, max: 8 } as const;

export interface NumberLimit {
  readonly min: number;
  readonly max: number;
  /**
   * The slider step. The backend requires a multiple of it for the scene height (0.25), font
   * weights (100) and the integers; the other steps are the editor's resolution only.
   */
  readonly step: number;
}

export const NUMBER_LIMITS = {
  sceneHeight: { min: 15, max: 40, step: 0.25 },
  fitSize: { min: 0.5, max: 3, step: 0.01 },
  yOffset: { min: -1, max: 1, step: 0.01 },
  exposure: { min: 0.2, max: 2, step: 0.01 },
  cameraDistance: { min: 1.5, max: 6, step: 0.01 },
  cameraHeight: { min: -1, max: 2, step: 0.01 },
  autoRotateSpeed: { min: 0, max: 3, step: 0.01 },
  fontWeight: { min: 100, max: 900, step: 100 },
  fontSize: { min: 0.5, max: 2, step: 0.01 },
  spaceStep: { min: 0, max: 18, step: 1 },
  spaceAdjust: { min: -6, max: 6, step: 1 },
  particleDensity: { min: 0, max: 100, step: 1 },
  particleSpeed: { min: 0.25, max: 3, step: 0.01 },
  particleSize: { min: 0.5, max: 2, step: 0.01 },
} as const satisfies Record<string, NumberLimit>;

/** theme, typography fontIds and block ids. */
export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const MODEL_SLUG_PATTERN = /^[a-z0-9-]{1,60}$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
