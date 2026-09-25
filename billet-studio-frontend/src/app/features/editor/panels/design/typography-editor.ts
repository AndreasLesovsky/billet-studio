import { Component, computed, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { EMPHASIS_COLORS, FONT_ROLES, type FontRole } from '../../../../billet/billet-document';
import { NUMBER_LIMITS } from '../../../../billet/billet-limits';
import { fontStack } from '../../../../billet/typography';
import { LanguageService } from '../../../../core/services/language-service';
import { billetPresetFor } from '../../../../core/theme/billet-theme-presets.generated';
import { THEMES } from '../../../../core/theme/theme-registry.generated';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { FontPicker } from '../../../../shared/components/font-picker/font-picker';
import { RangeSlider } from '../../../../shared/components/range-slider/range-slider';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';
import {
  italicAvailable,
  sameTypography,
  weightsFor,
  withRoleFont,
  withRoleWeight,
  withTypographyOf,
} from './design-edits';

const ROLE_KEYS: Readonly<Record<FontRole, string>> = {
  title: 'TITLE',
  titleAccent: 'TITLE_ACCENT',
  heading: 'HEADING',
  body: 'BODY',
  signature: 'SIGNATURE',
  ui: 'UI',
};

const EMPHASIS_KEYS = {
  inkSoft: 'EDITOR.DESIGN.ROLES.INK_SOFT',
  accent: 'EDITOR.DESIGN.ROLES.ACCENT',
} as const;

const SIZE_MARKS = [0.5, 1, 1.5, 2];

/**
 * The design tab's typography: a row of font pairings (another theme's fonts in one step), then per
 * role the family, weight, italic and size, and the colour of *emphasis*. A family or weight change
 * is one undo step that keeps weight and italic to faces the family ships.
 */
@Component({
  selector: 'app-typography-editor',
  imports: [FieldError, FontPicker, FormField, RangeSlider, TranslatePipe],
  templateUrl: './typography-editor.html',
  styleUrl: './typography-editor.scss',
})
export class TypographyEditor extends EditorPanel {
  private readonly commands = inject(EditorCommands);
  private readonly language = inject(LanguageService);

  protected readonly sizeStep = NUMBER_LIMITS.fontSize.step;
  protected readonly sizeMarks = SIZE_MARKS;
  protected readonly emphasisOptions = EMPHASIS_COLORS.map((color) => ({
    color,
    labelKey: EMPHASIS_KEYS[color],
  }));

  // Slices of the document: typing in the content panel changes neither, so nothing below reruns.
  private readonly typography = computed(() => this.document().typography);
  private readonly theme = computed(() => this.document().theme);

  protected readonly roles = computed(() => {
    const typography = this.typography();
    const preset = billetPresetFor(this.theme()).typography;
    return FONT_ROLES.map((key) => {
      const ref = typography[key];
      return {
        key,
        legendKey: `EDITOR.DESIGN.FONT_ROLES.${ROLE_KEYS[key]}`,
        hintKey: `EDITOR.DESIGN.FONT_ROLE_HINTS.${ROLE_KEYS[key]}`,
        fontId: ref.fontId,
        weight: ref.weight,
        weights: weightsFor(ref).map((weight) => ({
          weight,
          nameKey: `EDITOR.DESIGN.WEIGHTS.W${weight}`,
        })),
        italicAvailable: italicAvailable(ref.fontId, ref.weight),
        defaultSize: preset[key].size,
      };
    });
  });

  /** Every theme's typography, its name set in the theme's title face. */
  protected readonly pairs = computed(() => {
    const current = this.typography();
    return THEMES.map(({ id, nameKey }) => {
      const { typography } = billetPresetFor(id);
      return {
        id,
        nameKey,
        stack: fontStack(typography.title, 'title'),
        weight: typography.title.weight,
        active: sameTypography(typography, current),
      };
    });
  });

  protected readonly sizeText = computed(() => {
    const percent = new Intl.NumberFormat(this.language.locale(), { style: 'percent' });
    return (size: number) => percent.format(size);
  });

  protected pickFont(role: FontRole, fontId: string): void {
    this.commands.commit((document) => {
      const typography = withRoleFont(document.typography, role, fontId);
      return typography === document.typography ? document : { ...document, typography };
    });
  }

  protected pickWeight(role: FontRole, event: Event): void {
    const weight = Number((event.target as HTMLSelectElement).value);
    this.commands.commit((document) => {
      const typography = withRoleWeight(document.typography, role, weight);
      return typography === document.typography ? document : { ...document, typography };
    });
  }

  protected applyPair(themeId: string): void {
    const preset = billetPresetFor(themeId).typography;
    if (sameTypography(preset, this.typography())) return;
    this.commands.commit((document) => withTypographyOf(document, themeId));
  }
}
