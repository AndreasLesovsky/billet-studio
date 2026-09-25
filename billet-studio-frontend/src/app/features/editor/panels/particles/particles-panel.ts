import {
  afterNextRender,
  Component,
  computed,
  inject,
  Injector,
  viewChildren,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import {
  createDocument,
  PARTICLE_SHAPES,
  type BilletDocument,
  type HexColor,
  type ParticleShape,
} from '../../../../billet/billet-document';
import { NUMBER_LIMITS, PARTICLE_COLOR_COUNT } from '../../../../billet/billet-limits';
import { LanguageService } from '../../../../core/services/language-service';
import { billetPresetFor } from '../../../../core/theme/billet-theme-presets.generated';
import { ColorPicker } from '../../../../shared/components/color-picker/color-picker';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { RangeSlider } from '../../../../shared/components/range-slider/range-slider';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';

interface ShapeOption {
  readonly shape: ParticleShape;
  readonly labelKey: string;
  readonly icon: string;
}

const SHAPE_OPTIONS: Readonly<Record<ParticleShape, Omit<ShapeOption, 'shape'>>> = {
  petal: { labelKey: 'EDITOR.PARTICLES.SHAPES.PETAL', icon: 'bi-flower2' },
  snowflake: { labelKey: 'EDITOR.PARTICLES.SHAPES.SNOWFLAKE', icon: 'bi-snow' },
  leaf: { labelKey: 'EDITOR.PARTICLES.SHAPES.LEAF', icon: 'bi-leaf' },
  confetti: { labelKey: 'EDITOR.PARTICLES.SHAPES.CONFETTI', icon: 'bi-stars' },
  heart: { labelKey: 'EDITOR.PARTICLES.SHAPES.HEART', icon: 'bi-heart' },
};

/** The original card's amount and motion: what the sliders reset to. */
const ORIGINAL = createDocument({ lang: 'de' }).particles;

const DENSITY_MARKS = [0, 50, 100];
const FACTOR_MARKS = [1];

/** A new colour: the first suggestion the billet does not use yet, else the last colour again. */
function nextColor(colors: readonly HexColor[], suggestions: readonly HexColor[]): HexColor {
  return suggestions.find((color) => !colors.includes(color)) ?? colors[colors.length - 1];
}

const withColors = (document: BilletDocument, colors: HexColor[]): BilletDocument => ({
  ...document,
  particles: { ...document.particles, colors },
});

/**
 * The inspector's particles tab: on/off, the shape, one to eight colours (each particle takes one of
 * them at random), amount, speed and size. Adding and removing a colour are undo steps of their own.
 * Inputs and commands: see EditorPanel.
 */
@Component({
  selector: 'app-particles-panel',
  imports: [ColorPicker, FieldError, FormField, RangeSlider, TranslatePipe],
  templateUrl: './particles-panel.html',
  styleUrl: './particles-panel.scss',
})
export class ParticlesPanel extends EditorPanel {
  private readonly commands = inject(EditorCommands);
  private readonly language = inject(LanguageService);
  private readonly injector = inject(Injector);
  private readonly pickers = viewChildren(ColorPicker);

  protected readonly shapes: readonly ShapeOption[] = PARTICLE_SHAPES.map((shape) => ({
    shape,
    ...SHAPE_OPTIONS[shape],
  }));
  protected readonly original = ORIGINAL;
  protected readonly maxColors = PARTICLE_COLOR_COUNT.max;
  protected readonly densityMarks = DENSITY_MARKS;
  protected readonly factorMarks = FACTOR_MARKS;
  protected readonly speedStep = NUMBER_LIMITS.particleSpeed.step;
  protected readonly sizeStep = NUMBER_LIMITS.particleSize.step;

  protected readonly colors = computed(() => this.document().particles.colors);
  // Slices of the document: typing in the content panel changes neither, so nothing below reruns.
  private readonly palettes = computed(() => this.document().palette);
  private readonly theme = computed(() => this.document().theme);
  protected readonly canAdd = computed(() => this.colors().length < PARTICLE_COLOR_COUNT.max);
  protected readonly canRemove = computed(() => this.colors().length > PARTICLE_COLOR_COUNT.min);

  /** The theme's particle colours, then the billet's accents, the most visible first. */
  protected readonly presetColors = computed(() => {
    const { light, dark } = this.palettes();
    return [
      ...billetPresetFor(this.theme()).particleColors,
      light.accent,
      dark.accent,
      light.border,
      light.accentSoft,
    ];
  });
  protected readonly documentColors = computed(() => {
    const { light, dark } = this.palettes();
    return [...this.colors(), ...Object.values(light), ...Object.values(dark)];
  });

  protected readonly factorText = computed(() => {
    const percent = new Intl.NumberFormat(this.language.locale(), { style: 'percent' });
    return (factor: number) => percent.format(factor);
  });

  protected addColor(): void {
    if (!this.canAdd()) return;
    const colors = this.colors();
    const color = nextColor(colors, this.presetColors());
    this.commands.commit((document) => withColors(document, [...document.particles.colors, color]));
    this.focusColor(colors.length);
  }

  protected removeColor(index: number): void {
    if (!this.canRemove()) return;
    // The removed row takes the focused button with it: focus the colour now in its place.
    const next = Math.min(index, this.colors().length - 2);
    this.commands.commit((document) =>
      withColors(
        document,
        document.particles.colors.filter((_, i) => i !== index),
      ),
    );
    this.focusColor(next);
  }

  private focusColor(index: number): void {
    afterNextRender(() => this.pickers()[index]?.focus(), { injector: this.injector });
  }
}
