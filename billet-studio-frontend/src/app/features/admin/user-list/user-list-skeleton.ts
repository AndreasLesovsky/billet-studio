import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Half a page of rows, each with its three actions (edit, lock, delete). */
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const ACTIONS = [0, 1, 2] as const;

/**
 * The user table while its first page loads (CLAUDE.md, "Loading states"): the count line, the
 * header with the real column names, rows with their action buttons and the pager, in UserList's
 * layout (its stylesheet), so nothing moves when the page arrives.
 */
@Component({
  selector: 'app-user-list-skeleton',
  imports: [TranslatePipe],
  templateUrl: './user-list-skeleton.html',
  styleUrls: ['./user-list.scss', './user-list-skeleton.scss'],
  host: { 'aria-hidden': 'true' },
})
export class UserListSkeleton {
  /** The data columns' header keys, in table order. */
  readonly columns = input.required<readonly string[]>();

  protected readonly rows = ROWS;
  protected readonly actions = ACTIONS;
}
