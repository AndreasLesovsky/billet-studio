import {
  afterRenderEffect,
  DestroyRef,
  Directive,
  DOCUMENT,
  ElementRef,
  inject,
  input,
} from '@angular/core';

/** A line wider than its box shrinks to this share of its size at most, then wraps between words. */
const MIN_LINE_SCALE = 0.6;
/** Room for glyphs drawn past their advance width: script swashes, italic overhang. */
const SAFE_WIDTH = 0.98;
/** Below this a new scale is measuring noise. */
const EPSILON = 0.005;

/**
 * A hero title line: wider than its box, it shrinks until it fits on one line, down to
 * MIN_LINE_SCALE; beyond that it wraps between words. It never breaks inside a word - the scale
 * never exceeds what fits the widest word. The element must be a block as wide as its container
 * (a shrink-wrapped box would follow its own text). The scale is `--billet-fit` on the element,
 * which its font-size multiplies (billet-view.scss).
 */
@Directive({ selector: '[appFitText]' })
export class FitText {
  /** The text shown: a new text is measured again. */
  readonly appFitText = input.required<string>();
  /** The document's typography: another face or size is measured again. */
  readonly fitTypography = input.required<unknown>();

  constructor() {
    const element: HTMLElement = inject(ElementRef).nativeElement;
    let scale = 1;
    const fit = (): void => {
      const next = fitScale(element, scale);
      if (Math.abs(next - scale) < EPSILON) return;
      scale = next;
      if (scale === 1) element.style.removeProperty('--billet-fit');
      else element.style.setProperty('--billet-fit', scale.toFixed(3));
    };

    afterRenderEffect(() => {
      this.appFitText();
      this.fitTypography();
      fit();
    });

    // A new width, and a size change through the root's --billet-size-* properties. The fit resizes
    // the element itself, so it waits for the next frame: inside the observer's callback that
    // would be a ResizeObserver loop error. A face that finishes loading keeps the line height, so
    // it has its own event.
    let frame = 0;
    const fitNextFrame = (): void => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    const abort = new AbortController();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fitNextFrame) : null;
    resize?.observe(element);
    inject(DOCUMENT).fonts?.addEventListener('loadingdone', fit, { signal: abort.signal });
    inject(DestroyRef).onDestroy(() => {
      resize?.disconnect();
      abort.abort();
      if (frame) cancelAnimationFrame(frame);
    });
  }
}

/** The scale (≤ 1) the element's text needs, measured unwrapped at the current `scale`. */
function fitScale(element: HTMLElement, scale: number): number {
  const box = element.getBoundingClientRect().width * SAFE_WIDTH;
  if (box <= 0) return scale;

  const previous = element.style.whiteSpace;
  element.style.whiteSpace = 'nowrap';
  const line = rangeWidth(element, (range) => range.selectNodeContents(element));
  let word = 0;
  const texts = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    const text = node;
    for (const match of (text.textContent ?? '').matchAll(/\S+/g)) {
      const width = rangeWidth(element, (range) => {
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
      });
      word = Math.max(word, width);
    }
  }
  element.style.whiteSpace = previous;

  if (line <= 0) return 1;
  // Widths at scale 1.
  const lineFit = (box * scale) / line;
  const wordFit = word > 0 ? (box * scale) / word : 1;
  return Math.min(1, Math.max(lineFit, MIN_LINE_SCALE), wordFit);
}

function rangeWidth(element: HTMLElement, select: (range: Range) => void): number {
  const range = element.ownerDocument.createRange();
  select(range);
  return range.getBoundingClientRect().width;
}
