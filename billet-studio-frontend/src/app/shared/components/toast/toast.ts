import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AppMessage } from '../../../core/models/app-message';
import { MessageStore } from '../../../core/stores/message-store';

/** How long an ordinary toast stays, not counting the time the pointer or focus rests on it. */
export const AUTO_DISMISS_MS = 4000;

type Variant = 'success' | 'danger' | 'warning' | 'info';
type Hold = 'pointer' | 'focus';

interface ToastView {
  readonly id: number;
  readonly key: string;
  readonly params: Record<string, unknown>;
  readonly variant: Variant;
  readonly icon: string;
  readonly countdownFrom?: number;
  readonly countdownTo?: number;
}

const VARIANTS: Record<AppMessage['type'], { variant: Variant; icon: string }> = {
  success: { variant: 'success', icon: 'bi-check-circle-fill' },
  error: { variant: 'danger', icon: 'bi-x-circle-fill' },
  info: { variant: 'info', icon: 'bi-info-circle-fill' },
  warning: { variant: 'warning', icon: 'bi-exclamation-triangle-fill' },
};

/** Variants announced assertively; the rest wait for the screen reader to finish. */
const URGENT: ReadonlySet<Variant> = new Set(['danger', 'warning']);

/** m:ss left, never below zero. */
function formatCountdown(msLeft: number): string {
  const seconds = Math.max(0, Math.round(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** One toast's lifetime: it runs, holds while anything rests on the toast, then expires. */
class DismissTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private remaining: number;
  private readonly holds = new Set<Hold>();

  constructor(
    duration: number,
    private readonly expire: () => void,
  ) {
    this.remaining = duration;
    this.run();
  }

  hold(reason: Hold): void {
    this.holds.add(reason);
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.remaining -= Date.now() - this.startedAt;
  }

  release(reason: Hold): void {
    this.holds.delete(reason);
    if (this.holds.size === 0) this.run();
  }

  cancel(): void {
    if (this.handle !== null) clearTimeout(this.handle);
    this.handle = null;
  }

  private run(): void {
    if (this.handle !== null) return;
    this.startedAt = Date.now();
    this.handle = setTimeout(this.expire, Math.max(0, this.remaining));
  }
}

/**
 * Renders the MessageStore queue. Ordinary toasts leave after AUTO_DISMISS_MS (held while hovered or
 * focused, so they can be read); the session warning stays and counts its deadline down as m:ss.
 *
 * Two live regions that exist before any toast does, because content inserted into a region that
 * appears at the same moment is not reliably announced: errors and warnings interrupt (assertive),
 * success and info wait their turn (polite). Visually they form one stack at the bottom of the
 * screen with the newest toast nearest the edge.
 */
@Component({
  selector: 'app-toast',
  imports: [TranslatePipe],
  templateUrl: './toast.html',
  styleUrl: './toast.scss',
})
export class Toast {
  private readonly store = inject(MessageStore);
  private readonly region = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly timers = new Map<number, DismissTimer>();
  private readonly now = signal(Date.now());

  /**
   * Whether the urgent list is drawn at the stack's edge: it is when the newest toast went into it.
   * Only an arriving toast moves the edge; a leaving one keeps the stack in place, so it animates
   * out where it was instead of the lists swapping under it.
   */
  private readonly urgentAtEdge = linkedSignal<AppMessage[], boolean>({
    source: this.store.messages,
    computation: (list, previous) => {
      const newest = list.at(-1);
      const arrived = newest !== undefined && newest.id > (previous?.source.at(-1)?.id ?? 0);
      return arrived ? URGENT.has(VARIANTS[newest.type].variant) : (previous?.value ?? false);
    },
  });

  /**
   * Tracked by `live` in the template, so each region stays the same element for good. `edge`
   * marks the list drawn nearest the screen's edge.
   */
  protected readonly lists = computed(() => {
    const toasts = this.store.messages().map(toView);
    const urgentAtEdge = this.urgentAtEdge();
    return [
      {
        live: 'assertive',
        edge: urgentAtEdge,
        toasts: toasts.filter((t) => URGENT.has(t.variant)),
      },
      {
        live: 'polite',
        edge: !urgentAtEdge,
        toasts: toasts.filter((t) => !URGENT.has(t.variant)),
      },
    ] as const;
  });
  private readonly counting = computed(() =>
    this.store.messages().some((m) => m.countdownTo !== undefined),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.timers.forEach((timer) => timer.cancel()));

    // Timers are side effects of the list: started for new toasts, dropped with removed ones.
    effect(() => {
      const list = this.store.messages();
      untracked(() => this.syncTimers(list));
    });

    // Ticks only while a countdown is on screen.
    effect((onCleanup) => {
      if (!this.counting()) return;
      const tick = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(tick));
    });

    afterNextRender(() => this.popover()?.showPopover());

    // A modal <dialog> opened after the region sits above it in the top layer. Showing the region
    // again moves it to the top, so an error about the dialog's own action is not hidden behind it.
    // Only for a NEW toast: re-showing restarts the entry animation of every toast on screen.
    let raisedFor = 0;
    afterRenderEffect({
      write: () => {
        const newest = this.store.messages().at(-1)?.id ?? 0;
        if (newest <= raisedFor) return;
        raisedFor = newest;
        const popover = this.popover();
        if (!popover?.ownerDocument.querySelector('dialog[open]:modal')) return;
        popover.hidePopover();
        popover.showPopover();
      },
    });
  }

  protected dismiss(id: number): void {
    this.store.removeMessage(id);
  }

  protected hold(id: number, reason: Hold): void {
    this.timers.get(id)?.hold(reason);
  }

  protected release(id: number, reason: Hold, event?: FocusEvent): void {
    // Focus moving between elements of the same toast is not focus leaving it.
    const next = event?.relatedTarget;
    if (next instanceof Node && (event?.currentTarget as Node | null)?.contains(next)) return;
    this.timers.get(id)?.release(reason);
  }

  protected remaining(toast: ToastView): string {
    // An older tick than the warning itself would read as more time than the window has.
    const now = Math.max(this.now(), toast.countdownFrom ?? 0);
    return formatCountdown((toast.countdownTo ?? now) - now);
  }

  private syncTimers(list: readonly AppMessage[]): void {
    const ids = new Set(list.map((m) => m.id));
    for (const [id, timer] of this.timers) {
      if (ids.has(id)) continue;
      timer.cancel();
      this.timers.delete(id);
    }
    for (const message of list) {
      if (message.countdownTo !== undefined || this.timers.has(message.id)) continue;
      this.timers.set(
        message.id,
        new DismissTimer(AUTO_DISMISS_MS, () => this.dismiss(message.id)),
      );
    }
  }

  /** The region element when the browser supports popovers (older engines and jsdom do not). */
  private popover(): HTMLElement | null {
    const element = this.region.nativeElement.querySelector<HTMLElement>('[popover]');
    return typeof element?.showPopover === 'function' ? element : null;
  }
}

function toView(message: AppMessage): ToastView {
  return {
    id: message.id,
    key: `MESSAGES.${message.type.toUpperCase()}.${message.code}`,
    params: message.params ?? {},
    ...VARIANTS[message.type],
    countdownFrom: message.countdownFrom,
    countdownTo: message.countdownTo,
  };
}
