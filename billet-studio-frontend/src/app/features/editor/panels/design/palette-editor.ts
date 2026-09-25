import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import type { HexColor } from '../../../../billet/billet-document';
import { contrastIssues } from '../../../../billet/palette';
import { LanguageService } from '../../../../core/services/language-service';
import { billetPresetFor } from '../../../../core/theme/billet-theme-presets.generated';
import type { ColorMode } from '../../../../core/theme/theme-registry.generated';
import { ColorPicker } from '../../../../shared/components/color-picker/color-picker';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';
import { PALETTE_ROLES, withDarkLinked, withLightColor, type PaletteRole } from './design-edits';

interface RoleMeta {
  readonly labelKey: string;
  readonly hintKey: string;
  /** What the role is read on, for the picker's contrast readout; null for decoration. */
  readonly against: PaletteRole | null;
}

const ROLE_META: Readonly<Record<PaletteRole, RoleMeta>> = {
  accent: {
    labelKey: 'EDITOR.DESIGN.ROLES.ACCENT',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.ACCENT',
    against: 'accentSoft',
  },
  accentSoft: {
    labelKey: 'EDITOR.DESIGN.ROLES.ACCENT_SOFT',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.ACCENT_SOFT',
    against: 'accent',
  },
  border: {
    labelKey: 'EDITOR.DESIGN.ROLES.BORDER',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.BORDER',
    against: null,
  },
  background: {
    labelKey: 'EDITOR.DESIGN.ROLES.BACKGROUND',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.BACKGROUND',
    against: 'ink',
  },
  ink: {
    labelKey: 'EDITOR.DESIGN.ROLES.INK',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.INK',
    against: 'background',
  },
  inkSoft: {
    labelKey: 'EDITOR.DESIGN.ROLES.INK_SOFT',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.INK_SOFT',
    against: 'background',
  },
  surface: {
    labelKey: 'EDITOR.DESIGN.ROLES.SURFACE',
    hintKey: 'EDITOR.DESIGN.ROLE_HINTS.SURFACE',
    against: 'ink',
  },
};

interface ModeTab {
  readonly mode: ColorMode;
  readonly labelKey: string;
  readonly icon: string;
}

const MODES: readonly ModeTab[] = [
  { mode: 'light', labelKey: 'EDITOR.DESIGN.PALETTE_LIGHT', icon: 'bi-sun' },
  { mode: 'dark', labelKey: 'EDITOR.DESIGN.PALETTE_DARK', icon: 'bi-moon' },
];

const tabId = (mode: ColorMode) => `editor-palette-tab-${mode}`;

/**
 * The design tab's colours: the light and the dark palette as two tabs, seven roles each. While
 * "derive dark" is on, every light colour also rewrites the dark palette (in the same form write, so
 * it is one undo step with the light change) and the dark tab only shows the result.
 */
@Component({
  selector: 'app-palette-editor',
  imports: [ColorPicker, FieldError, FormField, TranslatePipe],
  templateUrl: './palette-editor.html',
  styleUrl: './palette-editor.scss',
})
export class PaletteEditor extends EditorPanel {
  private readonly commands = inject(EditorCommands);
  private readonly language = inject(LanguageService);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  protected readonly modes = MODES;
  protected readonly tabId = tabId;
  protected readonly mode = signal<ColorMode>('light');
  // Slices of the document: typing in the content panel changes neither, so nothing below reruns.
  private readonly palettes = computed(() => this.document().palette);
  private readonly particleColors = computed(() => this.document().particles.colors);
  private readonly theme = computed(() => this.document().theme);
  protected readonly linked = computed(() => this.palettes().darkLinked);
  /** The dark tab while linked: the derived colours are shown, not edited. */
  protected readonly derived = computed(() => this.mode() === 'dark' && this.linked());

  /**
   * The roles of the shown palette, with the colour each is read on. The id names the mode too, so
   * switching tabs creates pickers bound to the other palette instead of rebinding these.
   */
  protected readonly roles = computed(() => {
    const mode = this.mode();
    const palette = this.palettes()[mode];
    return PALETTE_ROLES.map((key) => {
      const { labelKey, hintKey, against } = ROLE_META[key];
      const contrast = against && palette[against];
      return { id: `${mode}-${key}`, key, labelKey, hintKey, hex: palette[key], against: contrast };
    });
  });

  /** Every colour the billet uses: palettes and particles (the picker deduplicates). */
  protected readonly documentColors = computed(() => {
    const { light, dark } = this.palettes();
    return [...Object.values(light), ...Object.values(dark), ...this.particleColors()];
  });
  protected readonly presetColors = computed(() => {
    const preset = billetPresetFor(this.theme());
    return [...Object.values(preset.palette[this.mode()]), ...preset.particleColors];
  });

  /** The billet contrast rules the shown palette breaks, ratios floored like the picker's. */
  protected readonly issues = computed(() => {
    const numbers = new Intl.NumberFormat(this.language.locale(), { maximumFractionDigits: 2 });
    return contrastIssues(this.palettes()[this.mode()]).map((issue) => ({
      id: `${issue.fg}-${issue.bg}`,
      fgKey: ROLE_META[issue.fg].labelKey,
      bgKey: ROLE_META[issue.bg].labelKey,
      ratio: numbers.format(Math.floor(issue.ratio * 100) / 100),
      min: numbers.format(issue.min),
    }));
  });

  protected selectMode(mode: ColorMode): void {
    this.mode.set(mode);
  }

  /** Arrow keys, Home and End switch the tab (WAI-ARIA tabs, automatic activation). */
  protected onTabKeydown(event: KeyboardEvent): void {
    const index = MODES.findIndex((m) => m.mode === this.mode());
    const targets: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: MODES.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const { mode } = MODES[(target + MODES.length) % MODES.length];
    this.selectMode(mode);
    afterNextRender(() => this.host.querySelector<HTMLElement>(`#${tabId(mode)}`)?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * The field itself is written by [formField]. A light colour while linked also rewrites the dark
   * palette, in the same form write, so history takes both in as one step.
   */
  protected onColor(role: PaletteRole, hex: HexColor): void {
    const palette = this.billetForm().palette;
    const current = palette().value();
    if (this.mode() === 'light' && current.darkLinked) {
      palette().value.set(withLightColor(current, role, hex));
    }
  }

  protected setDarkLinked(event: Event): void {
    const linked = (event.target as HTMLInputElement).checked;
    this.commands.commit((document) => ({
      ...document,
      palette: withDarkLinked(document.palette, linked),
    }));
  }
}
