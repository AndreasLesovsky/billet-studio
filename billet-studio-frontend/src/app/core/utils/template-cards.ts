import { computed, inject, Signal } from '@angular/core';

import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from '../../billet/templates/templates';
import { billetPresetFor } from '../theme/billet-theme-presets.generated';
import { ColorModeService } from '../theme/color-mode-service';
import { THEMES, type ColorMode } from '../theme/theme-registry.generated';
import {
  type CatalogPreviews,
  injectCatalogPreviews,
  type ModelPreview,
  previewOf,
} from './model-previews';

/** A billet template as the template gallery and the home page show it. */
export interface TemplateCard {
  readonly id: TemplateId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly emoji: string;
  readonly themeNameKey: string;
  /** accent, accentSoft, background and ink of the theme's billet palette in the site's mode. */
  readonly swatches: readonly string[];
  /** The model's preview: shimmering while the catalog loads, the emoji where there is none. */
  readonly preview: ModelPreview;
}

// Keyed by TemplateId: a new template does not compile without its description.
const DESCRIPTION_KEYS: Readonly<Record<TemplateId, string>> = {
  muttertag: 'TEMPLATE_GALLERY.DESCRIPTION.MUTTERTAG',
  valentinstag: 'TEMPLATE_GALLERY.DESCRIPTION.VALENTINSTAG',
  geburtstag: 'TEMPLATE_GALLERY.DESCRIPTION.GEBURTSTAG',
  weihnachten: 'TEMPLATE_GALLERY.DESCRIPTION.WEIHNACHTEN',
  hochzeit: 'TEMPLATE_GALLERY.DESCRIPTION.HOCHZEIT',
};

const THEME_NAME_KEYS: ReadonlyMap<string, string> = new Map(
  THEMES.map((theme) => [theme.id, theme.nameKey]),
);

/** Every template in picker order, with its model's preview as far as the catalog is known. */
export function templateCards(catalog: CatalogPreviews, mode: ColorMode = 'light'): TemplateCard[] {
  return TEMPLATE_IDS.map((id) => {
    const { nameKey, emoji, themeId, modelSlug } = TEMPLATES[id];
    const { accent, accentSoft, background, ink } = billetPresetFor(themeId).palette[mode];
    return {
      id,
      nameKey,
      descriptionKey: DESCRIPTION_KEYS[id],
      emoji,
      themeNameKey: THEME_NAME_KEYS.get(themeId) ?? '',
      swatches: [accent, accentSoft, background, ink],
      preview: previewOf(catalog, modelSlug),
    };
  });
}

/** The template cards, their previews following the model catalog. Call in an injection context. */
export function injectTemplateCards(): Signal<TemplateCard[]> {
  const previews = injectCatalogPreviews();
  const colorMode = inject(ColorModeService);
  return computed(() => templateCards(previews(), colorMode.resolvedMode()));
}
