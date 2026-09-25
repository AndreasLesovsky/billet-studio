import { CdkTrapFocus } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { siteName } from '../../core/environments/environment';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Breadcrumb } from '../../shared/components/breadcrumb/breadcrumb';
import {
  BreadcrumbItem,
  BreadcrumbService,
} from '../../shared/components/breadcrumb/breadcrumb-service';
import { LanguageSwitch } from '../../shared/components/language-switch/language-switch';
import { ThemePicker } from '../../shared/components/theme-picker/theme-picker';

/** Below the theme button, right edges aligned; above it when there is no room below. */
const THEME_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
];

/**
 * The chrome around every page except the shared billet (see BareLayout): header with wordmark,
 * main navigation, language switch, theme popover and account menu; the breadcrumb above the routed
 * page; a minimal footer.
 *
 * The theme popover is a non-modal dialog in a CDK overlay. Focus moves into it and is kept there
 * until Esc, the close button or a click outside closes it; then it goes back to the theme button.
 */
@Component({
  selector: 'app-shell',
  imports: [
    AccountMenu,
    Breadcrumb,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    CdkTrapFocus,
    LanguageSwitch,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    ThemePicker,
    TranslatePipe,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly themeOpen = signal(false);
  protected readonly themePositions = THEME_POSITIONS;
  /** CDK takes px: the page gutter (1rem at the default root size) kept free when it pushes. */
  protected readonly themeViewportMargin = 16;
  protected readonly year = new Date().getFullYear();

  constructor() {
    // The page title follows the breadcrumb: translated, relabelled on a language switch, and it
    // carries the runtime labels of detail pages (a user's name) too.
    const title = inject(Title);
    const crumbs = inject(BreadcrumbService).items;
    effect(() => title.setTitle(pageTitle(crumbs())));
  }

  protected toggleTheme(): void {
    this.themeOpen.update((open) => !open);
  }

  protected closeTheme(): void {
    this.themeOpen.set(false);
  }

  /** CDK closes on keyCode 27 only; some synthetic and assistive-tech events carry just the key. */
  protected onThemeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closeTheme();
  }
}

/** "<page> – <site>"; the home page (a single crumb) is the site name alone. */
function pageTitle(crumbs: BreadcrumbItem[]): string {
  return crumbs.length > 1 ? `${crumbs[crumbs.length - 1].name} – ${siteName}` : siteName;
}
