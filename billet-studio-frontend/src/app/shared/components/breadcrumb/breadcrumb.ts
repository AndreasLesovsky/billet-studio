import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { BreadcrumbService } from './breadcrumb-service';

/**
 * The app's only back affordance (CLAUDE.md section 20). From md up, the full trail with parent
 * crumbs as links; below md, one back link to the parent crumb. A trail of one crumb is the page
 * itself and renders nothing.
 */
@Component({
  selector: 'app-breadcrumb',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './breadcrumb.html',
  styleUrl: './breadcrumb.scss',
})
export class Breadcrumb {
  protected readonly crumbs = inject(BreadcrumbService).items;

  protected readonly parent = computed(() => {
    const crumbs = this.crumbs();
    if (crumbs.length < 2) return null;
    const active = crumbs.findIndex((c) => c.active);
    return crumbs[(active === -1 ? crumbs.length - 1 : active) - 1] ?? null;
  });
}
