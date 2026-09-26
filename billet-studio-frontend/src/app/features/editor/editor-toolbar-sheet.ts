import { Component, input, model, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import { FieldError } from '../../shared/components/field-error/field-error';
import type { ShareFacts } from '../../shared/components/share-dialog/share-state';
import { Modal } from '../../shared/directives/modal';
import { BilletText } from './billet-text';
import { EditorSaveStatus } from './editor-save-status';
import type { PreviewMode } from './editor-toolbar-options';
import { EditorToolbarTools } from './editor-toolbar-tools';
import type { SaveIndicator } from './editor-session';

/**
 * The phone toolbar's side sheet (native modal <dialog>, .ui-dialog--sheet: focus trap, Esc and a
 * backdrop click close it, focus goes back to its opener): the billet's title, the preview's colour
 * mode and replay, the billet's language, and at its foot the save status in words and why Share
 * waits (a guest may sign in from here). It opens at the title field when the title was tapped
 * (`atTitle`), else at its close button, so no keyboard pops up unasked.
 */
@Component({
  selector: 'app-editor-toolbar-sheet',
  imports: [
    BilletText,
    EditorSaveStatus,
    EditorToolbarTools,
    FieldError,
    FormField,
    Modal,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './editor-toolbar-sheet.html',
  styles: `
    :host {
      display: contents;
    }

    .editor-toolbar-sheet__foot {
      flex-direction: column;
      align-items: stretch;
    }
  `,
})
export class EditorToolbarSheet {
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
  readonly open = model.required<boolean>();
  readonly atTitle = input(false);
  readonly saveIndicator = input.required<SaveIndicator>();
  readonly shareFacts = input<ShareFacts | null>(null);
  /** Why Share is disabled; null when it shares. */
  readonly shareHintKey = input<string | null>(null);
  /** A guest may sign in from here, and comes back to `returnUrl`. */
  readonly guest = input.required<boolean>();
  readonly returnUrl = input<string | null>(null);
  readonly previewMode = model.required<PreviewMode>();

  readonly replay = output<void>();

  protected close(): void {
    this.open.set(false);
  }

  /** The sheet gets out of the way, so the replay is seen. */
  protected replayAndClose(): void {
    this.open.set(false);
    this.replay.emit();
  }
}
