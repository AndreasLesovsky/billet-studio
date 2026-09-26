/** The scene area of a phone screen capture, relative to #capture, each value 0..1. */
export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What the capture script (tools/asset-pipeline/hero/capture-hero.mjs) waits for. A phone screen
 * reports its height (it runs past the phone's 390 x 844 window) and the scene area within that
 * window.
 */
export type HeroCaptureState =
  | { readonly ready: true; readonly cssHeight?: number; readonly sceneRect?: SceneRect }
  | { readonly ready: false; readonly error: string };

declare global {
  interface Window {
    __heroCapture?: HeroCaptureState;
  }
}

/** Resolves after `count` painted frames: layout that settles in rAF (FitText) is done by then. */
export function afterFrames(view: Window, count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve();
      else view.requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

/**
 * Characters a web font draws: letters, digits and icon-font glyphs (private use area). An emoji or
 * a symbol is drawn by a system font.
 */
const WEB_FONT_TEXT = /[\p{L}\p{N}\p{Co}]/gu;

function fontOf(style: CSSStyleDeclaration): string {
  return `${style.fontStyle} ${style.fontWeight} 1em ${style.fontFamily}`;
}

/** An icon's glyph: the ::before content string ('"\f123"' computes to '""'). */
function pseudoText(style: CSSStyleDeclaration): string {
  const content = style.content;
  return /^".*"$/s.test(content) ? content.slice(1, -1) : '';
}

/**
 * The faces the element's rendered text is set in that are not loaded - every font shorthand with
 * the characters it has to draw, icon glyphs included. A face counts as loaded when the
 * FontFaceSet has a matching face for those characters and check() is true, so a fallback font is
 * never mistaken for the real one (check() alone is also true for a family no @font-face declares).
 */
export async function missingFaces(root: HTMLElement, fonts: FontFaceSet): Promise<string[]> {
  const view = root.ownerDocument.defaultView;
  if (!view) return ['no window'];
  const texts = new Map<string, string>();
  const add = (style: CSSStyleDeclaration, text: string): void => {
    const drawn = text.match(WEB_FONT_TEXT)?.join('') ?? '';
    if (!drawn) return;
    // text-transform: the capitals of a lowercase text are drawn too.
    const font = fontOf(style);
    texts.set(font, (texts.get(font) ?? '') + drawn + drawn.toUpperCase());
  };
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement) add(view.getComputedStyle(node.parentElement), node.textContent ?? '');
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const before = view.getComputedStyle(element, '::before');
    add(before, pseudoText(before));
  }
  const missing: string[] = [];
  for (const [font, text] of texts) {
    const unique = [...new Set(text)].join('');
    const faces = await fonts.load(font, unique);
    if (faces.length === 0 || !fonts.check(font, unique)) missing.push(font);
  }
  return missing;
}

/** `inner`'s box relative to the box `outer`, as fractions of `outer`'s size. */
export function relativeRect(outer: DOMRectReadOnly, inner: Element): SceneRect {
  const o = outer;
  const i = inner.getBoundingClientRect();
  return {
    x: (i.left - o.left) / o.width,
    y: (i.top - o.top) / o.height,
    w: i.width / o.width,
    h: i.height / o.height,
  };
}
