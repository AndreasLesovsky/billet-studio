import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Unknown routes, inside the shell, and share links that lead nowhere, in the bare layout (where
 * there is no breadcrumb, so the page links home itself).
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="ui-container">
      <div class="ui-page not-found">
        <p class="ui-hint not-found__code" aria-hidden="true">404</p>
        <header class="ui-page__header">
          <h1 class="ui-page__title">{{ 'NOT_FOUND.TITLE' | translate }}</h1>
          <p class="ui-page__lead">{{ 'NOT_FOUND.TEXT' | translate }}</p>
        </header>
        <div class="ui-cluster">
          <a class="ui-btn ui-btn--primary" routerLink="/">{{
            'NOT_FOUND.HOME_LINK' | translate
          }}</a>
        </div>
      </div>
    </div>
  `,
  styles: `
    .not-found {
      align-items: flex-start;
    }

    .not-found__code {
      font-family: var(--ui-font-heading);
      font-size: calc(var(--ui-text-3xl) * 2 * var(--ui-font-heading-scale));
      font-weight: var(--ui-font-heading-weight);
      line-height: 1;
    }
  `,
})
export class NotFound {}
