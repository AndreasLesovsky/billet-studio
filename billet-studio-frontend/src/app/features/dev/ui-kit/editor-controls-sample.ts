import { JsonPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { apply, disabled, form, FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { BILLET_SPACE_SCALE } from '../../../billet/billet-document';
import { NUMBER_LIMITS } from '../../../billet/billet-limits';
import type { ModelAssetDto } from '../../../core/models/models';
import { LanguageService } from '../../../core/services/language-service';
import { billetPresetFor } from '../../../core/theme/billet-theme-presets.generated';
import { DEFAULT_THEME } from '../../../core/theme/theme-registry.generated';
import { AssetPicker } from '../../../shared/components/asset-picker/asset-picker';
import { ColorPicker } from '../../../shared/components/color-picker/color-picker';
import { EmojiPicker } from '../../../shared/components/emoji-picker/emoji-picker';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { FontPicker } from '../../../shared/components/font-picker/font-picker';
import { RangeSlider } from '../../../shared/components/range-slider/range-slider';
import {
  ControlsSampleModel,
  controlsSampleSchema,
  SAMPLE_CONTROLS_MODEL,
} from './editor-controls-sample-schema';

const REM_PX = 16;

/** public/models as the asset pipeline writes them; a static stand-in for the /v1/models catalog. */
function sampleAsset(
  slug: string,
  nameDe: string,
  nameEn: string,
  occasion: string,
  credit: string,
): ModelAssetDto {
  return {
    slug,
    nameDe,
    nameEn,
    occasion,
    fileUrl: `models/${slug}.v1.glb`,
    previewUrl: `models/previews/${slug}.v1.webp`,
    fileSizeBytes: 0,
    credit,
    active: true,
    defaults: {
      fitSize: 1.6,
      yOffset: -0.08,
      exposure: 0.6,
      cameraDistance: 2.8,
      cameraHeight: 0.1,
      autoRotateSpeed: 0.45,
    },
  };
}

const SAMPLE_ASSETS: readonly ModelAssetDto[] = [
  sampleAsset(
    'flower-bouquet',
    'Blumenstrauß',
    'Flower bouquet',
    'mothers_day',
    'Flower Bouquet by icecool (CC-BY-4.0)',
  ),
  sampleAsset('heart-emoji', 'Herz', 'Heart', 'valentines', 'Heart emoji by assetfactory'),
  sampleAsset(
    'birthday-cake',
    'Geburtstagstorte',
    'Birthday cake',
    'birthday',
    'Birthday Cake by Taylor (CC-BY-4.0)',
  ),
  sampleAsset(
    'champagne-bottle',
    'Champagnerflasche',
    'Champagne bottle',
    'celebration',
    'Champagne Bottle by ethan_garden (CC-BY-4.0)',
  ),
  sampleAsset(
    'christmas-tree',
    'Weihnachtsbaum',
    'Christmas tree',
    'christmas',
    'Xmas Tree by Eray Mutlucan',
  ),
  sampleAsset('gift-box', 'Geschenk', 'Gift box', 'general', 'Gift Box by local.yany (CC-BY-4.0)'),
];

/**
 * Dev ui-kit only: every editor control bound to one signal form with [formField], including the
 * disabled state (the lock switch) and slider bounds from the schema. `themeId` feeds the colour
 * suggestions and the contrast background from that theme's billet preset.
 */
@Component({
  selector: 'app-editor-controls-sample',
  imports: [
    FormField,
    FieldError,
    ColorPicker,
    RangeSlider,
    FontPicker,
    AssetPicker,
    EmojiPicker,
    TranslatePipe,
    JsonPipe,
  ],
  templateUrl: './editor-controls-sample.html',
  styleUrl: './editor-controls-sample.scss',
})
export class EditorControlsSample {
  private readonly language = inject(LanguageService);

  readonly themeId = input<string>(DEFAULT_THEME);

  protected readonly locked = signal(false);
  protected readonly model = signal<ControlsSampleModel>({ ...SAMPLE_CONTROLS_MODEL });
  protected readonly controlsForm = form(this.model, (p) => {
    apply(p, controlsSampleSchema);
    disabled(p, { when: () => this.locked() });
  });

  protected readonly assets = SAMPLE_ASSETS;
  protected readonly defaults = SAMPLE_CONTROLS_MODEL;
  protected readonly titleSizeStep = NUMBER_LIMITS.fontSize.step;
  protected readonly titleSizeMarks = [0.5, 1, 1.5, 2];
  protected readonly gutterMarks = BILLET_SPACE_SCALE.map((_, step) => step);
  protected readonly percentMarks = [0, 25, 50, 75, 100];

  // The same controls without a form.
  protected readonly color = signal('#6246ea');
  protected readonly percent = signal(40);
  protected readonly font = signal('dancing-script');
  protected readonly icon = signal('');

  private readonly preset = computed(() => billetPresetFor(this.themeId()));
  protected readonly background = computed(() => this.preset().palette.light.background);
  protected readonly documentColors = computed(() => [
    this.model().accent,
    this.model().ink,
    this.background(),
  ]);
  protected readonly presetColors = computed(() => [
    ...Object.values(this.preset().palette.light),
    ...this.preset().particleColors,
  ]);

  private readonly numbers = computed(
    () => new Intl.NumberFormat(this.language.locale(), { maximumFractionDigits: 2 }),
  );
  protected readonly titleSizeText = computed(() => {
    const numbers = this.numbers();
    return (size: number) => `${numbers.format(size)} ×`;
  });
  protected readonly gutterText = computed(() => {
    const numbers = this.numbers();
    return (step: number) => {
      const rem = BILLET_SPACE_SCALE[step] ?? 0;
      return `${numbers.format(rem)} rem · ${numbers.format(rem * REM_PX)} px`;
    };
  });

  protected toggleLock(event: Event): void {
    this.locked.set((event.target as HTMLInputElement).checked);
  }
}
