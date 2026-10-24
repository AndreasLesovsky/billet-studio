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
  untracked,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminBilletDto, PageDto } from '../../../core/models/models';
import {
  AdminBilletApi,
  BilletListQuery,
  BilletSortField,
} from '../../../core/services/admin-billet-api';
import { LanguageService } from '../../../core/services/language-service';
import { BilletLink } from './billet-link/billet-link';
import { BilletListSkeleton } from './billet-list-skeleton';
import {
  BilletFilterModel,
  filtered,
  parseBilletListQuery,
  sameFilter,
  sortedBy,
  toFilterModel,
  toQueryParams,
} from './billet-list-schema';
import { BilletStatus } from './billet-status/billet-status';

const SEARCH_DEBOUNCE_MS = 300;

type ShownPage = PageDto<AdminBilletDto>;
type AriaSort = 'ascending' | 'descending' | 'none';

const SORT_ICONS: Record<AriaSort, string> = {
  ascending: 'bi-sort-up',
  descending: 'bi-sort-down',
  none: 'bi-arrow-down-up',
};

interface Column {
  label: string;
  /** The API sort field, or null for a column that does not sort. */
  field: BilletSortField | null;
}

const COLUMNS: readonly Column[] = [
  { label: 'ADMIN_BILLETS.COL_TITLE', field: 'title' },
  { label: 'ADMIN_BILLETS.COL_OWNER', field: 'owner' },
  { label: 'ADMIN_BILLETS.COL_STATUS', field: null },
  { label: 'ADMIN_BILLETS.COL_LINK', field: null },
  { label: 'ADMIN_BILLETS.COL_UPDATED', field: 'updatedAt' },
  { label: 'ADMIN_BILLETS.COL_CREATED', field: 'createdAt' },
];

/**
 * The read-only admin overview of every user's billets: who made what, and the link of each
 * published one. There is deliberately no detail view; a published billet's link is the same one
 * its owner shares. Its state (page, search, status filter, sort) is the URL, like the user list.
 */
@Component({
  selector: 'app-billet-list',
  imports: [BilletLink, BilletListSkeleton, BilletStatus, DatePipe, FormField, TranslatePipe],
  templateUrl: './billet-list.html',
  styleUrl: './billet-list.scss',
})
export class BilletList {
  private readonly adminBilletApi = inject(AdminBilletApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly locale = inject(LanguageService).locale;
  protected readonly columns = COLUMNS;
  protected readonly columnLabels = COLUMNS.map((column) => column.label);

  readonly page = input<string>();
  readonly q = input<string>();
  readonly published = input<string>();
  readonly sort = input<string>();
  readonly dir = input<string>();

  readonly query = computed(() =>
    parseBilletListQuery({
      page: this.page(),
      q: this.q(),
      published: this.published(),
      sort: this.sort(),
      dir: this.dir(),
    }),
  );

  protected readonly billets = resource({
    params: this.query,
    loader: ({ params }) => this.adminBilletApi.list(params),
  });

  /** The last page that arrived, so paging and sorting do not blank the table while loading. */
  readonly shown = linkedSignal<ShownPage | undefined, ShownPage | null>({
    source: () => (this.billets.hasValue() ? this.billets.value() : undefined),
    computation: (page, previous) => page ?? previous?.value ?? null,
  });

  /** Nothing to show and the last request failed: the page offers a retry instead of a skeleton. */
  readonly failed = computed(() => this.shown() === null && this.billets.status() === 'error');

  readonly pageCount = computed(() => {
    const shown = this.shown();
    return shown ? Math.max(1, Math.ceil(shown.totalRows / shown.size)) : 1;
  });
  /** 1-based, as the pager and the URL count. */
  readonly pageNumber = computed(() => this.query().page + 1);
  readonly hasPrevious = computed(() => this.query().page > 0);
  readonly hasNext = computed(() => this.pageNumber() < this.pageCount());

  /** This list's last filter change and the query it replaced, to recognise its echo in the URL. */
  private pushed: { from: BilletListQuery; filter: BilletFilterModel } | null = null;

  /** The filter bar, seeded from the URL; kept while typing, replaced by any other URL change. */
  readonly model = linkedSignal<BilletListQuery, BilletFilterModel>({
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

  private filterTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.filterTimer));

    // A page past the end (an old link, billets deleted meanwhile) moves to the last page there is.
    effect(() => {
      const shown = this.shown();
      const lastPage = this.pageCount() - 1;
      if (shown && shown.rows.length === 0 && shown.page > lastPage) {
        untracked(() => this.go({ ...this.query(), page: lastPage }, true));
      }
    });
  }

  ariaSort(field: BilletSortField): AriaSort {
    const query = this.query();
    if (query.sort !== field) return 'none';
    return query.direction === 'asc' ? 'ascending' : 'descending';
  }

  sortIcon(field: BilletSortField): string {
    return SORT_ICONS[this.ariaSort(field)];
  }

  sortBy(field: BilletSortField): void {
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
    this.billets.reload();
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
  private go(next: BilletListQuery, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next),
      replaceUrl,
    });
  }
}
