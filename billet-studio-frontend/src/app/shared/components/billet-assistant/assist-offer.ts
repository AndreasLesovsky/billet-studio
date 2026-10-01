import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { startDocument, startQuery } from '../../../billet/billet-start';
import { TEMPLATES } from '../../../billet/templates/templates';
import type { AssistBilletDto, ModelAssetDto } from '../../../core/models/models';
import { LanguageService } from '../../../core/services/language-service';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { THEMES } from '../../../core/theme/theme-registry.generated';
import { FALLBACK_EMOJI, occasionMeta } from '../../../core/utils/model-occasions';
import { AssetThumb } from '../asset-thumb/asset-thumb';
import { PresetCard } from '../preset-card/preset-card';
import { startParamsOf } from './assist-start';

/** One thing the offer starts with: a translated value, or a library name (data). */
interface Chip {
  readonly labelKey: string;
  readonly icon: string;
  readonly valueKey: string | null;
  readonly text: string | null;
}

const LANGUAGE_KEYS = { de: 'NAV.LANGUAGE_DE', en: 'NAV.LANGUAGE_EN' } as const;

/**
 * A billet the assistant offers: a picture of its look, what it starts with, and the link that
 * starts it (/billets/new with its start params). Everything shown comes from the document that
 * link would create, so the offer is what the editor then opens.
 */
@Component({
  selector: 'app-assist-offer',
  imports: [AssetThumb, PresetCard, RouterLink, TranslatePipe],
  templateUrl: './assist-offer.html',
  styleUrl: './assist-offer.scss',
})
export class AssistOffer {
  private readonly lang = inject(LanguageService).currentLang;
  private readonly siteMode = inject(ColorModeService).resolvedMode;

  readonly billet = input.required<AssistBilletDto>();
  /** The active library models; empty while the catalog loads or when it failed. */
  readonly library = input.required<readonly ModelAssetDto[]>();
  readonly libraryPending = input(false);

  private readonly params = computed(() => startParamsOf(this.billet()));
  protected readonly query = computed(() => startQuery(this.params()));
  private readonly document = computed(
    () => startDocument(this.params(), this.lang(), this.library()).document,
  );
  protected readonly mode = computed(() => {
    const colorMode = this.document().colorMode;
    return colorMode === 'auto' ? this.siteMode() : colorMode;
  });
  protected readonly themeId = computed(() => this.document().theme);

  private readonly asset = computed(() => {
    const scene = this.document().scene;
    return scene.enabled ? (this.library().find((a) => a.slug === scene.modelSlug) ?? null) : null;
  });
  protected readonly preview = computed(() => {
    const templateId = this.params().templateId;
    const asset = this.asset();
    return {
      src: asset?.previewUrl || null,
      emoji: asset
        ? (occasionMeta(asset.occasion)?.emoji ?? FALLBACK_EMOJI)
        : templateId
          ? TEMPLATES[templateId].emoji
          : FALLBACK_EMOJI,
      shown: this.document().scene.enabled,
    };
  });

  protected readonly title = computed(() => {
    const templateId = this.params().templateId;
    const theme = THEMES.find((meta) => meta.id === this.document().theme);
    return {
      templateKey: templateId ? TEMPLATES[templateId].nameKey : 'ASSIST.BLANK',
      themeKey: theme?.nameKey ?? '',
    };
  });

  protected readonly chips = computed<Chip[]>(() => {
    const { scene, particles, divider, colorMode, lang } = this.document();
    const asset = this.asset();
    const assetName = asset ? (this.lang() === 'en' ? asset.nameEn : asset.nameDe) : null;
    const chips = [
      scene.enabled
        ? chip('ASSIST.CHOICE.MODEL', 'bi-box', null, assetName)
        : chip('ASSIST.CHOICE.MODEL', 'bi-box', 'ASSIST.NO_MODEL'),
      chip(
        'ASSIST.CHOICE.PARTICLES',
        'bi-magic',
        particles.enabled
          ? `EDITOR.PARTICLES.SHAPES.${particles.shape.toUpperCase()}`
          : 'ASSIST.NO_PARTICLES',
      ),
      chip(
        'ASSIST.CHOICE.DIVIDER',
        'bi-dash-lg',
        `EDITOR.DIVIDER_STYLES.${divider.style.toUpperCase()}`,
      ),
      chip(
        'ASSIST.CHOICE.MODE',
        'bi-circle-half',
        `EDITOR.DESIGN.COLOR_MODES.${colorMode.toUpperCase()}`,
      ),
      chip('ASSIST.CHOICE.LANGUAGE', 'bi-translate', LANGUAGE_KEYS[lang]),
    ];
    return chips.filter((entry) => entry.valueKey !== null || entry.text);
  });
}

function chip(
  labelKey: string,
  icon: string,
  valueKey: string | null,
  text: string | null = null,
): Chip {
  return { labelKey, icon, valueKey, text };
}
