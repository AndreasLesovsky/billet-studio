import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { isLoading } from '../../../core/interceptors/loading-interceptor';

/**
 * The global loading indicator. loadingInterceptor owns when it shows (after 250 ms, at least
 * 400 ms); this only renders it. It does not block the page: a slow request is no reason to take
 * the rest of the UI away. The status region is always there, so screen readers hear "Loading"
 * when the pill appears.
 */
@Component({
  selector: 'app-spinner',
  imports: [TranslatePipe],
  template: `
    <div class="spinner" role="status">
      @if (isLoading()) {
        <div class="ui-popover spinner__pill">
          <span class="ui-spinner ui-spinner--sm" aria-hidden="true"></span>
          {{ 'COMMON.LOADING' | translate }}
        </div>
      }
    </div>
  `,
  styleUrl: './spinner.scss',
})
export class Spinner {
  protected readonly isLoading = isLoading;
}
