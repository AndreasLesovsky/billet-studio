import { Component, computed, inject, input, linkedSignal, model, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { BILLET_LANGS, type BilletDocument } from '../../billet/billet-document';
import { AuthApi } from '../../core/services/auth-api';
import type { LocalBilletErrorCode } from '../../core/services/local-billet-store';
import { FieldError } from '../../shared/components/field-error/field-error';
import { BilletText } from './billet-text';
import type { SaveStatus } from './editor-autosave';

export type PreviewMode = 'auto' | 'light' | 'dark';

const PREVIEW_MODES: readonly { readonly mode: PreviewMode; readonly labelKey: string }[] = [
  { mode: 'auto', labelKey: 'EDITOR.MODE_AUTO' },
  { mode: 'light', labelKey: 'EDITOR.MODE_LIGHT' },
  { mode: 'dark', labelKey: 'EDITOR.MODE_DARK' },
];

const LANGUAGE_KEYS = { de: 'NAV.LANGUAGE_DE', en: 'NAV.LANGUAGE_EN' } as const;

interface StatusView {
  readonly icon: string;
  readonly key: string;
  readonly className: string;
}

const SAVED_KEY = 'EDITOR.SAVE_STATUS.SAVED';

const STATUS_VIEWS: Readonly<Record<Exclude<SaveStatus, 'error'>, StatusView>> = {
  saved: { icon: 'bi-check2', key: SAVED_KEY, className: 'ui-hint' },
  pending: { icon: 'bi-hourglass-split', key: 'EDITOR.SAVE_STATUS.PENDING', className: 'ui-hint' },
  held: { icon: 'bi-pause-circle', key: 'EDITOR.SAVE_STATUS.HELD', className: 'ui-hint' },
};

/**
 * The editor's top bar: the billet's title, undo/redo, the preview's colour mode and replay, the
 * billet's language, the save status and "Share" (disabled until P7 publishes: a guest is told to
 * sign in). The title is the editor's own field, so its message renders here.
 */
@Component({
  selector: 'app-editor-toolbar',
  imports: [BilletText, FieldError, FormField, TranslatePipe],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
  host: { class: 'ui-editor-bar ui-cluster' },
})
export class EditorToolbar {
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
  readonly canUndo = input.required<boolean>();
  readonly canRedo = input.required<boolean>();
  readonly saveStatus = input.required<SaveStatus>();
  readonly saveFailure = input<LocalBilletErrorCode | null>(null);
  readonly previewMode = model<PreviewMode>('auto');

  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly replay = output<void>();

  protected readonly isLoggedIn = inject(AuthApi).isLoggedIn;
  protected readonly previewModes = PREVIEW_MODES;
  protected readonly langs = BILLET_LANGS.map((lang) => ({ lang, labelKey: LANGUAGE_KEYS[lang] }));

  protected readonly status = computed<StatusView>(() => {
    const status = this.saveStatus();
    if (status !== 'error') return STATUS_VIEWS[status];
    return {
      icon: 'bi-exclamation-triangle',
      key: `EDITOR.SAVE_STATUS.${this.saveFailure() ?? 'LOCAL_STORAGE_UNAVAILABLE'}`,
      className: 'ui-badge ui-badge--danger',
    };
  });

  /**
   * What the live region reads: a save that fails or is held, and the first save after it. The
   * routine "saving" and "saved" of every pause in typing stay visual only.
   */
  protected readonly announcement = linkedSignal<{ status: SaveStatus; key: string }, string>({
    source: () => ({ status: this.saveStatus(), key: this.status().key }),
    computation: ({ status, key }, previous) => {
      const spoken = previous?.value ?? '';
      if (status === 'error' || status === 'held') return key;
      if (status === 'pending') return spoken;
      return spoken !== '' && spoken !== SAVED_KEY ? SAVED_KEY : '';
    },
  });
}
