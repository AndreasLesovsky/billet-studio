import { Component, computed, input, linkedSignal } from '@angular/core';

/**
 * A 3D model's preview on a tinted plane (.ui-thumb). The plane shimmers while the preview is
 * still coming - its catalog loads (`pending`) or the image itself does - and the emoji stands in
 * only when there is nothing to wait for: no image, or it failed to load. Decorative: the caller
 * names the thing.
 */
@Component({
  selector: 'app-asset-thumb',
  host: {
    class: 'ui-thumb',
    '[class.ui-thumb--pending]': 'waiting()',
    '[class.ui-thumb--loaded]': 'loaded()',
  },
  template: `
    <span class="ui-thumb__emoji" aria-hidden="true">{{ emoji() }}</span>
    @if (src() && !failed()) {
      <img
        class="ui-thumb__img"
        alt=""
        width="512"
        height="512"
        decoding="async"
        [src]="src()"
        (load)="loaded.set(true)"
        (error)="failed.set(true)"
      />
    }
  `,
})
export class AssetThumb {
  /** The preview URL; null while it is unknown or when there is none. */
  readonly src = input<string | null>(null);
  readonly emoji = input.required<string>();
  /** The source of `src` (the model catalog) is still loading. */
  readonly pending = input(false);

  // Per image: a new src starts over.
  protected readonly loaded = linkedSignal({ source: this.src, computation: () => false });
  protected readonly failed = linkedSignal({ source: this.src, computation: () => false });

  protected readonly waiting = computed(() =>
    this.src() ? !this.loaded() && !this.failed() : this.pending(),
  );
}
