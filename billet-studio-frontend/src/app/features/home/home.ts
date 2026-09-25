import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthApi } from '../../core/services/auth-api';

interface Step {
  readonly icon: string;
  readonly titleKey: string;
  readonly textKey: string;
}

const STEPS: readonly Step[] = [
  {
    icon: 'bi-grid-1x2',
    titleKey: 'HOME.STEP_TEMPLATE_TITLE',
    textKey: 'HOME.STEP_TEMPLATE_TEXT',
  },
  { icon: 'bi-palette', titleKey: 'HOME.STEP_DESIGN_TITLE', textKey: 'HOME.STEP_DESIGN_TEXT' },
  { icon: 'bi-link-45deg', titleKey: 'HOME.STEP_SHARE_TITLE', textKey: 'HOME.STEP_SHARE_TEXT' },
];

/**
 * Landing page, a placeholder until the template gallery (P6) takes this route. "New billet" stays
 * visible but disabled until the editor exists.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly isLoggedIn = inject(AuthApi).isLoggedIn;
  protected readonly steps = STEPS;
}
