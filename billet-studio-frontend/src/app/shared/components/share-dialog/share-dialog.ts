import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  model,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { runPending } from '../../../core/utils/pending';
import { Modal } from '../../directives/modal';
import { ShareLinkPanel } from './share-link-panel';
import { NOT_SHARED, shareFailureCode, shareStateOf, type ShareTarget } from './share-state';

/**
 * Shares one billet. Private, it explains what publishing means and publishes (a snapshot; later
 * edits stay private until "Publish changes"). Published, it shows the link (ShareLinkPanel),
 * publishes changes, and stops sharing after a confirmation - the token stays, so publishing again
 * restores the same link.
 *
 * Publish and "Stop sharing" are the two terminal actions of the billet's publish state and at
 * most one applies, so each view shows only its own (CLAUDE.md section 20, the lifecycle
 * exception). Outcomes and failures are also said inside the dialog: the page behind a modal is
 * inert, the toasts included.
 */
@Component({
  selector: 'app-share-dialog',
  imports: [Modal, ShareLinkPanel, TranslatePipe],
  templateUrl: './share-dialog.html',
  styleUrl: './share-dialog.scss',
})
export class ShareDialog {
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  /** The billet to share. Open while set; the dialog clears it when it closes. */
  readonly target = model<ShareTarget | null>(null);

  /** The billet stays in the text while the dialog fades out, after `target` is cleared. */
  private readonly shown = linkedSignal<ShareTarget | null, ShareTarget | null>({
    source: this.target,
    computation: (target, previous) => target ?? previous?.value ?? null,
  });
  protected readonly title = computed(() => this.shown()?.title() ?? '');
  protected readonly facts = computed(() => this.shown()?.facts() ?? NOT_SHARED);
  protected readonly state = computed(() => shareStateOf(this.facts()));

  /** A publish runs: nothing closes the dialog meanwhile. */
  readonly publishing = signal(false);
  /** errorCode of the last failed publish. */
  protected readonly failure = signal<string | null>(null);
  /** The live region's text: the last action's outcome. */
  protected readonly status = signal<string | null>(null);

  close(): void {
    if (this.publishing()) return;
    this.target.set(null);
  }

  /** Off screen: the next opening starts without this one's messages. */
  onClosed(): void {
    this.failure.set(null);
    this.status.set(null);
  }

  async publish(): Promise<void> {
    const target = this.target();
    if (!target) return;
    this.failure.set(null);
    try {
      await runPending(this.publishing, () => target.publish());
    } catch (error) {
      this.failure.set(shareFailureCode(error));
      return;
    }
    this.announce('SHARE.STATUS.PUBLISHED');
    this.focusLater('share-dialog-copy');
  }

  protected unpublish(): void {
    const target = this.target();
    if (!target) return;
    this.failure.set(null);
    const t = (key: string): string => this.translate.instant(key);
    this.confirmation.open({
      title: t('SHARE.UNPUBLISH_TITLE'),
      message: t('SHARE.UNPUBLISH_MESSAGE'),
      confirmLabel: t('SHARE.UNPUBLISH'),
      pendingLabel: t('COMMON.PENDING.UNPUBLISHING'),
      cancelLabel: t('COMMON.CANCEL'),
      confirmVariant: 'danger',
      onConfirm: async () => {
        await target.unpublish();
        this.announce('SHARE.STATUS.UNPUBLISHED');
        this.focusLater('share-dialog-publish');
      },
    });
  }

  /** Cleared first, so the same outcome twice is read out twice. */
  protected announce(key: string): void {
    this.status.set(null);
    afterNextRender(() => this.status.set(key), { injector: this.injector });
  }

  /** The button just pressed went with its view: the focus goes to the new view's action. */
  private focusLater(id: string): void {
    afterNextRender(() => this.host.querySelector<HTMLElement>(`#${id}`)?.focus(), {
      injector: this.injector,
    });
  }
}
