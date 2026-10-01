import type { ModelAssetDto } from '../core/models/models';
import { isThemeId, type ThemeId } from '../core/theme/theme-registry.generated';
import { withAsset } from './asset-defaults';
import {
  BILLET_LANGS,
  COLOR_MODES,
  createDocument,
  DIVIDER_STYLES,
  PARTICLE_SHAPES,
  type BilletDocument,
  type BilletLang,
  type DividerStyle,
  type ParticleShape,
} from './billet-document';
import { sceneAriaLabel } from './templates/template';
import { TEMPLATE_IDS, type TemplateId } from './templates/templates';

/** The value that switches the scene or the particles off in a start link. */
export const START_NONE = 'none';

/**
 * What /billets/new?template=…&theme=…&model=…&particles=…&divider=…&colorMode=…&lang=… starts
 * from. Null keeps the template's own choice (for `lang`: the interface language). A value the
 * whitelist does not know reads as null, so a stale or hand-edited link still opens a billet.
 */
export interface StartParams {
  readonly templateId: TemplateId | null;
  readonly themeId: ThemeId | null;
  /** A library slug, or START_NONE for no scene. */
  readonly model: string | null;
  readonly particles: ParticleShape | typeof START_NONE | null;
  readonly divider: DividerStyle | null;
  readonly colorMode: BilletDocument['colorMode'] | null;
  readonly lang: BilletLang | null;
}

type StartParamName =
  'template' | 'theme' | 'model' | 'particles' | 'divider' | 'colorMode' | 'lang';

/** The query-param side of StartParams; ParamMap fits it. */
interface StartQuery {
  get(name: StartParamName): string | null;
}

const MODEL_SLUG = /^[a-z0-9-]{1,60}$/;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((known) => known === value) ?? null;
}

export function parseStartParams(query: StartQuery): StartParams {
  const theme = query.get('theme');
  const model = query.get('model');
  return {
    templateId: oneOf(TEMPLATE_IDS, query.get('template')),
    themeId: theme !== null && isThemeId(theme) ? theme : null,
    model: model !== null && MODEL_SLUG.test(model) ? model : null,
    particles: oneOf([...PARTICLE_SHAPES, START_NONE], query.get('particles')),
    divider: oneOf(DIVIDER_STYLES, query.get('divider')),
    colorMode: oneOf(COLOR_MODES, query.get('colorMode')),
    lang: oneOf(BILLET_LANGS, query.get('lang')),
  };
}

/** The query params of a start link: the inverse of parseStartParams, without the nulls. */
export function startQuery(params: StartParams): Partial<Record<StartParamName, string>> {
  const values: Record<StartParamName, string | null> = {
    template: params.templateId,
    theme: params.themeId,
    model: params.model,
    particles: params.particles,
    divider: params.divider,
    colorMode: params.colorMode,
    lang: params.lang,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
}

/** Whether building the start document needs the model library. */
export function needsLibrary(params: StartParams): boolean {
  return params.model !== null && params.model !== START_NONE;
}

/**
 * The document /billets/new starts with. The theme goes into createDocument (it also colours the
 * particles); a model must be an active one from `library`, else the template keeps its own.
 */
export function startDocument(
  params: StartParams,
  uiLang: BilletLang,
  library: readonly ModelAssetDto[] = [],
): { document: BilletDocument; templateId: TemplateId | null } {
  const { templateId, themeId, model, particles, divider, colorMode } = params;
  const lang = params.lang ?? uiLang;
  let document = createDocument({
    lang,
    templateId: templateId ?? undefined,
    themeId: themeId ?? undefined,
  });

  if (model === START_NONE) {
    document = { ...document, scene: { ...document.scene, enabled: false } };
  } else {
    const asset = library.find((entry) => entry.slug === model && entry.active);
    if (asset && asset.slug !== document.scene.modelSlug) {
      const next = withAsset(document, asset);
      document = { ...next, scene: { ...next.scene, ariaLabel: sceneAriaLabel(asset, lang) } };
    }
  }
  if (particles === START_NONE) {
    document = { ...document, particles: { ...document.particles, enabled: false } };
  } else if (particles !== null) {
    document = {
      ...document,
      particles: { ...document.particles, enabled: true, shape: particles },
    };
  }
  if (divider !== null) document = { ...document, divider: { style: divider } };
  if (colorMode !== null) document = { ...document, colorMode };
  return { document, templateId };
}
