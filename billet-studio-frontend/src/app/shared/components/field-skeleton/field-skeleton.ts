import { Component, computed, input } from '@angular/core';

/**
 * A form field while its data loads, shaped like the real .ui-field: label line, control, the
 * hint's lines (one paragraph, no gap between them), and the slot of its app-field-error - empty
 * until a rule breaks, but a flex item all the same, so the gap it adds is held too. Decorative.
 */
@Component({
  selector: 'app-field-skeleton',
  host: { class: 'ui-field', 'aria-hidden': 'true' },
  template: `
    <span class="ui-label ui-skeleton ui-skeleton--text ui-skeleton--short"></span>
    <span class="ui-skeleton ui-skeleton--control"></span>
    @if (hintLines().length > 0) {
      <span class="ui-hint ui-skeleton-lines">
        @for (line of hintLines(); track line) {
          <span class="ui-skeleton ui-skeleton--text" [class.ui-skeleton--medium]="$last"></span>
        }
      </span>
    }
    @if (errorSlot()) {
      <span></span>
    }
  `,
})
export class FieldSkeleton {
  /** Lines of the field's hint (0 = none). */
  readonly hints = input(0);
  /** The real field pairs with an app-field-error. */
  readonly errorSlot = input(true);

  protected readonly hintLines = computed(() => Array.from({ length: this.hints() }, (_, i) => i));
}
