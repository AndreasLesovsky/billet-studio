import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../../billet/billet-document';
import { BilletView } from '../../../billet/view/billet-view';
import type { BilletViewMode } from '../../../billet/view/billet-view-style';
import type { ModelAssetDto } from '../../../core/models/models';

type Device = 'phone' | 'desktop';

const DEVICES: readonly {
  readonly device: Device;
  readonly labelKey: string;
  readonly icon: string;
}[] = [
  { device: 'phone', labelKey: 'EDITOR.PREVIEW.PHONE', icon: 'bi-phone' },
  { device: 'desktop', labelKey: 'EDITOR.PREVIEW.DESKTOP', icon: 'bi-laptop' },
];

/** Longer than the whole entrance (the signature starts at 2.2 s and takes 1 s). */
const REVEAL_MS = 3500;

/**
 * The billet as the recipient sees it, in a phone-width frame (24.375rem = 390 px, where the
 * billet's cqi units resolve exactly as on a phone) or a desktop frame scaled to fit. The one
 * BilletView of the app, with particles running; the entrance plays only on replay().
 */
@Component({
  selector: 'app-preview-frame',
  imports: [BilletView, TranslatePipe],
  templateUrl: './preview-frame.html',
  styleUrl: './preview-frame.scss',
})
export class PreviewFrame {
  readonly document = input.required<BilletDocument>();
  /** The 3D model the scene shows. */
  readonly asset = input<ModelAssetDto | null>(null);
  /** Undefined shows the document's own colour mode. */
  readonly mode = input<BilletViewMode>();

  private readonly injector = inject(Injector);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly view = viewChild(BilletView);

  protected readonly devices = DEVICES;
  protected readonly device = signal<Device>('phone');
  /** Stage width / frame width, never above 1: the frame keeps its size and is scaled down. */
  protected readonly scale = signal(1);
  protected readonly animate = signal(false);
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(this.revealTimer));

    afterNextRender(() => {
      const stage = this.stage().nativeElement;
      const frame = this.frame().nativeElement;
      // offsetWidth is the frame's own width, before the scale transform.
      const observer = new ResizeObserver(() =>
        this.scale.set(Math.min(1, stage.clientWidth / Math.max(1, frame.offsetWidth))),
      );
      observer.observe(stage);
      observer.observe(frame);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Plays the billet's entrance once, from the start. */
  replay(): void {
    this.animate.set(true);
    afterNextRender(() => this.view()?.replay(), { injector: this.injector });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => this.animate.set(false), REVEAL_MS);
  }
}
