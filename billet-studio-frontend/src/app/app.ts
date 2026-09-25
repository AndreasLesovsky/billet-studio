import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ThemeService } from './core/theme/theme-service';
import { ConfirmationModal } from './shared/components/confirmation-modal/confirmation-modal';
import { Spinner } from './shared/components/spinner/spinner';
import { Toast } from './shared/components/toast/toast';

/**
 * The layouts are routes (AppShell, BareLayout); what every page shares regardless of layout lives
 * here: toasts, the global spinner and the one confirmation dialog.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast, Spinner, ConfirmationModal],
  templateUrl: './app.html',
})
export class App {
  constructor() {
    // Created at startup, not when the picker first renders: it follows prefers-color-scheme and
    // other tabs' choices only while it exists.
    inject(ThemeService);
  }
}
