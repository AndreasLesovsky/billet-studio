import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  linkedSignal,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AssistStatus } from '../../../core/models/models';
import { AssetCatalogApi } from '../../../core/services/asset-catalog-api';
import { AssistApi } from '../../../core/services/assist-api';
import { AssistConversationStore } from '../../../core/stores/assist-conversation-store';
import { FieldError } from '../field-error/field-error';
import { AssistLog } from './assist-log';
import {
  billetAssistantSchema,
  EMPTY_MODEL,
  type BilletAssistantFormModel,
} from './billet-assistant-schema';

/** How often a waiting status (the model server offline, the model not loaded) is asked again. */
const STATUS_POLL_MS = 30_000;

const EXAMPLE_KEYS = ['ASSIST.EXAMPLE_1', 'ASSIST.EXAMPLE_2', 'ASSIST.EXAMPLE_3'] as const;

/**
 * "Describe your billet in one sentence" (docs/assist.md): a chat window in which the assistant
 * answers each message with a billet to start, until the user starts one. The model only picks
 * labels; every word here is i18n and every offer is built by the start-link code. A message is
 * never validated at the user: an empty one simply cannot be sent.
 *
 * Shown only while the assistant exists in this deployment: an unknown, failed or DISABLED status
 * renders nothing (a deliberate exception to "disabled, not hidden"). OFFLINE says so before the
 * user types, and the model is loaded when someone focuses the input, not on a page visit.
 */
@Component({
  selector: 'app-billet-assistant',
  imports: [AssistLog, FieldError, FormField, TranslatePipe],
  templateUrl: './billet-assistant.html',
  styleUrl: './billet-assistant.scss',
})
export class BilletAssistant {
  private readonly api = inject(AssistApi);
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  protected readonly conversation = inject(AssistConversationStore);

  private readonly status = resource({ loader: () => this.api.status() });
  /** The last status read; a failed reload keeps it, so the chat and its errors stay on screen. */
  private readonly state = linkedSignal<AssistStatus | undefined, AssistStatus | null>({
    source: () => (this.status.hasValue() ? this.status.value() : undefined),
    computation: (status, previous) => status ?? previous?.value ?? null,
  });
  protected readonly shown = computed(() => {
    const state = this.state();
    return state !== null && state !== AssistStatus.Disabled;
  });
  protected readonly offline = computed(() => this.state() === AssistStatus.Offline);
  protected readonly idle = computed(() => this.state() === AssistStatus.Idle);
  /** ASSIST.STATUS.<key> in the header. */
  protected readonly statusKey = computed(() => this.state() ?? AssistStatus.Offline);

  private readonly catalog = inject(AssetCatalogApi);
  private readonly libraryRequest = resource({ loader: () => this.catalog.list() });
  protected readonly library = computed(() =>
    this.libraryRequest.hasValue() ? this.libraryRequest.value() : [],
  );
  protected readonly libraryPending = computed(() => this.libraryRequest.isLoading());

  readonly model = signal<BilletAssistantFormModel>({ ...EMPTY_MODEL });
  readonly assistantForm = form(this.model, billetAssistantSchema);
  protected readonly blank = computed(() => this.model().message.trim().length === 0);

  protected readonly examples = EXAMPLE_KEYS;
  protected readonly sendLabel = computed(() => {
    if (!this.conversation.asking()) return 'ASSIST.SEND';
    return this.idle() ? 'COMMON.PENDING.STARTING' : 'COMMON.PENDING.THINKING';
  });

  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private warmedUp = false;

  constructor() {
    const poll = setInterval(() => this.refreshWaitingStatus(), STATUS_POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(poll));
    // Every new message and the "thinking" dots scroll the log to its end.
    afterRenderEffect(() => {
      this.conversation.entries();
      this.conversation.asking();
      const log = this.scroll()?.nativeElement;
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  /** The user is about to ask: load the model now (once), so the answer need not wait for it. */
  protected onFocus(): void {
    if (this.offline() || this.idle()) this.refreshWaitingStatus();
    if (this.idle() && !this.warmedUp) {
      this.warmedUp = true;
      this.api.warmUp();
    }
  }

  /** A suggestion is sent as it is, like a message the user typed. */
  protected useExample(key: string): void {
    this.input()?.nativeElement.focus();
    void this.send(this.translate.instant(key));
  }

  /**
   * Enter sends, Shift+Enter breaks the line. An IME composition keeps its Enter: Safari ends the
   * composition before that keydown, which then only shows keyCode 229.
   */
  protected onEnter(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void this.onSubmit();
  }

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.blank() || this.assistantForm().invalid()) return;
    await this.send(this.model().message);
  }

  /** Nothing goes out while offline or while an answer is still on its way; the text then stays. */
  private async send(message: string): Promise<void> {
    if (this.offline() || this.conversation.asking()) return;
    const sending = this.conversation.send(message);
    this.assistantForm().reset({ ...EMPTY_MODEL });
    await sending;
    this.status.reload();
  }

  protected restart(): void {
    this.conversation.restart();
    this.input()?.nativeElement.focus();
  }

  /** The failed message's row (and its focused button) goes away: the input takes the focus. */
  protected retry(id: number): void {
    this.input()?.nativeElement.focus();
    void this.conversation.retry(id).then(() => this.status.reload());
  }

  private refreshWaitingStatus(): void {
    const waiting = this.offline() || this.idle() || this.status.error() !== undefined;
    if (waiting && this.document.visibilityState === 'visible' && !this.status.isLoading()) {
      this.status.reload();
    }
  }
}
