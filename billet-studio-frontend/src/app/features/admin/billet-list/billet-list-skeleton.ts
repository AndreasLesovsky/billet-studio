import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Half a page of rows. */
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * The billet overview while its first page loads (CLAUDE.md, "Loading states"): the count line,
 * the header with the real column names, rows and the pager, in BilletList's layout (its
 * stylesheet), so nothing moves when the page arrives.
 */
@Component({
  selector: 'app-billet-list-skeleton',
  imports: [TranslatePipe],
  template: `
    <div class="ui-stack">
      <span class="ui-hint ui-skeleton ui-skeleton--text billet-list__skeleton-cell"></span>
      <div class="ui-table-wrap">
        <table class="ui-table">
          <thead>
            <tr>
              @for (label of columns(); track label) {
                <th>{{ label | translate }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows; track row) {
              <tr>
                @for (label of columns(); track label) {
                  <td>
                    <span class="ui-skeleton ui-skeleton--text billet-list__skeleton-cell"></span>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="billet-list__pager">
        <span class="ui-skeleton ui-skeleton--button ui-skeleton--sm"></span>
        <span class="ui-hint ui-skeleton ui-skeleton--text billet-list__skeleton-cell"></span>
        <span class="ui-skeleton ui-skeleton--button ui-skeleton--sm"></span>
      </div>
    </div>
  `,
  styleUrls: ['./billet-list.scss'],
  styles: `
    .billet-list__skeleton-cell {
      display: inline-block;
      inline-size: 6rem;
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class BilletListSkeleton {
  /** The columns' header keys, in table order. */
  readonly columns = input.required<readonly string[]>();

  protected readonly rows = ROWS;
}
