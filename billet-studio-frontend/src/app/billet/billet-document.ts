import { billetPresetFor } from '../core/theme/billet-theme-presets.generated';
import { DEFAULT_THEME, isThemeId } from '../core/theme/theme-registry.generated';
import { blankContent } from './templates/blank';
import { TEMPLATES, type TemplateId } from './templates/templates';

// The billet document, mirroring docs/billet-document.md 1:1 (the backend records in
// app.billetstudio.billet.document mirror the same file). Changing the shape means a new
// schemaVersion, a step in migrate-document.ts and the backend records, in one commit.

export const CURRENT_SCHEMA_VERSION = 1;

export const DIVIDER_STYLES = ['diamond', 'dot', 'heart', 'star', 'line', 'none'] as const;
export const BLOCK_TYPES = ['paragraph', 'heading', 'card', 'note', 'divider'] as const;
export const PARTICLE_SHAPES = ['petal', 'snowflake', 'leaf', 'confetti', 'heart'] as const;
export const BILLET_LANGS = ['de', 'en'] as const;
export const COLOR_MODES = ['auto', 'light', 'dark'] as const;
export const EMPHASIS_COLORS = ['inkSoft', 'accent'] as const;
export const FONT_ROLES = ['title', 'titleAccent', 'heading', 'body', 'signature', 'ui'] as const;

/** `#rrggbb`; the frontend writes lowercase. */
export type HexColor = string;
/** Integer index into {@link BILLET_SPACE_SCALE}. */
export type SpaceStep = number;
export type DividerStyle = (typeof DIVIDER_STYLES)[number];
export type BlockType = (typeof BLOCK_TYPES)[number];
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];
export type BilletLang = (typeof BILLET_LANGS)[number];
export type FontRole = (typeof FONT_ROLES)[number];

export interface BilletPalette {
  accent: HexColor;
  accentSoft: HexColor;
  border: HexColor;
  background: HexColor;
  ink: HexColor;
  inkSoft: HexColor;
  surface: HexColor;
}

export interface FontRef {
  fontId: string;
  weight: number;
  italic: boolean;
  /** Multiplier of the role's base size. */
  size: number;
}

/** One shape for every block type: Signal Forms arrays need one element shape. */
export interface BilletBlock {
  id: string;
  type: BlockType;
  text: string;
  /** Card only, else ''. */
  icon: string;
  /** Card only, else ''. */
  ariaLabel: string;
  /** Divider only, else 'none'. */
  dividerStyle: DividerStyle;
  /** Added to spacing.blockGap, clamped to the scale. */
  spaceAdjust: number;
}

export interface BilletDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  /** Theme id (a billet design preset); the renderer never reads it (docs/billet-document.md). */
  theme: string;
  title: string;
  pageTitle: string;
  lang: BilletLang;
  colorMode: (typeof COLOR_MODES)[number];
  palette: {
    light: BilletPalette;
    dark: BilletPalette;
    /** The editor derives `dark` from `light` while true; both are stored either way. */
    darkLinked: boolean;
  };
  typography: Record<FontRole, FontRef> & { emphasis: (typeof EMPHASIS_COLORS)[number] };
  spacing: {
    /** Horizontal page padding. */
    gutter: SpaceStep;
    heroTop: SpaceStep;
    heroBottom: SpaceStep;
    /** Above and below the divider under the scene. */
    dividerGap: SpaceStep;
    /** Space before each block after the first. */
    blockGap: SpaceStep;
    signatureGap: SpaceStep;
    pageBottom: SpaceStep;
  };
  hero: {
    label: string;
    titleLine1: string;
    titleLine2: string;
    sub: string;
  };
  scene: {
    enabled: boolean;
    modelSlug: string;
    height: number;
    fitSize: number;
    yOffset: number;
    exposure: number;
    cameraDistance: number;
    cameraHeight: number;
    autoRotate: boolean;
    autoRotateSpeed: number;
    hint: string;
    ariaLabel: string;
  };
  divider: { style: DividerStyle };
  blocks: BilletBlock[];
  signature: {
    name: string;
    sub: string;
  };
  particles: {
    enabled: boolean;
    shape: ParticleShape;
    colors: HexColor[];
    /** 50 = the original Mother's Day amount. */
    density: number;
    speed: number;
    size: number;
  };
}

/** Spacing steps in rem, index = SpaceStep. */
export const BILLET_SPACE_SCALE = [
  0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8,
] as const;

/** A CSS length for a step on the scale; off-scale steps are clamped to its ends. */
export function spaceRem(step: SpaceStep): string {
  const last = BILLET_SPACE_SCALE.length - 1;
  const index = Number.isFinite(step) ? Math.min(last, Math.max(0, Math.round(step))) : 0;
  return `${BILLET_SPACE_SCALE[index]}rem`;
}

/** The original card's spacing (docs/billet-document.md, "Spacing check against the original"). */
const DEFAULT_SPACING: BilletDocument['spacing'] = {
  gutter: 8,
  heroTop: 14,
  heroBottom: 13,
  dividerGap: 9,
  blockGap: 10,
  signatureGap: 11,
  pageBottom: 15,
};

/** A block id no other document id repeats in practice: 48 random bits, `[a-z0-9-]`. */
function createBlockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `b-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

type BlockInit = Partial<
  Pick<BilletBlock, 'text' | 'icon' | 'ariaLabel' | 'dividerStyle' | 'spaceAdjust'>
>;

export function createBlock(type: BlockType, init: BlockInit = {}): BilletBlock {
  return {
    id: createBlockId(),
    type,
    text: '',
    icon: type === 'card' ? '🌸' : '',
    ariaLabel: '',
    dividerStyle: type === 'divider' ? 'dot' : 'none',
    spaceAdjust: 0,
    ...init,
  };
}

/** Copies of a theme's preset: presets are shared, and a document is edited in place. */
function presetParts(themeId: string) {
  const theme = isThemeId(themeId) ? themeId : DEFAULT_THEME;
  const { palette, typography: t, particleColors } = billetPresetFor(theme);
  return {
    theme,
    palette: { light: { ...palette.light }, dark: { ...palette.dark }, darkLinked: false },
    typography: {
      title: { ...t.title },
      titleAccent: { ...t.titleAccent },
      heading: { ...t.heading },
      body: { ...t.body },
      signature: { ...t.signature },
      ui: { ...t.ui },
      emphasis: t.emphasis,
    },
    particleColors: [...particleColors],
  };
}

/**
 * Picking a theme: (re)initialises palette, typography and particle colours from its
 * preset and records the theme. Unknown ids fall back to the default theme.
 */
export function applyThemePreset(document: BilletDocument, themeId: string): BilletDocument {
  const { theme, palette, typography, particleColors } = presetParts(themeId);
  return {
    ...document,
    theme,
    palette,
    typography,
    particles: { ...document.particles, colors: particleColors },
  };
}

export interface NewDocumentOptions {
  lang: BilletLang;
  /** Default: the template's theme, else the default theme. Unknown ids fall back to the default. */
  themeId?: string;
  /** Without one the document is blank: no text, the original layout, the bouquet scene. */
  templateId?: TemplateId;
}

/** A complete, fresh document. Never frozen: Signal Forms mark the objects they edit. */
export function createDocument({ lang, themeId, templateId }: NewDocumentOptions): BilletDocument {
  const template = templateId ? TEMPLATES[templateId] : null;
  const content = template ? template.content(lang) : blankContent(lang);
  const { theme, palette, typography, particleColors } = presetParts(
    themeId ?? template?.themeId ?? DEFAULT_THEME,
  );
  const { enabled, shape, density, speed, size } = content.particles;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme,
    title: content.title,
    pageTitle: content.pageTitle,
    lang,
    colorMode: 'auto',
    palette,
    typography,
    spacing: { ...DEFAULT_SPACING },
    hero: content.hero,
    scene: content.scene,
    divider: content.divider,
    blocks: content.blocks.map(({ type, ...init }) => createBlock(type, init)),
    signature: content.signature,
    particles: { enabled, shape, colors: particleColors, density, speed, size },
  };
}
