import { Component, input, linkedSignal } from '@angular/core';

/**
 * A 3D model's preview on a tinted plane (.ui-thumb). The emoji shows until the image has loaded,
 * and stays when there is no image or it fails to load. Decorative: the caller names the thing.
 */
@Component({
  selector: 'app-asset-thumb',
  host: {
    class: 'ui-thumb',
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
  /** The preview URL; null while it is unknown. */
  readonly src = input<string | null>(null);
  readonly emoji = input.required<string>();

  // Per image: a new src starts over.
  protected readonly loaded = linkedSignal({ source: this.src, computation: () => false });
  protected readonly failed = linkedSignal({ source: this.src, computation: () => false });
}
