import { afterNextRender, Component, computed, ElementRef, inject, Injector } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TEXT_LIMITS } from '../../../billet/billet-limits';
import { truncateGraphemes } from '../../../billet/text/text-sanitize';
import { TEMPLATES } from '../../../billet/templates/templates';
import { AssetCatalogApi } from '../../../core/services/asset-catalog-api';
import { LanguageService } from '../../../core/services/language-service';
import {
  LocalBilletError,
  LocalBilletStore,
  MAX_LOCAL_BILLETS,
  type LocalBilletEntry,
} from '../../../core/services/local-billet-store';
import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { MessageStore } from '../../../core/stores/message-store';
import { billetPresetFor } from '../../../core/theme/billet-theme-presets.generated';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';

const cardLinkId = (entry: LocalBilletEntry) => `billet-list-edit-${entry.localId}`;

/** A blank billet's stand-in for its model preview. */
const BLANK_EMOJI = '💌';

const MINUTE_MS = 60_000;
/** Largest unit first; under a minute reads as "this minute". */
const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 24 * 60 * MINUTE_MS],
  ['hour', 60 * MINUTE_MS],
  ['minute', MINUTE_MS],
];

function editedAgo(updatedAt: string, now: number, locale: string): string {
  const elapsed = Math.max(0, now - Date.parse(updatedAt));
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => elapsed >= ms) ?? RELATIVE_UNITS[2];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    -Math.floor(elapsed / size),
    unit,
  );
}

/**
 * "My billets": the billets stored in this browser, newest first, with their model, theme colours
 * and when they were last edited. Other tabs' changes show up by themselves (LocalBilletStore).
 * P7 adds the billets of the account.
 */
@Component({
  selector: 'app-billet-list',
  imports: [AssetThumb, RouterLink, TranslatePipe],
  templateUrl: './billet-list.html',
  styleUrl: './billet-list.scss',
})
export class BilletList {
  private readonly store = inject(LocalBilletStore);
  private readonly catalog = inject(AssetCatalogApi);
  private readonly colorMode = inject(ColorModeService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly messages = inject(MessageStore);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  protected readonly max = MAX_LOCAL_BILLETS;
  /** Every place is taken: a copy has no room (the count says so). */
  protected readonly full = computed(() => this.store.list().length >= MAX_LOCAL_BILLETS);

  protected readonly cards = computed(() => {
    const previews = new Map(this.catalog.models()?.map((model) => [model.slug, model.previewUrl]));
    const mode = this.colorMode.resolvedMode();
    const locale = this.language.locale();
    const now = Date.now();
    return this.store.list().map((entry) => {
      const { accent, accentSoft, background, ink } = billetPresetFor(entry.theme).palette[mode];
      return {
        entry,
        emoji: entry.templateId ? TEMPLATES[entry.templateId].emoji : BLANK_EMOJI,
        linkId: cardLinkId(entry),
        previewUrl: (entry.modelSlug && previews.get(entry.modelSlug)) || null,
        swatches: [accent, accentSoft, background, ink],
        edited: editedAgo(entry.updatedAt, now, locale),
      };
    });
  });

  constructor() {
    // Previews are decoration: without the catalog the cards show their emoji.
    void this.catalog.list().catch(() => undefined);
  }

  protected duplicate(entry: LocalBilletEntry): void {
    const title = this.translate.instant('BILLETS.COPY_TITLE', { title: this.nameOf(entry) });
    this.storeAction(() =>
      this.store.duplicate(entry.localId, truncateGraphemes(title, TEXT_LIMITS.title)),
    );
  }

  protected async remove(entry: LocalBilletEntry): Promise<void> {
    const confirmed = await this.confirmation.askConfirmation({
      title: this.translate.instant('BILLETS.DELETE_TITLE'),
      message: this.translate.instant('BILLETS.DELETE_MESSAGE', { title: this.nameOf(entry) }),
      confirmLabel: this.translate.instant('COMMON.DELETE'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const entries = this.store.list();
    const index = entries.findIndex((e) => e.localId === entry.localId);
    const next = entries[index + 1] ?? entries[index - 1];
    this.storeAction(() => this.store.remove(entry.localId));
    // The card and its button are gone: focus the card that took its place, else "New billet".
    afterNextRender(
      () => {
        const card = next && this.host.querySelector<HTMLElement>(`#${cardLinkId(next)}`);
        (card ?? this.host.querySelector<HTMLElement>('#billet-list-new'))?.focus();
      },
      { injector: this.injector },
    );
  }

  private nameOf(entry: LocalBilletEntry): string {
    return entry.title || this.translate.instant('BILLETS.UNTITLED');
  }

  /** A write the device refused becomes its toast. */
  private storeAction(action: () => unknown): void {
    try {
      action();
    } catch (error) {
      if (!(error instanceof LocalBilletError)) throw error;
      this.messages.addMessage('error', error.code, undefined, { max: MAX_LOCAL_BILLETS });
    }
  }
}
