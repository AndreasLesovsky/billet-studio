import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { parseStartParams } from '../../billet/billet-start';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
import { BilletApi } from '../../core/services/billet-api';
import { LanguageService } from '../../core/services/language-service';
import { apiErrorCode } from '../../core/utils/api-error';
import { EditorMessage } from './editor-message';
import { EditorSkeleton } from './editor-skeleton';
import { buildStartDocument } from './new-billet-guard';

/** creating: the editor's skeleton while the account stores it. full: no room left in it. */
type Outcome = 'creating' | 'full' | 'failed';

/**
 * /billets/new?template=<id>&… for a signed-in user (a guest's billet never gets here, see
 * newBilletGuard): creates the billet in the account - from the link's start params, or a blank
 * one - and replaces this page with its editor, so Back does not create another one.
 */
@Component({
  selector: 'app-new-billet',
  imports: [EditorMessage, EditorSkeleton, TranslatePipe],
  templateUrl: './new-billet.html',
})
export class NewBillet {
  private readonly api = inject(BilletApi);
  private readonly catalog = inject(AssetCatalogApi);
  private readonly router = inject(Router);
  private readonly params = parseStartParams(inject(ActivatedRoute).snapshot.queryParamMap);
  private readonly lang = inject(LanguageService).currentLang;

  protected readonly outcome = signal<Outcome>('creating');
  /** Left before the account answered: the billet is created, but nobody is taken to it. */
  private left = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.left = true));
    void this.create();
  }

  protected retry(): void {
    void this.create();
  }

  private async create(): Promise<void> {
    this.outcome.set('creating');
    const { document } = await buildStartDocument(this.params, this.lang(), this.catalog);
    let id: number;
    try {
      ({ id } = await this.api.create(document));
    } catch (error) {
      // BILLET_LIMIT_REACHED is answered here; errorInterceptor has toasted anything else.
      this.outcome.set(apiErrorCode(error) === 'BILLET_LIMIT_REACHED' ? 'full' : 'failed');
      return;
    }
    if (!this.left) await this.router.navigate(['/billets', id, 'edit'], { replaceUrl: true });
  }
}
