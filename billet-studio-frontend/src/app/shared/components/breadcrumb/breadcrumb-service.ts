import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

export interface BreadcrumbItem {
  name: string;
  /** Absolute; the active crumb keeps its url too, it is simply not rendered as a link. */
  url: string;
  active: boolean;
  /** A crumb whose label is set at runtime (`breadcrumbDynamic`); hidden until the label arrives. */
  dynamic?: boolean;
}

/**
 * The trail of the current route, built from each route's OWN `data.breadcrumb` (a translate key;
 * routeConfig.data, so a key is never inherited by an empty-path child). Detail pages mark their
 * crumb `breadcrumbDynamic: true` and name it via setDynamicLabel (a billet title, a user name).
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  private readonly routeItems = signal<BreadcrumbItem[]>([]);

  /** Runtime labels keyed by position from the end: 0 = the last crumb. Reset on navigation. */
  private readonly dynamicLabels = signal<ReadonlyMap<number, string>>(new Map());

  readonly items = computed<BreadcrumbItem[]>(() => {
    const crumbs = this.routeItems();
    const labels = this.dynamicLabels();
    if (crumbs.length === 0) return crumbs;

    // No label yet: show the static prefix only, its last crumb active, rather than a raw route
    // label flashing in the place of a title.
    if (labels.size === 0) {
      const firstDynamic = crumbs.findIndex((c) => c.dynamic);
      if (firstDynamic <= 0) return crumbs;
      const visible = crumbs.slice(0, firstDynamic);
      visible[visible.length - 1] = { ...visible[visible.length - 1], active: true };
      return visible;
    }

    const labelled = [...crumbs];
    for (const [fromEnd, label] of labels) {
      const index = labelled.length - 1 - fromEnd;
      if (index >= 0) labelled[index] = { ...labelled[index], name: label };
    }
    return labelled;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => {
        this.dynamicLabels.set(new Map());
        this.build();
      });

    // A language switch relabels the trail but keeps the runtime labels (they are data, not keys).
    this.translate.onLangChange.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.build());

    // The service may first be injected after the navigation that rendered its host has ended.
    this.build();
  }

  /** Names the last crumb (or the one `fromEnd` steps before it). */
  setDynamicLabel(label: string, fromEnd = 0): void {
    this.dynamicLabels.update((labels) => new Map(labels).set(fromEnd, label));
  }

  private build(): void {
    const crumbs: BreadcrumbItem[] = [];
    const segments: string[] = [];
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;

    while (route) {
      segments.push(...route.url.map((s) => s.path));
      const own = route.routeConfig?.data;
      const key = own?.['breadcrumb'];
      if (typeof key === 'string') {
        crumbs.push({
          name: this.translate.instant(key),
          url: '/' + segments.join('/'),
          active: false,
          dynamic: own?.['breadcrumbDynamic'] === true,
        });
      }
      route = route.firstChild;
    }

    if (crumbs.length > 0) crumbs[crumbs.length - 1].active = true;
    this.routeItems.set(crumbs);
  }
}
