import { DEFAULT_THEME, isThemeId } from '../core/theme/theme-registry.generated';
import {
  BILLET_LANGS,
  BLOCK_TYPES,
  COLOR_MODES,
  CURRENT_SCHEMA_VERSION,
  DIVIDER_STYLES,
  EMPHASIS_COLORS,
  PARTICLE_SHAPES,
  createBlock,
  createDocument,
  type BilletBlock,
  type BilletDocument,
  type BilletPalette,
  type FontRef,
  type FontRole,
} from './billet-document';
import {
  BLOCK_TEXT_LIMITS,
  HEX_COLOR_PATTERN,
  ID_PATTERN,
  MAX_BLOCKS,
  MODEL_SLUG_PATTERN,
  NUMBER_LIMITS,
  PARTICLE_COLOR_COUNT,
  TEXT_LIMITS,
  type NumberLimit,
} from './billet-limits';
import { FONT_BY_ID, type FontCatalogEntry } from './fonts/font-catalog.generated';
import { sanitizeText, truncateGraphemes } from './text/text-sanitize';

type Json = Record<string, unknown>;

const FONTS: ReadonlyMap<string, FontCatalogEntry> = FONT_BY_ID;

/**
 * Every document entering the frontend (localStorage, API, import, template) passes here first.
 * Returns the current schema version, complete and within every limit: a missing or invalid field
 * gets the value a new document of the same theme and language would have, numbers are clamped
 * and snapped to their step, text is cleaned and shortened, unknown keys are dropped. Returns null
 * for anything that is not a billet document of a known version.
 */
export function migrateDocument(input: unknown): BilletDocument | null {
  if (!isJson(input)) return null;
  // A future version adds its step here (v1 -> v2 -> ...) before the repair of the current shape.
  if (input['schemaVersion'] !== CURRENT_SCHEMA_VERSION) return null;
  return repair(input);
}

function repair(input: Json): BilletDocument {
  const themeId = input['theme'];
  const theme = isThemeId(themeId) ? themeId : DEFAULT_THEME;
  const lang = oneOf(input['lang'], BILLET_LANGS, 'de');
  const base = createDocument({ lang, themeId: theme });
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme,
    title: requiredText(input['title'], base.title, TEXT_LIMITS.title),
    pageTitle: text(input['pageTitle'], base.pageTitle, TEXT_LIMITS.pageTitle),
    lang,
    colorMode: oneOf(input['colorMode'], COLOR_MODES, base.colorMode),
    palette: palettes(json(input['palette']), base.palette),
    typography: typography(json(input['typography']), base.typography),
    spacing: spacing(json(input['spacing']), base.spacing),
    hero: hero(json(input['hero']), base.hero),
    scene: scene(json(input['scene']), base.scene),
    divider: { style: oneOf(json(input['divider'])['style'], DIVIDER_STYLES, base.divider.style) },
    blocks: blocks(input['blocks']),
    signature: signature(json(input['signature']), base.signature),
    particles: particles(json(input['particles']), base.particles),
  };
}

function palettes(input: Json, base: BilletDocument['palette']): BilletDocument['palette'] {
  return {
    light: palette(json(input['light']), base.light),
    dark: palette(json(input['dark']), base.dark),
    darkLinked: bool(input['darkLinked'], base.darkLinked),
  };
}

function palette(input: Json, base: BilletPalette): BilletPalette {
  const color = (key: keyof BilletPalette) => hex(input[key]) ?? base[key];
  return {
    accent: color('accent'),
    accentSoft: color('accentSoft'),
    border: color('border'),
    background: color('background'),
    ink: color('ink'),
    inkSoft: color('inkSoft'),
    surface: color('surface'),
  };
}

function typography(input: Json, base: BilletDocument['typography']): BilletDocument['typography'] {
  const font = (role: FontRole) => fontRef(json(input[role]), base[role]);
  return {
    title: font('title'),
    titleAccent: font('titleAccent'),
    heading: font('heading'),
    body: font('body'),
    signature: font('signature'),
    ui: font('ui'),
    emphasis: oneOf(input['emphasis'], EMPHASIS_COLORS, base.emphasis),
  };
}

/** A font the catalog does not ship takes the role's default face; its size is kept. */
function fontRef(input: Json, base: FontRef): FontRef {
  const fontId = input['fontId'];
  const known = typeof fontId === 'string' && FONTS.has(fontId);
  return {
    fontId: known ? fontId : base.fontId,
    weight: known ? num(input['weight'], base.weight, NUMBER_LIMITS.fontWeight) : base.weight,
    italic: known ? bool(input['italic'], base.italic) : base.italic,
    size: num(input['size'], base.size, NUMBER_LIMITS.fontSize),
  };
}

function spacing(input: Json, base: BilletDocument['spacing']): BilletDocument['spacing'] {
  const step = (key: keyof BilletDocument['spacing']) =>
    num(input[key], base[key], NUMBER_LIMITS.spaceStep);
  return {
    gutter: step('gutter'),
    heroTop: step('heroTop'),
    heroBottom: step('heroBottom'),
    dividerGap: step('dividerGap'),
    blockGap: step('blockGap'),
    signatureGap: step('signatureGap'),
    pageBottom: step('pageBottom'),
  };
}

function hero(input: Json, base: BilletDocument['hero']): BilletDocument['hero'] {
  return {
    label: text(input['label'], base.label, TEXT_LIMITS.heroLabel),
    titleLine1: text(input['titleLine1'], base.titleLine1, TEXT_LIMITS.heroTitleLine),
    titleLine2: text(input['titleLine2'], base.titleLine2, TEXT_LIMITS.heroTitleLine),
    sub: text(input['sub'], base.sub, TEXT_LIMITS.heroSub),
  };
}

function scene(input: Json, base: BilletDocument['scene']): BilletDocument['scene'] {
  const slug = input['modelSlug'];
  const n = NUMBER_LIMITS;
  return {
    enabled: bool(input['enabled'], base.enabled),
    modelSlug: typeof slug === 'string' && MODEL_SLUG_PATTERN.test(slug) ? slug : base.modelSlug,
    height: num(input['height'], base.height, n.sceneHeight),
    fitSize: num(input['fitSize'], base.fitSize, n.fitSize),
    yOffset: num(input['yOffset'], base.yOffset, n.yOffset),
    exposure: num(input['exposure'], base.exposure, n.exposure),
    cameraDistance: num(input['cameraDistance'], base.cameraDistance, n.cameraDistance),
    cameraHeight: num(input['cameraHeight'], base.cameraHeight, n.cameraHeight),
    autoRotate: bool(input['autoRotate'], base.autoRotate),
    autoRotateSpeed: num(input['autoRotateSpeed'], base.autoRotateSpeed, n.autoRotateSpeed),
    hint: text(input['hint'], base.hint, TEXT_LIMITS.sceneHint),
    ariaLabel: text(input['ariaLabel'], base.ariaLabel, TEXT_LIMITS.sceneAriaLabel),
  };
}

/** Blocks of an unknown type are dropped; an invalid or repeated id is replaced. */
function blocks(input: unknown): BilletBlock[] {
  const seen = new Set<string>();
  const result: BilletBlock[] = [];
  for (const item of Array.isArray(input) ? input : []) {
    const repaired = isJson(item) ? block(item, seen) : null;
    if (repaired && result.length < MAX_BLOCKS) result.push(repaired);
  }
  return result;
}

function block(input: Json, seen: Set<string>): BilletBlock | null {
  const type = input['type'];
  if (!isOneOf(type, BLOCK_TYPES)) return null;
  const base = createBlock(type);
  const id = input['id'];
  const keepId = typeof id === 'string' && ID_PATTERN.test(id) && !seen.has(id);
  const repaired: BilletBlock = {
    id: keepId ? id : base.id,
    type,
    text: text(input['text'], base.text, BLOCK_TEXT_LIMITS[type]),
    icon: type === 'card' ? text(input['icon'], base.icon, TEXT_LIMITS.cardIcon) : '',
    ariaLabel: type === 'card' ? text(input['ariaLabel'], '', TEXT_LIMITS.cardAriaLabel) : '',
    dividerStyle:
      type === 'divider' ? oneOf(input['dividerStyle'], DIVIDER_STYLES, base.dividerStyle) : 'none',
    spaceAdjust: num(input['spaceAdjust'], base.spaceAdjust, NUMBER_LIMITS.spaceAdjust),
  };
  seen.add(repaired.id);
  return repaired;
}

function signature(input: Json, base: BilletDocument['signature']): BilletDocument['signature'] {
  return {
    name: text(input['name'], base.name, TEXT_LIMITS.signatureName),
    sub: text(input['sub'], base.sub, TEXT_LIMITS.signatureSub),
  };
}

function particles(input: Json, base: BilletDocument['particles']): BilletDocument['particles'] {
  const colors = (Array.isArray(input['colors']) ? input['colors'] : [])
    .map(hex)
    .filter((color): color is string => color !== null)
    .slice(0, PARTICLE_COLOR_COUNT.max);
  return {
    enabled: bool(input['enabled'], base.enabled),
    shape: oneOf(input['shape'], PARTICLE_SHAPES, base.shape),
    colors: colors.length >= PARTICLE_COLOR_COUNT.min ? colors : base.colors,
    density: num(input['density'], base.density, NUMBER_LIMITS.particleDensity),
    speed: num(input['speed'], base.speed, NUMBER_LIMITS.particleSpeed),
    size: num(input['size'], base.size, NUMBER_LIMITS.particleSize),
  };
}

// --- field readers ------------------------------------------------------------------------------

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A missing or malformed sub-object reads as empty, so each of its fields takes the default. */
const json = (value: unknown): Json => (isJson(value) ? value : {});

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return (options as readonly unknown[]).includes(value);
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  isOneOf(value, options) ? value : fallback;

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' ? truncateGraphemes(sanitizeText(value), max) : fallback;
}

function requiredText(value: unknown, fallback: string, max: number): string {
  const repaired = text(value, fallback, max);
  return repaired.trim() ? repaired : fallback;
}

const hex = (value: unknown): string | null =>
  typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;

/** Clamped and snapped to the step, without floating-point residue (1.6, not 1.6000000000000001). */
function num(value: unknown, fallback: number, { min, max, step }: NumberLimit): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const decimals = String(step).split('.')[1]?.length ?? 0;
  const snapped = Math.round(Math.min(max, Math.max(min, value)) / step) * step;
  return Number(snapped.toFixed(decimals));
}
