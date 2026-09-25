import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ColorModeService } from './core/theme/color-mode-service';
import { ConfirmationModal } from './shared/components/confirmation-modal/confirmation-modal';
import { Toast } from './shared/components/toast/toast';

/**
 * The layouts are routes (AppShell, BareLayout); what every page shares regardless of layout lives
 * here: toasts and the one confirmation dialog. The global activity bar belongs to the site header
 * (AppShell).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast, ConfirmationModal],
  templateUrl: './app.html',
})
export class App {
  constructor() {
    // Created at startup, not when the colour-mode menu first renders: it follows
    // prefers-color-scheme and other tabs' choices only while it exists.
    inject(ColorModeService);
  }
}
