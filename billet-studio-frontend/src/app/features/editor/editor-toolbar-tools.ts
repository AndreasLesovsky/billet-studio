import { Component, computed, input, model, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import { LANG_OPTIONS, PREVIEW_MODES, type PreviewMode } from './editor-toolbar-options';

/**
 * The preview's colour mode and replay, and the billet's language: in the wide toolbar's row
 * (labels visually hidden), or `stacked` in the phone's side sheet (labels above the controls).
 * The host takes no box, so the controls sit in whatever row or stack holds it.
 */
@Component({
  selector: 'app-editor-toolbar-tools',
  imports: [FormField, TranslatePipe],
  templateUrl: './editor-toolbar-tools.html',
  styleUrl: './editor-toolbar-tools.scss',
})
export class EditorToolbarTools {
  readonly billetForm = input.required<FieldTree<BilletDocument>>();
  readonly stacked = input(false);
  readonly previewMode = model.required<PreviewMode>();

  readonly replay = output<void>();

  protected readonly previewModes = PREVIEW_MODES;
  protected readonly langs = LANG_OPTIONS;
  protected readonly labelClass = computed(() =>
    this.stacked() ? 'ui-label' : 'ui-visually-hidden',
  );
}
