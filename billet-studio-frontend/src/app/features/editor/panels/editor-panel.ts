import { Directive, input } from '@angular/core';
import type { FieldTree } from '@angular/forms/signals';

import type { BilletDocument } from '../../../billet/billet-document';

/**
 * What the editor hands every panel: `<app-x-panel [billetForm]="billetForm" [document]="model()" />`.
 * Fields bind to `billetForm` with [formField]; a change that is more than one field, or must be an
 * undo step of its own, goes through `inject(EditorCommands).commit(...)`.
 */
@Directive()
export abstract class EditorPanel {
  /** The editor's whole form (root field tree). */
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
  /** The current document, the value of billetForm. */
  readonly document = input.required<BilletDocument>();
}
