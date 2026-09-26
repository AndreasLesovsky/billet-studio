import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  BILLET_LANGS,
  createDocument,
  type BilletDocument,
  type BilletLang,
} from '../../../billet/billet-document';
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from '../../../billet/templates/templates';
import { BilletView } from '../../../billet/view/billet-view';
import { LanguageService } from '../../../core/services/language-service';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import type { ColorMode } from '../../../core/theme/theme-registry.generated';
import { billetFontFaces, whenFontsReady } from '../../public-billet/billet-fonts';
import {
  afterFrames,
  missingFaces,
  relativeRect,
  type HeroCaptureState,
  type SceneRect,
} from './hero-capture-ready';
import { HeroLockScreen } from './hero-lock-screen';
import { HeroMessage } from './hero-message';
import { HeroPrintFront } from './hero-print-front';
import { HeroPrintInside } from './hero-print-inside';

const KINDS = ['print-front', 'print-inside', 'screen', 'lock', 'notification'] as const;
type CaptureKind = (typeof KINDS)[number];

/** Kinds drawn in Studio (site tokens, site text): the site must be in the requested mode and language. */
const SITE_KINDS: readonly CaptureKind[] = ['lock', 'notification'];

/** How long the billet's fonts may take before the capture fails. */
const FONT_WAIT_MS = 10_000;

/** Paper left under the last line of a phone screen capture, in CSS px. */
const SCREEN_END_MARGIN_PX = 24;

interface Capture {
  readonly kind: CaptureKind;
  readonly templateId: TemplateId;
  readonly lang: BilletLang;
  readonly mode: ColorMode;
  /** The template's own document; each kind derives what it shows from it. */
  readonly document: BilletDocument;
}

function includes<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return values.includes(value as T);
}

/**
 * Dev only (/dev/hero-capture/:kind?template=&lang=&mode=): one texture of the home page's 3D hero,
 * drawn by the real BilletView at a fixed CSS size in #capture on a transparent page, for
 * tools/asset-pipeline/hero/capture-hero.mjs. It sets window.__heroCapture once the fonts are in
 * and the layout has settled, or reports why it cannot (never a fallback font baked into a texture).
 * Particles, the reveal and the 3D model are off: a texture is a still.
 */
@Component({
  selector: 'app-hero-capture',
  imports: [
    BilletView,
    HeroLockScreen,
    HeroMessage,
    HeroPrintFront,
    HeroPrintInside,
    TranslatePipe,
  ],
  templateUrl: './hero-capture.html',
  styleUrl: './hero-capture.scss',
})
export class HeroCapture {
  readonly kind = input.required<string>();
  readonly template = input<string>();
  readonly lang = input<string>();
  readonly mode = input<string>();

  private readonly colorMode = inject(ColorModeService);
  private readonly language = inject(LanguageService);
  private readonly captureElement = viewChild.required<ElementRef<HTMLElement>>('capture');

  /** null for a kind, template, language or mode the capture does not know. */
  protected readonly spec = computed<Capture | null>(() => {
    const kind = this.kind();
    const templateId = this.template() ?? TEMPLATE_IDS[0];
    const lang = this.lang() ?? 'de';
    const mode = this.mode() ?? 'light';
    if (!includes(KINDS, kind) || !includes(TEMPLATE_IDS, templateId)) return null;
    if (!includes(BILLET_LANGS, lang) || !includes<ColorMode>(['light', 'dark'], mode)) return null;
    return { kind, templateId, lang, mode, document: createDocument({ templateId, lang }) };
  });

  /**
   * The content renders once the billet's fonts are in, as on the public page: FitText then fits
   * the title lines in their real faces from the first measure, so a capture never depends on
   * when a face arrived.
   */
  protected readonly fontsLoaded = signal(false);

  /** A phone screen's height once measured (it runs past the 844 px window); null: the SCSS size. */
  protected readonly screenHeight = signal<number | null>(null);

  protected readonly templateNameKey = computed(() => {
    const capture = this.spec();
    return capture ? TEMPLATES[capture.templateId].nameKey : '';
  });

  constructor() {
    const page = inject(DOCUMENT);
    const view = page.defaultView;
    // Only #capture is drawn: a transparent page keeps the notification's rounded corners clear.
    const body = page.body.style;
    const before = { background: body.background, transition: body.transition };
    body.transition = 'none';
    body.background = 'transparent';
    inject(DestroyRef).onDestroy(() => {
      body.background = before.background;
      body.transition = before.transition;
    });

    afterNextRender(() => {
      if (!view) return;
      void this.prepare(page, view).then(
        (state) => (view.__heroCapture = state),
        (error: unknown) =>
          (view.__heroCapture = {
            ready: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    });
  }

  private async prepare(page: Document, view: Window): Promise<HeroCaptureState> {
    const capture = this.spec();
    if (!capture) {
      throw new Error(
        `unknown capture: kind "${this.kind()}", template "${this.template()}", lang "${this.lang()}", mode "${this.mode()}"`,
      );
    }
    this.checkSite(capture);

    // The template's faces cover every part a kind shows; missingFaces checks what is drawn.
    const faces = capture.kind === 'lock' ? [] : billetFontFaces(capture.document);
    await whenFontsReady(page.fonts, faces, FONT_WAIT_MS);
    await page.fonts.ready;
    this.fontsLoaded.set(true);
    // Rendering asks for the Studio faces; FitText measures in rAF. Frames, then settle again.
    await afterFrames(view, 3);
    await page.fonts.ready;
    await afterFrames(view, 2);

    const element = this.captureElement().nativeElement;
    const missing = await missingFaces(element, page.fonts);
    if (missing.length > 0) throw new Error(`fonts not loaded: ${missing.join(' | ')}`);
    await afterFrames(view, 2);
    if (capture.kind !== 'screen') return { ready: true };

    // The phone shows #capture's 390 x 844 box; the scene area is measured in it, before the
    // capture grows below it.
    const frame = element.getBoundingClientRect();
    const sceneRect = sceneRectOf(element, frame);
    this.screenHeight.set(screenHeightOf(element, frame));
    await afterFrames(view, 2);
    return { ready: true, cssHeight: element.getBoundingClientRect().height, sceneRect };
  }

  /** Studio follows the site's own colour mode and language, which the capture never changes. */
  private checkSite(capture: Capture): void {
    if (!SITE_KINDS.includes(capture.kind)) return;
    const siteMode = this.colorMode.resolvedMode();
    if (siteMode !== capture.mode) {
      throw new Error(
        `the site is in ${siteMode} mode: emulate prefers-color-scheme: ${capture.mode} (and store no colour mode)`,
      );
    }
    const siteLang = this.language.currentLang();
    if (siteLang !== capture.lang) {
      throw new Error(
        `the site language is ${siteLang}: set the browser locale to ${capture.lang}`,
      );
    }
  }
}

function sceneRectOf(capture: HTMLElement, frame: DOMRectReadOnly): SceneRect {
  const scene = capture.querySelector('app-billet-scene');
  if (!scene) throw new Error('the billet shows no scene area');
  return relativeRect(frame, scene);
}

/**
 * A phone screen runs on past its 844 px window to a block boundary: through the block the window's
 * bottom edge crosses and at least through the first paragraph. No line is cut through its glyphs,
 * and every template ends the same way; the hero shows the window and may scroll the rest in.
 */
function screenHeightOf(capture: HTMLElement, frame: DOMRectReadOnly): number {
  const page = capture.querySelector('app-billet-view .page');
  if (!page) throw new Error('the billet shows no page');
  let end = frame.height;
  for (const child of Array.from(page.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.height > 0 && rect.top - frame.top < frame.height) {
      end = Math.max(end, rect.bottom - frame.top);
    }
  }
  const paragraph = capture.querySelector('app-billet-view .block .paragraph')?.closest('.block');
  if (paragraph) end = Math.max(end, paragraph.getBoundingClientRect().bottom - frame.top);
  return Math.ceil(end + SCREEN_END_MARGIN_PX);
}
