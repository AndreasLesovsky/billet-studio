import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PublishBadge } from '../../shared/components/share-dialog/publish-badge';
import { publishBadgeOf, type ShareFacts } from '../../shared/components/share-dialog/share-state';
import { TooltipAnchor } from '../../shared/directives/tooltip-anchor';
import type { SaveIndicator } from './editor-session';

/**
 * The editor's save status and, for an account billet, its publish badge. `stacked`: in words, the
 * status over the badge, flush with the end (the wide toolbar); `row`: in words side by side (the
 * phone's side sheet); `icons`: their icons, the words in a tooltip that also names them (the
 * medium toolbar). What the status says aloud is the toolbar's live region, not this.
 */
@Component({
  selector: 'app-editor-save-status',
  imports: [PublishBadge, TooltipAnchor, TranslatePipe],
  templateUrl: './editor-save-status.html',
  styleUrl: './editor-save-status.scss',
  host: { '[class]': "'editor-save-status--' + variant()" },
})
export class EditorSaveStatus {
  readonly indicator = input.required<SaveIndicator>();
  /** An account billet's publish state; null for a billet on this device. */
  readonly facts = input<ShareFacts | null>(null);
  readonly variant = input<'stacked' | 'row' | 'icons'>('stacked');

  protected readonly badge = computed(() => {
    const facts = this.facts();
    return facts ? publishBadgeOf(facts) : null;
  });
}
