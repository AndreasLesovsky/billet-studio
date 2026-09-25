import { computed, inject, Signal } from '@angular/core';

import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from '../../billet/templates/templates';
import type { ModelAssetDto } from '../models/models';
import { AssetCatalogApi } from '../services/asset-catalog-api';
import { billetPresetFor } from '../theme/billet-theme-presets.generated';
import { ColorModeService } from '../theme/color-mode-service';
import { THEMES, type ColorMode } from '../theme/theme-registry.generated';

/** A billet template as the template gallery and the home page show it. */
export interface TemplateCard {
  readonly id: TemplateId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly emoji: string;
  readonly themeNameKey: string;
  /** accent, accentSoft, background and ink of the theme's billet palette in the site's mode. */
  readonly swatches: readonly string[];
  /** The model's preview; null while the catalog is unknown or has none for the model. */
  readonly previewUrl: string | null;
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

/** Every template in picker order, with the preview of its model once `models` holds it. */
export function templateCards(
  models: readonly ModelAssetDto[] | null,
  mode: ColorMode = 'light',
): TemplateCard[] {
  const previews = new Map(models?.map((model) => [model.slug, model.previewUrl]));
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
      previewUrl: previews.get(modelSlug) || null,
    };
  });
}

/**
 * The template cards, with previews once the model catalog has answered. The previews are
 * decoration: while the catalog loads, or when it cannot be reached, the cards show their emoji.
 * Call in an injection context.
 */
export function injectTemplateCards(): Signal<TemplateCard[]> {
  const catalog = inject(AssetCatalogApi);
  const colorMode = inject(ColorModeService);
  void catalog.list().catch(() => undefined);
  return computed(() => templateCards(catalog.models(), colorMode.resolvedMode()));
}
