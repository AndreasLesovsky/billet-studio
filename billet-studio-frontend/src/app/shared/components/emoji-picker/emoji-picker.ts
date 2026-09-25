import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { TEXT_LIMITS } from '../../../billet/billet-limits';
import { sanitizeText, truncateGraphemes } from '../../../billet/text/text-sanitize';
import { injectPickerPopover, triggerLabelledBy } from '../picker-popover/picker-popover';
import { EMOJI_COLUMNS, EMOJI_GROUPS } from './emoji-groups';

/** The groups with each emoji's position in the whole grid, which the arrow keys move through. */
const GROUPS = (() => {
  let index = 0;
  return EMOJI_GROUPS.map((group) => ({
    ...group,
    items: group.emojis.map((emoji) => ({ emoji, index: index++ })),
  }));
})();
const EMOJIS = EMOJI_GROUPS.flatMap((group) => group.emojis);

let nextId = 0;

/** One line, no control characters, at most the card icon limit, cut between graphemes. */
function cleanIcon(raw: string): string {
  return truncateGraphemes(sanitizeText(raw).replace(/\n/g, ''), TEXT_LIMITS.cardIcon);
}

/** Where an arrow key, Home or End moves in a grid of `columns`; null for other keys. */
function gridTarget(key: string, index: number, count: number, columns: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return index >= columns ? index - columns : index;
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * A card icon as a Signal Forms control (`value` = the icon text, usually one emoji, '' = none):
 * `[formField]` or standalone `[(value)]`. The trigger shows the icon; the popover (CDK overlay,
 * inline so an editor theme scope reaches it) holds a curated grid in five groups - one Tab stop,
 * arrow keys move through it, Enter picks and closes - plus a free text field for any other emoji
 * or a short text, cleaned as the backend requires, and "no icon".
 */
@Component({
  selector: 'app-emoji-picker',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, TranslatePipe],
  templateUrl: './emoji-picker.html',
  styleUrl: './emoji-picker.scss',
  host: { class: 'ui-field', '(focusout)': 'popover.focusOut($event)' },
})
export class EmojiPicker implements FormValueControl<string> {
  private readonly injector = inject(Injector);

  readonly value = model<string>('');
  readonly disabled = input(false);
  /** Visible label text; or name the control with `ariaLabelledby`. */
  readonly label = input('');
  readonly ariaLabelledby = input<string | null>(null);
  /** Focus left the control: marks a bound field as touched. */
  readonly touch = output<void>();

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly id = `app-emoji-picker-${nextId++}`;
  protected readonly groups = GROUPS;
  protected readonly iconLimit = TEXT_LIMITS.cardIcon;

  protected readonly popover = injectPickerPopover(this.id, this.disabled, this.touch);
  protected readonly labelledBy = computed(() =>
    triggerLabelledBy(this.id, this.label(), this.ariaLabelledby()),
  );
  /** The grid's one Tab stop: the current emoji, else the first. */
  protected readonly tabStop = computed(() => Math.max(0, EMOJIS.indexOf(this.value())));

  focus(options?: FocusOptions): void {
    this.trigger().nativeElement.focus(options);
  }

  protected onAttach(): void {
    afterNextRender(() => this.gridButtons()[this.tabStop()]?.focus(), {
      injector: this.injector,
    });
  }

  protected choose(emoji: string): void {
    this.value.set(emoji);
    this.popover.done();
  }

  protected clear(): void {
    this.choose('');
  }

  protected onGridKey(event: KeyboardEvent, index: number): void {
    const target = gridTarget(event.key, index, EMOJIS.length, EMOJI_COLUMNS);
    if (target === null) return;
    event.preventDefault();
    this.gridButtons()[target]?.focus();
  }

  protected onCustomInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const icon = cleanIcon(field.value);
    if (icon !== field.value) field.value = icon;
    this.value.set(icon);
  }

  /** Enter confirms the text; without preventDefault its keypress would click the trigger again. */
  protected onCustomEnter(event: Event): void {
    event.preventDefault();
    this.popover.done();
  }

  private gridButtons(): HTMLElement[] {
    return [
      ...(this.panel()?.nativeElement.querySelectorAll<HTMLElement>('.ui-emoji-button') ?? []),
    ];
  }
}
