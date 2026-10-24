import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminBilletDto } from '../../../../core/models/models';
import { shareLink } from '../../../../shared/components/share-dialog/share-state';

/**
 * A billet's link cell: the public link of a published billet (the one its owner shares, opened in
 * a new tab), or a note that a draft has none.
 */
@Component({
  selector: 'app-billet-link',
  imports: [TranslatePipe],
  template: `
    @if (url(); as url) {
      <a
        class="billet-link"
        target="_blank"
        rel="noopener noreferrer"
        [href]="url"
        [attr.title]="url"
        [attr.aria-label]="'ADMIN_BILLETS.OPEN_LINK' | translate: { title: billet().title }"
      >
        <span>/b/{{ billet().shareToken }}</span>
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
      </a>
    } @else {
      <span class="ui-hint">{{ 'ADMIN_BILLETS.NO_LINK' | translate }}</span>
    }
  `,
  styles: `
    .billet-link {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      white-space: nowrap;
    }
  `,
})
export class BilletLink {
  readonly billet = input.required<AdminBilletDto>();

  protected readonly url = computed(() => {
    const { published, shareToken } = this.billet();
    return published && shareToken ? shareLink(shareToken) : null;
  });
}
