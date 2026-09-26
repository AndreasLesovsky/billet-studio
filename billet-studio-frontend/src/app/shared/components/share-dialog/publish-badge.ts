import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { publishBadgeOf, type ShareFacts } from './share-state';

/** "Published" or "Unpublished changes" for a billet; nothing while it is private. */
@Component({
  selector: 'app-publish-badge',
  imports: [TranslatePipe],
  template: `
    @if (badge(); as badge) {
      <span class="ui-badge" [class]="badge.className">
        <i class="bi" [class]="badge.icon" aria-hidden="true"></i>
        {{ badge.key | translate }}
      </span>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class PublishBadge {
  readonly facts = input.required<ShareFacts>();

  protected readonly badge = computed(() => publishBadgeOf(this.facts()));
}
