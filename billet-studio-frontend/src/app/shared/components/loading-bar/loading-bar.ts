import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { isLoading } from '../../../core/interceptors/loading-interceptor';

/**
 * The global activity bar: thin, indeterminate, on the site header's bottom edge (the app shell
 * places it). loadingInterceptor owns when it shows (after 300 ms, at least 400 ms); this only
 * renders it, and it is the only component that reads isLoading. Idle it is transparent and hidden
 * from assistive tech; it never takes layout space.
 */
@Component({
  selector: 'app-loading-bar',
  imports: [TranslatePipe],
  template: `
    <div
      class="ui-progress"
      role="progressbar"
      [class.ui-progress--active]="active()"
      [attr.aria-label]="'COMMON.LOADING' | translate"
      [attr.aria-busy]="active() ? 'true' : null"
      [attr.aria-hidden]="active() ? null : 'true'"
    >
      <span class="ui-progress__bar"></span>
      <span class="ui-progress__bar ui-progress__bar--short"></span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class LoadingBar {
  protected readonly active = isLoading;
}
