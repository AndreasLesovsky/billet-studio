import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';
import { form, FormField, FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { contrast } from '../../../billet/palette';
import { LanguageService } from '../../../core/services/language-service';
import { FieldError } from '../field-error/field-error';
import { injectPickerPopover, triggerLabelledBy } from '../picker-popover/picker-popover';
import { HexFormModel, hexSchema } from './color-picker-schema';
import { hexToHsv, Hsv, hsvAfterKey, HsvChannel, hsvToHex, parseHexInput } from './color-math';
import { RecentColors } from './recent-colors';

interface SwatchGroup {
  readonly id: string;
  readonly titleKey: string;
  readonly colors: readonly string[];
  /** The one swatch of the row that Tab reaches: the current colour, else the first. */
  readonly tabStop: string;
}

interface ContrastReadout {
  readonly ratio: string;
  readonly badge: string;
  readonly labelKey: string;
  readonly hintKey: string;
}

/** The subset of the EyeDropper API (Chromium only) the picker uses; not in TypeScript's DOM lib. */
type EyeDropperConstructor = new () => { open(): Promise<{ sRGBHex: string }> };

/** WCAG 2.x: 4.5 for body text, 3 for large text (and UI marks). */
const CONTRAST_LEVELS = [
  {
    min: 4.5,
    badge: 'ui-badge--success',
    labelKey: 'CONTROLS.COLOR.CONTRAST_AA',
    hintKey: 'CONTROLS.COLOR.CONTRAST_AA_HINT',
  },
  {
    min: 3,
    badge: 'ui-badge--warning',
    labelKey: 'CONTROLS.COLOR.CONTRAST_AA_LARGE',
    hintKey: 'CONTROLS.COLOR.CONTRAST_AA_LARGE_HINT',
  },
  {
    min: 0,
    badge: 'ui-badge--danger',
    labelKey: 'CONTROLS.COLOR.CONTRAST_LOW',
    hintKey: 'CONTROLS.COLOR.CONTRAST_LOW_HINT',
  },
] as const;

const FALLBACK_HEX = '#000000';
const SIX_DIGITS = /^\s*#?[0-9a-f]{6}\s*$/i;

let nextId = 0;

function uniqueHexes(colors: readonly string[]): string[] {
  const hexes = colors.map(parseHexInput).filter((hex): hex is string => hex !== null);
  return [...new Set(hexes)];
}

/**
 * A billet colour as a Signal Forms control (`value` = '#rrggbb' lowercase): `[formField]` or
 * standalone `[(value)]`. The trigger shows the colour and its hex; the popover (CDK overlay, placed
 * inline so an editor theme scope reaches it) offers the billet's own colours, suggestions, recently
 * used colours, a saturation/brightness plane with a hue slider (pointer and keyboard), a hex field,
 * the EyeDropper where the browser has one, and the contrast against `contrastAgainst`.
 *
 * Dragging writes the colour live. The hex field writes a complete #rrggbb while typing and a short
 * #rgb on Enter or blur; anything else shows its message and writes nothing.
 */
@Component({
  selector: 'app-color-picker',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, FormField, FieldError, TranslatePipe],
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.scss',
  host: { class: 'ui-field', '(focusout)': 'popover.focusOut($event)' },
})
export class ColorPicker implements FormValueControl<string> {
  private readonly injector = inject(Injector);
  private readonly recentColors = inject(RecentColors);
  private readonly language = inject(LanguageService);

  readonly value = model<string>(FALLBACK_HEX);
  readonly disabled = input(false);
  /** Visible label text; or name the control with `ariaLabelledby`. */
  readonly label = input('');
  readonly ariaLabelledby = input<string | null>(null);
  /** Colours already used in the billet, offered first (deduplicated). */
  readonly documentColors = input<readonly string[]>([]);
  readonly presetColors = input<readonly string[]>([]);
  /** A background (hex) to show the contrast ratio against, with its WCAG level. */
  readonly contrastAgainst = input<string | null>(null);
  /** Focus left the control: marks a bound field as touched. */
  readonly touch = output<void>();

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly plane = viewChild<ElementRef<HTMLElement>>('plane');

  protected readonly id = `app-color-picker-${nextId++}`;
  protected readonly eyeDropper =
    (globalThis as { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null;

  protected readonly popover = injectPickerPopover(this.id, this.disabled, this.touch);
  protected readonly labelledBy = computed(() =>
    triggerLabelledBy(this.id, this.label(), this.ariaLabelledby()),
  );

  /** The value as '#rrggbb', null while it is no colour. */
  protected readonly current = computed(() => parseHexInput(this.value()));
  private openedWith: string | null = null;

  // The picker's own HSV: kept while it still yields the value, so the hue survives grey and black.
  protected readonly hsv = linkedSignal<string | null, Hsv>({
    source: this.current,
    computation: (hex, previous) => {
      if (previous && (hex === null || hsvToHex(previous.value) === hex)) return previous.value;
      return hexToHsv(hex ?? FALLBACK_HEX);
    },
  });
  protected readonly hueColor = computed(() => hsvToHex({ h: this.hsv().h, s: 100, v: 100 }));
  protected readonly planeText = computed(() => ({
    saturation: Math.round(this.hsv().s),
    brightness: Math.round(this.hsv().v),
  }));
  protected readonly hueDegrees = computed(() => Math.round(this.hsv().h));
  protected readonly thumbs = computed(() => ({
    saturation: `${this.hsv().s}%`,
    brightness: `${this.hsv().v}%`,
    hue: `${(this.hsv().h / 360) * 100}%`,
  }));

  // The hex field keeps what the user typed as long as it names the current colour.
  protected readonly model = linkedSignal<string | null, HexFormModel>({
    source: this.current,
    computation: (hex, previous) =>
      previous && hex !== null && parseHexInput(previous.value.hex) === hex
        ? previous.value
        : { hex: hex ?? this.value() },
  });
  protected readonly hexForm = form(this.model, hexSchema);

  protected readonly groups = computed<SwatchGroup[]>(() => {
    const current = this.current();
    const rows = [
      ['document', 'CONTROLS.COLOR.DOCUMENT_COLORS', uniqueHexes(this.documentColors())],
      ['presets', 'CONTROLS.COLOR.SUGGESTIONS', uniqueHexes(this.presetColors())],
      ['recent', 'CONTROLS.COLOR.RECENT', this.recentColors.colors()],
    ] as const;
    return rows
      .filter(([, , colors]) => colors.length > 0)
      .map(([id, titleKey, colors]) => ({
        id,
        titleKey,
        colors,
        tabStop: current && colors.includes(current) ? current : colors[0],
      }));
  });

  protected readonly contrastReadout = computed<ContrastReadout | null>(() => {
    const hex = this.current();
    const against = parseHexInput(this.contrastAgainst() ?? '');
    if (!hex || !against) return null;
    // Floored, never rounded up: 4.49 must not read as passing 4.5.
    const ratio = Math.floor(contrast(hex, against) * 100) / 100;
    const level = CONTRAST_LEVELS.find((l) => ratio >= l.min) ?? CONTRAST_LEVELS[2];
    const text = new Intl.NumberFormat(this.language.locale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(ratio);
    return { ratio: text, badge: level.badge, labelKey: level.labelKey, hintKey: level.hintKey };
  });

  focus(options?: FocusOptions): void {
    this.trigger().nativeElement.focus(options);
  }

  protected onAttach(): void {
    this.openedWith = this.current();
    // Land on the current colour's swatch when one is offered, else on the plane.
    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        const swatch = panel?.querySelector<HTMLElement>('[aria-pressed="true"]');
        (swatch ?? this.plane()?.nativeElement)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** A colour kept when the popover closes joins the recently used ones. */
  protected onDetach(): void {
    const picked = this.current();
    if (picked && picked !== this.openedWith) this.recentColors.add(picked);
    this.popover.detached();
  }

  protected pick(hex: string): void {
    this.write(hex);
  }

  /** Arrow keys, Home and End move focus within one swatch row; Tab leaves it. */
  protected onSwatchKey(event: KeyboardEvent): void {
    const swatch = event.currentTarget as HTMLElement;
    const siblings = [...(swatch.parentElement?.children ?? [])] as HTMLElement[];
    const target = listTarget(event.key, siblings.indexOf(swatch), siblings.length);
    if (target === null) return;
    event.preventDefault();
    siblings[target].focus();
  }

  protected onPointer(event: PointerEvent, channel: HsvChannel): void {
    const surface = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') {
      surface.setPointerCapture?.(event.pointerId);
      surface.focus();
    } else if (!surface.hasPointerCapture?.(event.pointerId)) {
      return;
    }
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    const x = fraction(event.clientX - rect.left, rect.width);
    const hsv = this.hsv();
    this.setHsv(
      channel === 'hue'
        ? { ...hsv, h: x * 360 }
        : { ...hsv, s: x * 100, v: (1 - fraction(event.clientY - rect.top, rect.height)) * 100 },
    );
  }

  protected onSliderKey(event: KeyboardEvent, channel: HsvChannel): void {
    const next = hsvAfterKey(this.hsv(), channel, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    this.setHsv(next);
  }

  /** Live while typing, but only a complete #rrggbb: a short #rgb is still a prefix of one. */
  protected onHexInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    const hex = SIX_DIGITS.test(text) ? parseHexInput(text) : null;
    if (hex) this.write(hex);
  }

  protected commitHex(): void {
    const hex = parseHexInput(this.model().hex);
    if (!hex) {
      this.hexForm.hex().markAsTouched();
      return;
    }
    this.model.set({ hex });
    this.write(hex);
  }

  protected async pickFromScreen(): Promise<void> {
    if (!this.eyeDropper) return;
    try {
      const { sRGBHex } = await new this.eyeDropper().open();
      const hex = parseHexInput(sRGBHex);
      if (hex) this.write(hex);
    } catch {
      // Cancelled with Esc, or the browser refused: the colour stays.
    }
  }

  private setHsv(hsv: Hsv): void {
    this.hsv.set(hsv);
    this.write(hsvToHex(hsv));
  }

  private write(hex: string): void {
    if (hex !== this.value()) this.value.set(hex);
  }
}

function listTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

function fraction(offset: number, size: number): number {
  return size > 0 ? Math.min(1, Math.max(0, offset / size)) : 0;
}
