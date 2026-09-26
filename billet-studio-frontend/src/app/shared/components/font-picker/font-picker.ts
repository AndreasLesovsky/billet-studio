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
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import {
  FONT_CATALOG,
  FontCatalogEntry,
  FontCategory,
} from '../../../billet/fonts/font-catalog.generated';
import { injectPickerPopover, triggerLabelledBy } from '../picker-popover/picker-popover';

/** A catalog font as the picker lists it. */
interface FontOption {
  readonly id: string;
  readonly family: string;
  readonly category: FontCategory;
  readonly categoryKey: string;
  /** The full stack, so a face that is still loading falls back like the billet does. */
  readonly stack: string;
  /** The shipped weight closest to 400: never a synthesised bold or thin. */
  readonly weight: number;
  readonly search: string;
}

const CATEGORY_KEYS: Readonly<Record<FontCategory, string>> = {
  serif: 'CONTROLS.FONT.CATEGORY.SERIF',
  sans: 'CONTROLS.FONT.CATEGORY.SANS',
  display: 'CONTROLS.FONT.CATEGORY.DISPLAY',
  script: 'CONTROLS.FONT.CATEGORY.SCRIPT',
  handwriting: 'CONTROLS.FONT.CATEGORY.HANDWRITING',
};

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function toOption(font: FontCatalogEntry): FontOption {
  const weight = [...font.weights].sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0] ?? 400;
  return {
    id: font.id,
    family: font.family,
    category: font.category,
    categoryKey: CATEGORY_KEYS[font.category],
    stack: font.fallback,
    weight,
    search: fold(`${font.family} ${font.id}`),
  };
}

const OPTIONS: readonly FontOption[] = FONT_CATALOG.map(toOption);
const OPTION_BY_ID: ReadonlyMap<string, FontOption> = new Map(OPTIONS.map((o) => [o.id, o]));
const CATEGORIES = [...new Set(OPTIONS.map((o) => o.category))].map((category) => ({
  category,
  labelKey: CATEGORY_KEYS[category],
}));

const PAGE = 8;

let nextId = 0;

/** Where Up/Down/Page keys move the active option, clamped; null for other keys. */
function activeTarget(key: string, index: number, count: number): number | null {
  const moves: Readonly<Record<string, number>> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    PageDown: index + PAGE,
    PageUp: index - PAGE,
  };
  if (!Object.hasOwn(moves, key) || count === 0) return null;
  return Math.min(count - 1, Math.max(0, moves[key]));
}

/** What a key on the closed trigger opens the list with: its letter, '' for arrows and Space. */
function openingQuery(event: KeyboardEvent): string | null {
  if (['ArrowDown', 'ArrowUp', ' '].includes(event.key)) return '';
  const modified = event.ctrlKey || event.metaKey || event.altKey;
  return event.key.length === 1 && !modified ? event.key : null;
}

/**
 * A billet font as a Signal Forms control (`value` = a FONT_CATALOG id): `[formField]` or
 * standalone `[(value)]`. The trigger names the family in its own face. The popover has a search
 * field that filters as you type (combobox, aria-activedescendant: focus stays in the field while
 * Up/Down/Page move through the list, Enter picks, Esc closes), category chips and the list with
 * every family in its own face. fonts.css is global, so the browser fetches only faces it renders.
 *
 * Typing a letter on the closed trigger opens the list already filtered by it. An id the catalog
 * does not know is shown as it is and never written back.
 */
@Component({
  selector: 'app-font-picker',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, TranslatePipe],
  templateUrl: './font-picker.html',
  styleUrl: './font-picker.scss',
  host: { class: 'ui-field', '(focusout)': 'popover.focusOut($event)' },
})
export class FontPicker implements FormValueControl<string> {
  private readonly injector = inject(Injector);

  readonly value = model<string>('');
  readonly disabled = input(false);
  /** Visible label text; or name the control with `ariaLabelledby`. */
  readonly label = input('');
  readonly ariaLabelledby = input<string | null>(null);
  /** The sample line in the popover; without one (or an empty one) it is the family's name. */
  readonly previewText = input<string | null>(null);
  /** Focus left the control: marks a bound field as touched. */
  readonly touch = output<void>();

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly id = `app-font-picker-${nextId++}`;
  protected readonly categories = CATEGORIES;

  protected readonly popover = injectPickerPopover(this.id, this.disabled, this.touch);
  protected readonly labelledBy = computed(() =>
    triggerLabelledBy(this.id, this.label(), this.ariaLabelledby()),
  );
  protected readonly query = signal('');
  protected readonly category = signal<FontCategory | null>(null);

  protected readonly selected = computed(() => OPTION_BY_ID.get(this.value()) ?? null);
  protected readonly results = computed(() => {
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    const category = this.category();
    return OPTIONS.filter(
      (o) =>
        (category === null || o.category === category) && words.every((w) => o.search.includes(w)),
    );
  });
  // Starts on the selected font whenever the list changes; the keys and the pointer move it.
  protected readonly activeIndex = linkedSignal(() =>
    Math.max(
      0,
      this.results().findIndex((o) => o.id === this.value()),
    ),
  );
  protected readonly active = computed(() => this.results()[this.activeIndex()] ?? null);
  protected readonly activeOptionId = computed(() => {
    const active = this.active();
    return active ? this.optionId(active) : null;
  });
  protected readonly preview = computed(() => this.active() ?? this.selected());

  focus(options?: FocusOptions): void {
    this.trigger().nativeElement.focus(options);
  }

  protected optionId(option: FontOption): string {
    return `${this.id}-option-${option.id}`;
  }

  protected toggle(): void {
    if (!this.popover.isOpen()) this.resetFilters('');
    this.popover.toggle();
  }

  /** A letter on the closed trigger opens the list filtered by it; arrows and Space open it. */
  protected onTriggerKey(event: KeyboardEvent): void {
    const query = this.popover.isOpen() ? null : openingQuery(event);
    if (query === null) return;
    event.preventDefault();
    this.resetFilters(query);
    this.popover.show();
  }

  protected onAttach(): void {
    afterNextRender(
      () => {
        this.search()?.nativeElement.focus();
        this.revealActive();
      },
      { injector: this.injector },
    );
  }

  protected hover(index: number): void {
    this.activeIndex.set(index);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected setCategory(category: FontCategory | null): void {
    this.category.set(category);
  }

  protected onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const active = this.active();
      if (active) this.choose(active.id);
      return;
    }
    const target = activeTarget(event.key, this.activeIndex(), this.results().length);
    if (target === null) return;
    event.preventDefault();
    this.activeIndex.set(target);
    this.revealActive();
  }

  protected choose(id: string): void {
    this.value.set(id);
    this.popover.done();
  }

  private resetFilters(query: string): void {
    this.query.set(query);
    this.category.set(null);
  }

  private revealActive(): void {
    const active = this.active();
    if (!active) return;
    const element = this.panel()?.nativeElement.querySelector(`#${this.optionId(active)}`);
    element?.scrollIntoView?.({ block: 'nearest' });
  }
}
