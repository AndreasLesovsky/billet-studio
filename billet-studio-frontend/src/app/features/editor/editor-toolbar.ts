import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { BILLET_LANGS, type BilletDocument } from '../../billet/billet-document';
import { FieldError } from '../../shared/components/field-error/field-error';
import { PublishBadge } from '../../shared/components/share-dialog/publish-badge';
import type { ShareFacts } from '../../shared/components/share-dialog/share-state';
import { BilletText } from './billet-text';
import type { SaveIndicator, ShareMode } from './editor-session';

export type PreviewMode = 'auto' | 'light' | 'dark';

const PREVIEW_MODES: readonly { readonly mode: PreviewMode; readonly labelKey: string }[] = [
  { mode: 'auto', labelKey: 'EDITOR.MODE_AUTO' },
  { mode: 'light', labelKey: 'EDITOR.MODE_LIGHT' },
  { mode: 'dark', labelKey: 'EDITOR.MODE_DARK' },
];

const LANGUAGE_KEYS = { de: 'NAV.LANGUAGE_DE', en: 'NAV.LANGUAGE_EN' } as const;

interface ShareView {
  /** Why Share is disabled; null when it opens the share dialog. */
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
 * The editor's top bar: the billet's title, undo/redo, the preview's colour mode and replay, the
 * billet's language, the save and publish status and "Share". Share stays disabled until the
 * billet is in an account: a guest may sign in (and comes back to this billet), a signed-in user's
 * device billet points at the banner that takes it over; an account billet's Share opens the share
 * dialog. The title is the editor's own field, so its message renders here.
 */
@Component({
  selector: 'app-editor-toolbar',
  imports: [BilletText, FieldError, FormField, PublishBadge, RouterLink, TranslatePipe],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
  host: { class: 'ui-editor-bar ui-cluster' },
})
export class EditorToolbar {
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
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

  protected readonly previewModes = PREVIEW_MODES;
  protected readonly langs = BILLET_LANGS.map((lang) => ({ lang, labelKey: LANGUAGE_KEYS[lang] }));
  protected readonly shareView = computed(() => SHARE_VIEWS[this.shareMode()]);

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
}
