import { Component, computed, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import {
  BILLET_SPACE_SCALE,
  createDocument,
  DIVIDER_STYLES,
  type BilletDocument,
} from '../../../../billet/billet-document';
import { NUMBER_LIMITS } from '../../../../billet/billet-limits';
import { LanguageService } from '../../../../core/services/language-service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { RangeSlider } from '../../../../shared/components/range-slider/range-slider';
import { EditorCommands } from '../../editor-commands';
import { DIVIDER_STYLE_KEYS } from '../content/block-editor';
import { EditorPanel } from '../editor-panel';
import { SPACING_KEYS } from './spacing-schema';

type SpacingKey = (typeof SPACING_KEYS)[number];

/** The original card's layout: what a fresh billet starts with and what "reset" returns to. */
const ORIGINAL = createDocument({ lang: 'de' });

const REM_PX = 16;
const LAST_STEP = BILLET_SPACE_SCALE.length - 1;
const STEP_MARKS = BILLET_SPACE_SCALE.map((_, step) => step);
const HEIGHT_MARKS = [15, 20, 25, 30, 35, 40];

const STEP_KEYS: Readonly<Record<SpacingKey, string>> = {
  gutter: 'GUTTER',
  heroTop: 'HERO_TOP',
  heroBottom: 'HERO_BOTTOM',
  dividerGap: 'DIVIDER_GAP',
  blockGap: 'BLOCK_GAP',
  signatureGap: 'SIGNATURE_GAP',
  pageBottom: 'PAGE_BOTTOM',
};

const spacingStep = (key: SpacingKey) => ({
  key,
  labelKey: `EDITOR.SPACING.${STEP_KEYS[key]}`,
  hintKey: `EDITOR.SPACING.${STEP_KEYS[key]}_HINT`,
  original: ORIGINAL.spacing[key],
});

/** The page from top to bottom; the scene group also holds the scene height and the divider. */
const GROUPS = [
  { id: 'page', titleKey: 'EDITOR.SPACING.PAGE', steps: [spacingStep('gutter')], scene: false },
  {
    id: 'hero',
    titleKey: 'EDITOR.SPACING.HERO',
    steps: [spacingStep('heroTop'), spacingStep('heroBottom')],
    scene: false,
  },
  {
    id: 'scene',
    titleKey: 'EDITOR.SPACING.SCENE',
    steps: [spacingStep('dividerGap')],
    scene: true,
  },
  {
    id: 'text',
    titleKey: 'EDITOR.SPACING.TEXT',
    steps: [spacingStep('blockGap'), spacingStep('signatureGap'), spacingStep('pageBottom')],
    scene: false,
  },
];

function atOriginal(document: BilletDocument): boolean {
  return (
    SPACING_KEYS.every((key) => document.spacing[key] === ORIGINAL.spacing[key]) &&
    document.scene.height === ORIGINAL.scene.height
  );
}

/**
 * The inspector's spacing tab: the spacing steps (on the fixed scale, read out in rem and px), the
 * height of the 3D area and the divider below it, grouped as they appear on the page. Every slider
 * resets to the original card's value on its own; the button on top resets them all as one step.
 */
@Component({
  selector: 'app-spacing-panel',
  imports: [FieldError, FormField, RangeSlider, TranslatePipe],
  templateUrl: './spacing-panel.html',
  styleUrl: './spacing-panel.scss',
})
export class SpacingPanel extends EditorPanel {
  private readonly commands = inject(EditorCommands);
  private readonly language = inject(LanguageService);

  protected readonly groups = GROUPS;
  protected readonly stepMarks = STEP_MARKS;
  protected readonly heightMarks = HEIGHT_MARKS;
  protected readonly heightStep = NUMBER_LIMITS.sceneHeight.step;
  protected readonly originalHeight = ORIGINAL.scene.height;
  protected readonly dividerStyles = DIVIDER_STYLES.map((style) => ({
    style,
    labelKey: DIVIDER_STYLE_KEYS[style],
  }));
  protected readonly atOriginal = computed(() => atOriginal(this.document()));

  private readonly remText = computed(() => {
    const numbers = new Intl.NumberFormat(this.language.locale(), { maximumFractionDigits: 2 });
    return (rem: number) => `${numbers.format(rem)} rem · ${numbers.format(rem * REM_PX)} px`;
  });
  protected readonly stepText = computed(() => {
    const text = this.remText();
    return (value: number) => text(BILLET_SPACE_SCALE[Math.min(LAST_STEP, Math.max(0, value))]);
  });
  protected readonly heightText = this.remText;

  protected resetAll(): void {
    this.commands.commit((document) => ({
      ...document,
      spacing: { ...ORIGINAL.spacing },
      scene: { ...document.scene, height: ORIGINAL.scene.height },
    }));
  }
}
