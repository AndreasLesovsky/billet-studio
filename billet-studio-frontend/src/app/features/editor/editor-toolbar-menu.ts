import {
  CdkMenu,
  CdkMenuGroup,
  CdkMenuItem,
  CdkMenuItemRadio,
  CdkMenuTrigger,
} from '@angular/cdk/menu';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import { Component, inject, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletLang } from '../../billet/billet-document';
import { EditorCommands } from './editor-commands';
import { LANG_OPTIONS, PREVIEW_MODES, type PreviewMode } from './editor-toolbar-options';

/** Below the trigger, right edges aligned; above it when there is no room below. */
const MENU_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
];

/**
 * The medium toolbar's "More" (CDK menu: arrow keys, typeahead, Esc, focus back to the trigger): the
 * preview's colour mode and the billet's language as radio items, replay, and sign-in for a guest.
 */
@Component({
  selector: 'app-editor-toolbar-menu',
  imports: [
    CdkMenu,
    CdkMenuGroup,
    CdkMenuItem,
    CdkMenuItemRadio,
    CdkMenuTrigger,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './editor-toolbar-menu.html',
  styles: `
    :host {
      display: contents;
    }

    .editor-toolbar-menu__panel {
      margin-block: var(--ui-space-2);
    }
  `,
})
export class EditorToolbarMenu {
  private readonly commands = inject(EditorCommands);

  readonly lang = input.required<BilletLang>();
  /** A guest's menu ends with sign-in, which comes back to `returnUrl`. */
  readonly guest = input.required<boolean>();
  readonly returnUrl = input<string | null>(null);
  readonly previewMode = model.required<PreviewMode>();

  readonly replay = output<void>();

  protected readonly previewModes = PREVIEW_MODES;
  protected readonly langs = LANG_OPTIONS;
  protected readonly positions = MENU_POSITIONS;

  /** The menu lies outside the editor's element, so its choice is committed as an undo step. */
  protected setLang(lang: BilletLang): void {
    this.commands.commit((document) => (document.lang === lang ? document : { ...document, lang }));
  }
}
