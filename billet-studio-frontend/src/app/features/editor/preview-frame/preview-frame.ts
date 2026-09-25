import {
  afterNextRender,
  Component,
  computed,
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
import {
  fitZoom,
  nextZoomStep,
  parseZoomSetting,
  previousZoomStep,
  zoomFactor,
  zoomPercent,
  type Size,
  type ZoomSetting,
} from './zoom-steps';

type Device = 'phone' | 'desktop';

const DEVICES: readonly {
  readonly device: Device;
  readonly labelKey: string;
  readonly icon: string;
}[] = [
  { device: 'phone', labelKey: 'EDITOR.PREVIEW.PHONE', icon: 'bi-phone' },
  { device: 'desktop', labelKey: 'EDITOR.PREVIEW.DESKTOP', icon: 'bi-laptop' },
];

const ZOOM_STORAGE_KEYS: Readonly<Record<Device, string>> = {
  phone: 'billet-studio.preview-zoom.phone',
  desktop: 'billet-studio.preview-zoom.desktop',
};

// A mouse wheel notch is about 100 px of travel, a trackpad pinch (Ctrl+wheel) many small deltas:
// one zoom step per this much travel in one direction. Line and page deltas are converted first.
const WHEEL_TRAVEL_PER_STEP = 50;
const WHEEL_DELTA_PX = [1, 40, 800] as const;

/** Longer than the whole entrance (the signature starts at 2.2 s and takes 1 s). */
const REVEAL_MS = 3500;

function readZoom(device: Device): ZoomSetting {
  try {
    return parseZoomSetting(localStorage.getItem(ZOOM_STORAGE_KEYS[device]));
  } catch {
    return 'fit';
  }
}

function writeZoom(device: Device, setting: ZoomSetting): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEYS[device], String(setting));
  } catch {
    // Storage blocked: the zoom lasts for this page only.
  }
}

/** Measured sizes in px; null while the element is not laid out (a hidden tab panel). */
function sizeOf(width: number, height: number): Size | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The billet as the recipient sees it, in a phone frame (a 24.375rem × 52.75rem screen = 390 × 844
 * px, where the billet's cqi units resolve exactly as on a phone) or a 64rem desktop frame. The one
 * BilletView of the app, with particles running; the entrance plays only on replay().
 *
 * Zoom, per device and remembered on this device: "fit" (the default) shows the whole phone at
 * up to 100 % and the desktop frame at the stage's width; the steps of zoom-steps.ts fix it, by
 * button or Ctrl/Cmd + wheel over the preview. The frame keeps its real size and is scaled by a
 * transform, so the billet lays out at the unscaled width; a sizer of the scaled size lets the
 * stage scroll and centre it.
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
  protected readonly animate = signal(false);
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly zoomSettings = signal<Record<Device, ZoomSetting>>({
    phone: readZoom('phone'),
    desktop: readZoom('desktop'),
  });
  private readonly stageSize = signal<Size | null>(null);
  /** The frame's own size, before the zoom transform. */
  private readonly frameSize = signal<Size | null>(null);
  private readonly fit = computed(() => {
    const stage = this.stageSize();
    const frame = this.frameSize();
    return stage && frame ? fitZoom(stage, frame, this.device() === 'phone') : 1;
  });
  private readonly zoomSetting = computed(() => this.zoomSettings()[this.device()]);
  protected readonly zoom = computed(() => zoomFactor(this.zoomSetting(), this.fit()));
  protected readonly percent = computed(() => zoomPercent(this.zoom()));
  protected readonly fitted = computed(() => this.zoomSetting() === 'fit');
  protected readonly canZoomIn = computed(() => nextZoomStep(this.zoom()) !== null);
  protected readonly canZoomOut = computed(() => previousZoomStep(this.zoom()) !== null);
  protected readonly sizer = computed(() => {
    const frame = this.frameSize();
    const zoom = this.zoom();
    return frame ? { width: frame.width * zoom, height: frame.height * zoom } : null;
  });
  /** The zoom a button or the wheel just set, for the live region. */
  protected readonly announcedPercent = signal<number | null>(null);
  private wheelTravel = 0;
  /** A frame wider than the stage opens centred: at the start and after a device switch. */
  private centerPending = true;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(this.revealTimer));

    afterNextRender(() => {
      const stage = this.stage().nativeElement;
      const frame = this.frame().nativeElement;
      const observer = new ResizeObserver(() => this.onResize(stage, frame));
      observer.observe(stage);
      observer.observe(frame);
      // Capture: Ctrl/Cmd + wheel zooms the preview everywhere over it, the 3D scene included,
      // whose own wheel zoom would otherwise take it.
      const listeners = new AbortController();
      stage.addEventListener('wheel', (event) => this.onWheel(event), {
        capture: true,
        passive: false,
        signal: listeners.signal,
      });
      destroyRef.onDestroy(() => {
        observer.disconnect();
        listeners.abort();
      });
    });
  }

  protected selectDevice(device: Device): void {
    this.device.set(device);
    this.centerPending = true;
  }

  protected zoomIn(): void {
    const step = nextZoomStep(this.zoom());
    if (step !== null) this.setZoom(step);
  }

  protected zoomOut(): void {
    const step = previousZoomStep(this.zoom());
    if (step !== null) this.setZoom(step);
  }

  protected zoomToFit(): void {
    this.setZoom('fit');
  }

  /** Plays the billet's entrance once, from the start. */
  replay(): void {
    this.animate.set(true);
    afterNextRender(() => this.view()?.replay(), { injector: this.injector });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => this.animate.set(false), REVEAL_MS);
  }

  /** offsetWidth/offsetHeight are the frame's own size, before the scale transform. */
  private onResize(stage: HTMLElement, frame: HTMLElement): void {
    const stageSize = sizeOf(stage.clientWidth, stage.clientHeight);
    this.stageSize.set(stageSize ?? this.stageSize());
    this.frameSize.set(sizeOf(frame.offsetWidth, frame.offsetHeight) ?? this.frameSize());
    if (!stageSize || !this.centerPending) return;
    this.centerPending = false;
    afterNextRender(
      () => {
        stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      },
      { injector: this.injector },
    );
  }

  /**
   * Keeps what is in the horizontal middle of the stage in the middle, and the top edge's place
   * relative to the frame, so the frame grows and shrinks around what the user looks at.
   */
  private setZoom(setting: ZoomSetting): void {
    const device = this.device();
    const stage = this.stage().nativeElement;
    const centerX = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth);
    const top = stage.scrollTop / Math.max(1, stage.scrollHeight);

    this.zoomSettings.update((settings) => ({ ...settings, [device]: setting }));
    writeZoom(device, setting);
    this.announcedPercent.set(zoomPercent(zoomFactor(setting, this.fit())));

    afterNextRender(
      () => {
        stage.scrollLeft = centerX * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = top * stage.scrollHeight;
      },
      { injector: this.injector },
    );
  }

  private onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY * WHEEL_DELTA_PX[event.deltaMode];
    if (Math.sign(delta) !== Math.sign(this.wheelTravel)) this.wheelTravel = 0;
    this.wheelTravel += delta;
    if (Math.abs(this.wheelTravel) < WHEEL_TRAVEL_PER_STEP) return;
    this.wheelTravel = 0;
    if (delta < 0) this.zoomIn();
    else this.zoomOut();
  }
}
