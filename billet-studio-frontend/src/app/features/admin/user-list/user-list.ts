import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PageDto, UserResponseDto } from '../../../core/models/models';
import { AdminUserApi, UserListQuery, UserSortField } from '../../../core/services/admin-user-api';
import { AuthApi } from '../../../core/services/auth-api';
import { LanguageService } from '../../../core/services/language-service';
import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { LockUserDialog } from './lock-user-dialog/lock-user-dialog';
import { UserListSkeleton } from './user-list-skeleton';
import { UserName } from './user-name/user-name';
import { UserStatus } from './user-status/user-status';
import {
  filtered,
  parseUserListQuery,
  sameFilter,
  sortedBy,
  toFilterModel,
  toQueryParams,
  UserFilterModel,
} from './user-list-schema';

const SEARCH_DEBOUNCE_MS = 300;

const PROTECTED_HINT_ID = 'user-list-protected-hint';
const SELF_HINT_ID = 'user-list-self-hint';

type ShownPage = PageDto<UserResponseDto>;
type AriaSort = 'ascending' | 'descending' | 'none';

const SORT_ICONS: Record<AriaSort, string> = {
  ascending: 'bi-sort-up',
  descending: 'bi-sort-down',
  none: 'bi-arrow-down-up',
};

interface Column {
  label: string;
  /** The API sort field, or null for a column that does not sort. */
  field: UserSortField | null;
}

const COLUMNS: readonly Column[] = [
  { label: 'ADMIN_USERS.COL_NAME', field: 'name' },
  { label: 'ADMIN_USERS.COL_EMAIL', field: 'email' },
  { label: 'ADMIN_USERS.COL_ROLE', field: 'role' },
  { label: 'ADMIN_USERS.COL_STATUS', field: null },
  { label: 'ADMIN_USERS.COL_CREATED', field: 'createdAt' },
];

/**
 * The admin user table. Its state (page, search, status filter, sort) is the URL: the router binds
 * the query params to the inputs below, every change navigates, and the list follows.
 */
@Component({
  selector: 'app-user-list',
  imports: [
    DatePipe,
    FormField,
    LockUserDialog,
    RouterLink,
    TranslatePipe,
    UserListSkeleton,
    UserName,
    UserStatus,
  ],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserList {
  private readonly adminUserApi = inject(AdminUserApi);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly translate = inject(TranslateService);

  protected readonly locale = inject(LanguageService).locale;
  protected readonly columns = COLUMNS;
  protected readonly columnLabels = COLUMNS.map((column) => column.label);
  protected readonly protectedHintId = PROTECTED_HINT_ID;
  protected readonly selfHintId = SELF_HINT_ID;

  readonly page = input<string>();
  readonly q = input<string>();
  readonly active = input<string>();
  readonly sort = input<string>();
  readonly dir = input<string>();

  readonly query = computed(() =>
    parseUserListQuery({
      page: this.page(),
      q: this.q(),
      active: this.active(),
      sort: this.sort(),
      dir: this.dir(),
    }),
  );

  protected readonly users = resource({
    params: this.query,
    loader: ({ params }) => this.adminUserApi.list(params),
  });

  /** The last page that arrived, so paging and sorting do not blank the table while loading. */
  readonly shown = linkedSignal<ShownPage | undefined, ShownPage | null>({
    source: () => (this.users.hasValue() ? this.users.value() : undefined),
    computation: (page, previous) => page ?? previous?.value ?? null,
  });

  /** Nothing to show and the last request failed: the page offers a retry instead of a skeleton. */
  readonly failed = computed(() => this.shown() === null && this.users.status() === 'error');

  readonly pageCount = computed(() => {
    const shown = this.shown();
    return shown ? Math.max(1, Math.ceil(shown.totalRows / shown.size)) : 1;
  });
  /** 1-based, as the pager and the URL count. */
  readonly pageNumber = computed(() => this.query().page + 1);
  readonly hasPrevious = computed(() => this.query().page > 0);
  readonly hasNext = computed(() => this.pageNumber() < this.pageCount());

  /** This list's last filter change and the query it replaced, to recognise its echo in the URL. */
  private pushed: { from: UserListQuery; filter: UserFilterModel } | null = null;

  /**
   * The filter bar, seeded from the URL. It keeps what is typed when the URL changes only its page
   * or sort, or when the change is the echo of this bar's own navigation (typing may have gone on
   * meanwhile); any other change of the URL's filter (back button, a link) replaces it.
   */
  readonly model = linkedSignal<UserListQuery, UserFilterModel>({
    source: this.query,
    computation: (query, previous) => {
      if (!previous) return toFilterModel(query);
      const filterUnchanged = sameFilter(query, toFilterModel(previous.source));
      const ownEcho =
        this.pushed?.from === previous.source && sameFilter(query, this.pushed.filter);
      return filterUnchanged || ownEcho ? previous.value : toFilterModel(query);
    },
  });
  readonly filterForm = form(this.model);

  /** The account the lock dialog asks about; null = closed. */
  readonly lockTarget = signal<UserResponseDto | null>(null);

  private readonly ownId = computed(() => this.authApi.user()?.id);
  private filterTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.filterTimer));

    // A page past the end (its last row just deleted, an old link) moves to the last page there is.
    effect(() => {
      const shown = this.shown();
      const lastPage = this.pageCount() - 1;
      if (shown && shown.rows.length === 0 && shown.page > lastPage) {
        untracked(() => this.go({ ...this.query(), page: lastPage }, true));
      }
    });
  }

  isSelf(user: UserResponseDto): boolean {
    return user.id === this.ownId();
  }

  /** The root account is managed by the environment; the backend refuses every change to it. */
  canEdit(user: UserResponseDto): boolean {
    return !user.protectedAccount;
  }

  /** Nobody locks or deletes their own account from here (the backend refuses it too). */
  canLockOrDelete(user: UserResponseDto): boolean {
    return !user.protectedAccount && !this.isSelf(user);
  }

  /** The edit page of a row, or null (no link) for the root account. */
  editLink(user: UserResponseDto): (string | number)[] | null {
    return this.canEdit(user) ? ['/admin/users', user.id] : null;
  }

  lockLabel(user: UserResponseDto): string {
    return user.active ? 'ADMIN_USERS.LOCK' : 'ADMIN_USERS.UNLOCK';
  }

  lockIcon(user: UserResponseDto): string {
    return user.active ? 'bi-lock' : 'bi-unlock';
  }

  /** Why the row's edit action is disabled, as the id of the text that says so. */
  editHint(user: UserResponseDto): string | null {
    return user.protectedAccount ? PROTECTED_HINT_ID : null;
  }

  /** Why the row's lock and delete actions are disabled, as the id of the text that says so. */
  lockOrDeleteHint(user: UserResponseDto): string | null {
    if (user.protectedAccount) return PROTECTED_HINT_ID;
    return this.isSelf(user) ? SELF_HINT_ID : null;
  }

  ariaSort(field: UserSortField): AriaSort {
    const query = this.query();
    if (query.sort !== field) return 'none';
    return query.direction === 'asc' ? 'ascending' : 'descending';
  }

  sortIcon(field: UserSortField): string {
    return SORT_ICONS[this.ariaSort(field)];
  }

  sortBy(field: UserSortField): void {
    this.go(sortedBy(this.query(), field));
  }

  goToPage(page: number): void {
    this.go({ ...this.query(), page });
  }

  previousPage(): void {
    this.goToPage(this.query().page - 1);
  }

  nextPage(): void {
    this.goToPage(this.query().page + 1);
  }

  retry(): void {
    this.users.reload();
  }

  onSearchInput(): void {
    this.scheduleFilter(SEARCH_DEBOUNCE_MS);
  }

  onStatusChange(): void {
    this.scheduleFilter(0);
  }

  onFilterSubmit(event: Event): void {
    event.preventDefault();
    this.scheduleFilter(0);
  }

  toggleActive(user: UserResponseDto): void {
    if (!this.canLockOrDelete(user)) return;
    if (user.active) {
      this.lockTarget.set(user);
      return;
    }
    this.confirmation.open({
      title: this.translate.instant('ADMIN_USERS.UNLOCK_TITLE'),
      message: this.translate.instant('ADMIN_USERS.UNLOCK_MESSAGE', { name: user.name }),
      confirmLabel: this.translate.instant('ADMIN_USERS.UNLOCK'),
      pendingLabel: this.translate.instant('COMMON.PENDING.UNLOCKING'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      confirmVariant: 'primary',
      onConfirm: async () => {
        await this.adminUserApi.toggleActive(user.id, null);
        this.users.reload();
      },
    });
  }

  confirmDelete(user: UserResponseDto): void {
    if (!this.canLockOrDelete(user)) return;
    this.confirmation.open({
      title: this.translate.instant('ADMIN_USERS.DELETE_TITLE'),
      message: this.translate.instant('ADMIN_USERS.DELETE_MESSAGE', { name: user.name }),
      confirmLabel: this.translate.instant('COMMON.DELETE'),
      pendingLabel: this.translate.instant('COMMON.PENDING.DELETING'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      confirmVariant: 'danger',
      onConfirm: async () => {
        await this.adminUserApi.delete(user.id);
        this.users.reload();
      },
    });
  }

  onLocked(): void {
    this.users.reload();
  }

  private scheduleFilter(delay: number): void {
    clearTimeout(this.filterTimer);
    // Read when it fires: the control has written the model by then, whatever the listener order.
    this.filterTimer = setTimeout(() => {
      const query = this.query();
      const filter = this.model();
      if (sameFilter(query, filter)) return;
      this.pushed = { from: query, filter };
      this.go(filtered(query, filter), true);
    }, delay);
  }

  /** Filters replace the history entry (one per keystroke pause would bury the back button). */
  private go(next: UserListQuery, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next),
      replaceUrl,
    });
  }
}
