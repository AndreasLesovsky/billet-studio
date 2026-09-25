import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthApi } from '../../../core/services/auth-api';
import { UserAvatar } from '../user-avatar/user-avatar';

/** Below the trigger, right edges aligned; above it when there is no room below. */
const MENU_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
];

/**
 * The header's account dropdown (CDK menu: arrow keys, typeahead, Esc, focus back to the trigger).
 * Signed out: sign in / sign up. Signed in: account, user management for admins, sign out.
 *
 * The admin entry is hidden rather than disabled for everyone else: it is a matter of permission,
 * not of state, and the route refuses them anyway. The login entry deliberately carries no
 * returnUrl: the header has no intent to return to, so the role's landing page decides.
 */
@Component({
  selector: 'app-account-menu',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, RouterLink, TranslatePipe, UserAvatar],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.scss',
})
export class AccountMenu {
  private readonly authApi = inject(AuthApi);

  protected readonly user = this.authApi.user;
  protected readonly isAdmin = computed(() => this.authApi.role() === 'ROLE_ADMIN');
  protected readonly positions = MENU_POSITIONS;

  protected logout(): void {
    void this.authApi.logout();
  }
}
