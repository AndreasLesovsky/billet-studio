import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockRouter, MockRouter } from '../../../../test-helpers';
import { BreadcrumbService } from './breadcrumb-service';

interface Node {
  path?: string;
  data?: Record<string, unknown>;
  /** What the router would inherit into `snapshot.data`; the service must ignore it. */
  inherited?: Record<string, unknown>;
  child?: Node;
}

function snapshot(node: Node): ActivatedRouteSnapshot {
  return {
    url: node.path ? node.path.split('/').map((path) => ({ path })) : [],
    routeConfig: { path: node.path ?? '', data: node.data },
    data: { ...node.inherited, ...node.data },
    firstChild: node.child ? snapshot(node.child) : null,
  } as unknown as ActivatedRouteSnapshot;
}

/** root → app shell ('' with HOME) → the given page. */
function shell(page: Node): ActivatedRouteSnapshot {
  return snapshot({ child: { data: { breadcrumb: 'BREADCRUMB.HOME' }, child: page } });
}

describe('BreadcrumbService', () => {
  let router: MockRouter;
  let language: Record<string, string>;
  let langChange: Subject<unknown>;

  function navigate(root: ActivatedRouteSnapshot): void {
    router.routerState.snapshot.root = root;
    router.events.next(new NavigationEnd(1, '/x', '/x'));
  }

  function create(root: ActivatedRouteSnapshot): BreadcrumbService {
    router.routerState.snapshot.root = root;
    return TestBed.inject(BreadcrumbService);
  }

  beforeEach(() => {
    router = createMockRouter();
    langChange = new Subject();
    language = {
      'BREADCRUMB.HOME': 'Start',
      'BREADCRUMB.BILLETS': 'Meine Billets',
      'BREADCRUMB.EDIT_BILLET': 'Billet bearbeiten',
      'BREADCRUMB.ADMIN_USERS': 'Benutzer',
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => language[key] ?? key, onLangChange: langChange },
        },
      ],
    });
  });

  const billetEditor = () =>
    shell({
      path: 'billets',
      data: { breadcrumb: 'BREADCRUMB.BILLETS' },
      child: {
        path: '7/edit',
        data: { breadcrumb: 'BREADCRUMB.EDIT_BILLET', breadcrumbDynamic: true },
      },
    });

  it('builds the trail from the current route at once, the last crumb active', () => {
    const service = create(
      shell({
        path: 'admin/users',
        data: { breadcrumb: 'BREADCRUMB.ADMIN_USERS' },
        child: { path: '', inherited: { breadcrumb: 'BREADCRUMB.ADMIN_USERS' } },
      }),
    );

    expect(service.items()).toEqual([
      { name: 'Start', url: '/', active: false, dynamic: false },
      { name: 'Benutzer', url: '/admin/users', active: true, dynamic: false },
    ]);
  });

  it('rebuilds on every navigation', () => {
    const service = create(shell({}));
    expect(service.items().map((c) => c.name)).toEqual(['Start']);

    navigate(shell({ path: 'billets', data: { breadcrumb: 'BREADCRUMB.BILLETS' } }));

    expect(service.items().map((c) => c.url)).toEqual(['/', '/billets']);
  });

  it('hides a dynamic crumb until its label arrives, then shows the label', () => {
    const service = create(billetEditor());

    expect(service.items()).toEqual([
      { name: 'Start', url: '/', active: false, dynamic: false },
      { name: 'Meine Billets', url: '/billets', active: true, dynamic: false },
    ]);

    service.setDynamicLabel('Muttertag');

    expect(service.items().map((c) => [c.name, c.active])).toEqual([
      ['Start', false],
      ['Meine Billets', false],
      ['Muttertag', true],
    ]);
    expect(service.items()[2].url).toBe('/billets/7/edit');
  });

  it('forgets a runtime label on the next navigation', () => {
    const service = create(billetEditor());
    service.setDynamicLabel('Muttertag');

    navigate(billetEditor());

    expect(service.items().map((c) => c.name)).toEqual(['Start', 'Meine Billets']);
  });

  it('a language switch relabels the route crumbs and keeps the runtime label', () => {
    const service = create(billetEditor());
    service.setDynamicLabel('Muttertag');

    language = { 'BREADCRUMB.HOME': 'Home', 'BREADCRUMB.BILLETS': 'My billets' };
    langChange.next({});

    expect(service.items().map((c) => c.name)).toEqual(['Home', 'My billets', 'Muttertag']);
  });
});
