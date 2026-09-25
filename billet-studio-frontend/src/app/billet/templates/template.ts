import type { ModelDefaultsDto } from '../../core/models/models';
import type { ThemeId } from '../../core/theme/theme-registry.generated';
import type {
  BilletBlock,
  BilletDocument,
  BilletLang,
  DividerStyle,
  ParticleShape,
} from '../billet-document';

// Type-only imports from billet-document.ts: createDocument imports the templates at runtime.

type BlockSeed = Pick<BilletBlock, 'type'> & Partial<Omit<BilletBlock, 'id' | 'type'>>;

/** What a template decides. createDocument adds the theme preset, the spacing and block ids. */
export interface TemplateContent {
  title: string;
  pageTitle: string;
  hero: BilletDocument['hero'];
  scene: BilletDocument['scene'];
  divider: BilletDocument['divider'];
  blocks: BlockSeed[];
  signature: BilletDocument['signature'];
  particles: Omit<BilletDocument['particles'], 'colors'>;
}

export interface BilletTemplate {
  /** i18n key TEMPLATES.<ID>. */
  readonly nameKey: string;
  readonly themeId: ThemeId;
  readonly modelSlug: SceneModelSlug;
  /** Shown on the template picker card. */
  readonly emoji: string;
  /** Fresh objects on every call: a document is edited in place. */
  readonly content: (lang: BilletLang) => TemplateContent;
}

/** Scene defaults of the models the templates use, as seeded (sql/seed_models.sql). */
const SEED_DEFAULTS = {
  'flower-bouquet': {
    fitSize: 1.6,
    yOffset: -0.08,
    exposure: 0.6,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.45,
  },
  'heart-emoji': {
    fitSize: 1.5,
    yOffset: -0.05,
    exposure: 0.65,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.55,
  },
  'birthday-cake': {
    fitSize: 2,
    yOffset: -0.08,
    exposure: 0.85,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.45,
  },
  'snow-globe': {
    fitSize: 1.45,
    yOffset: 0,
    exposure: 0.6,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.45,
  },
  'champagne-bottle': {
    fitSize: 1.6,
    yOffset: -0.08,
    exposure: 0.6,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.45,
  },
} satisfies Record<string, ModelDefaultsDto>;

type SceneModelSlug = keyof typeof SEED_DEFAULTS;

const SCENE_ARIA_LABEL: Record<SceneModelSlug, Record<BilletLang, string>> = {
  'flower-bouquet': {
    de: '3D Blumenstrauß, interaktiv drehbar',
    en: '3D flower bouquet, drag to rotate',
  },
  'heart-emoji': { de: '3D Herz, interaktiv drehbar', en: '3D heart, drag to rotate' },
  'birthday-cake': {
    de: '3D Geburtstagstorte, interaktiv drehbar',
    en: '3D birthday cake, drag to rotate',
  },
  'snow-globe': { de: '3D Schneekugel, interaktiv drehbar', en: '3D snow globe, drag to rotate' },
  'champagne-bottle': {
    de: '3D Champagnerflasche, interaktiv drehbar',
    en: '3D champagne bottle, drag to rotate',
  },
};

const SCENE_HINT: Record<BilletLang, string> = {
  de: 'wischen zum drehen · pinch zum zoomen',
  en: 'swipe to rotate · pinch to zoom',
};

/** The original card's scene (height 23.75rem, auto-rotating) around one of the seeded models. */
export function templateScene(slug: SceneModelSlug, lang: BilletLang): BilletDocument['scene'] {
  const defaults = SEED_DEFAULTS[slug];
  return {
    enabled: true,
    modelSlug: slug,
    height: 23.75,
    fitSize: defaults.fitSize,
    yOffset: defaults.yOffset,
    exposure: defaults.exposure,
    cameraDistance: defaults.cameraDistance,
    cameraHeight: defaults.cameraHeight,
    autoRotate: true,
    autoRotateSpeed: defaults.autoRotateSpeed,
    hint: SCENE_HINT[lang],
    ariaLabel: SCENE_ARIA_LABEL[slug][lang],
  };
}

/** The original card's particle amount and motion, in the given shape. */
export function templateParticles(shape: ParticleShape): TemplateContent['particles'] {
  return { enabled: true, shape, density: 50, speed: 1, size: 1 };
}

/** The words of a template in one language. */
interface TemplateTexts {
  title: string;
  pageTitle: string;
  hero: BilletDocument['hero'];
  blocks: BlockSeed[];
  signature: BilletDocument['signature'];
}

interface TemplateDesign extends Omit<BilletTemplate, 'content'> {
  readonly divider: DividerStyle;
  readonly particles: ParticleShape;
  readonly texts: Record<BilletLang, TemplateTexts>;
}

export function defineTemplate({
  texts,
  divider,
  particles,
  ...meta
}: TemplateDesign): BilletTemplate {
  return {
    ...meta,
    content: (lang) => ({
      ...structuredClone(texts[lang]),
      scene: templateScene(meta.modelSlug, lang),
      divider: { style: divider },
      particles: templateParticles(particles),
    }),
  };
}
