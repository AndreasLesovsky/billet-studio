import { Component, computed, input, linkedSignal, model, output, signal } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import { FieldError } from '../../shared/components/field-error/field-error';
import type { ShareFacts } from '../../shared/components/share-dialog/share-state';
import { TooltipAnchor } from '../../shared/directives/tooltip-anchor';
import { BilletText } from './billet-text';
import type { EditorLayout } from './editor-layout';
import { EditorSaveStatus } from './editor-save-status';
import type { SaveIndicator, ShareMode } from './editor-session';
import { EditorToolbarMenu } from './editor-toolbar-menu';
import type { PreviewMode } from './editor-toolbar-options';
import { EditorToolbarSheet } from './editor-toolbar-sheet';
import { EditorToolbarTools } from './editor-toolbar-tools';

interface ShareView {
  /** Why Share is disabled (its tooltip); null when it opens the share dialog. */
  readonly hintKey: string | null;
  readonly className: string;
}

// A device billet's one primary action is the banner's "into my account", so Share steps back.
const SHARE_VIEWS: Readonly<Record<ShareMode, ShareView>> = {
  guest: { hintKey: 'EDITOR.SHARE_GUEST_HINT', className: 'ui-btn ui-btn--primary' },
  device: { hintKey: 'EDITOR.SHARE_DEVICE_HINT', className: 'ui-btn ui-btn--secondary' },
  account: { hintKey: null, className: 'ui-btn ui-btn--primary' },
};

/**
 * The editor's top bar: one row at every width, holding what the layout has room for.
 * - wide: the title, undo/redo, the preview's colour mode and replay, the billet's language, the
 *   save and publish status, sign-in for a guest, and "Share";
 * - medium: the title, undo/redo, the status as icons, "Share", and "More" with the rest;
 * - narrow: a button that opens the rest in a side sheet, the title as text (it opens the sheet at
 *   the title field), undo/redo, and "Share" as an icon.
 *
 * Share stays disabled until the billet is in an account: a guest may sign in (and comes back to
 * this billet), a signed-in user's device billet points at the banner that takes it over; an
 * account billet's Share opens the share dialog. It is disabled by aria-disabled, so it keeps the
 * focus and its tooltip can say why. The title is the editor's own field, so its message renders
 * here (on a phone, in the sheet).
 */
@Component({
  selector: 'app-editor-toolbar',
  imports: [
    BilletText,
    EditorSaveStatus,
    EditorToolbarMenu,
    EditorToolbarSheet,
    EditorToolbarTools,
    FieldError,
    FormField,
    RouterLink,
    TooltipAnchor,
    TranslatePipe,
  ],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
  host: {
    class: 'ui-editor-bar',
    '[class]': "'editor-toolbar--' + layout()",
  },
})
export class EditorToolbar {
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
  readonly layout = input.required<EditorLayout>();
  readonly canUndo = input.required<boolean>();
  readonly canRedo = input.required<boolean>();
  readonly saveIndicator = input.required<SaveIndicator>();
  readonly shareMode = input.required<ShareMode>();
  /** Where a guest's sign-in returns to. */
  readonly returnUrl = input<string | null>(null);
  /** An account billet's publish state; null for a billet on this device. */
  readonly shareFacts = input<ShareFacts | null>(null);
  readonly previewMode = model<PreviewMode>('auto');

  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly replay = output<void>();
  readonly share = output<void>();

  protected readonly narrow = computed(() => this.layout() === 'narrow');
  protected readonly guest = computed(() => this.shareMode() === 'guest');
  protected readonly shareView = computed(() => SHARE_VIEWS[this.shareMode()]);
  /** The wide row has room for sign-in; elsewhere it is in "More" or in the sheet. */
  protected readonly signIn = computed(() => this.layout() === 'wide' && this.guest());
  protected readonly statusVariant = computed(() =>
    this.layout() === 'medium' ? 'icons' : 'stacked',
  );
  protected readonly title = computed(() => this.billetForm().title().value().trim());
  protected readonly lang = computed(() => this.billetForm().lang().value());
  /** A save that failed or is held: on a phone, a dot on the button to the sheet that says it. */
  protected readonly saveAlert = computed(() => {
    const { tone, key } = this.saveIndicator();
    return tone === 'alert' ? key : null;
  });

  /** The phone's side sheet, and whether it opens at the title field. */
  protected readonly sheetOpen = signal(false);
  protected readonly sheetAtTitle = signal(false);

  /**
   * What the live region reads: a save that fails or is held, and the first save after it. The
   * routine "saving" and "saved" of every pause in typing stay visual only.
   */
  protected readonly announcement = linkedSignal<SaveIndicator, string>({
    source: this.saveIndicator,
    computation: ({ tone, key }, previous) => {
      const spoken = previous?.value ?? '';
      if (tone === 'alert') return key;
      if (tone === 'busy') return spoken;
      return spoken !== '' && spoken !== key ? key : '';
    },
  });

  protected openSheet(atTitle: boolean): void {
    this.sheetAtTitle.set(atTitle);
    this.sheetOpen.set(true);
  }

  protected onShare(): void {
    if (this.shareView().hintKey === null) this.share.emit();
  }
}
