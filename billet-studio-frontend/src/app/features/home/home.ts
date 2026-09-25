import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthApi } from '../../core/services/auth-api';
import { injectTemplateCards } from '../../core/utils/template-cards';
import { AssetThumb } from '../../shared/components/asset-thumb/asset-thumb';

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

/** The teaser row fits five cards; the gallery at /templates shows them all. */
const TEASER_COUNT = 5;

/**
 * Landing page: hero, a teaser row of templates that leads to /templates, and how it works.
 * "New billet" stays visible but disabled until the editor exists.
 */
@Component({
  selector: 'app-home',
  imports: [AssetThumb, RouterLink, TranslatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly isLoggedIn = inject(AuthApi).isLoggedIn;
  protected readonly steps = STEPS;

  private readonly templateCards = injectTemplateCards();
  protected readonly templates = computed(() => this.templateCards().slice(0, TEASER_COUNT));
}
