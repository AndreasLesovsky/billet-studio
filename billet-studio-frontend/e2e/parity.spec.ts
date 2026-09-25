import { expect, test, type Locator, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

import { mockBilletApi, PARITY_DOCUMENT, publicBillet } from './support/billet-api';

// The Muttertag document on the public page vs. the snapshot of the live card
// (e2e/fixtures/muttertag-original, CLAUDE.md §11): same boxes, same type, same pixels. Both pages
// render without their entrance, without petals and with the 3D area masked - the canvas is empty
// in the snapshot (no GLB) and the model spins in ours.

const ORIGINAL_URL = 'http://localhost:4321/index.html';
const OURS_URL = '/b/parity-token';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const COLOR_SCHEMES = ['light', 'dark'] as const;

/** Box edges may differ by this much (px). */
const GEOMETRY_TOLERANCE = 1.5;
/** pixelmatch colour threshold and the share of differing pixels a page may have. */
const PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_RATIO = 0.01;
const MASK_COLOR = '#ff00ff';

/** The live card's reveal is finished at once; the petals and the credit line are not the card. */
const ORIGINAL_CSS = `
  .hero-label, .hero-title, .hero-sub, .botanical, .divider, .section, .fun-card, .soundbar-note,
  .signature { animation: none !important; opacity: 1 !important; }
  .petals { display: none !important; }
`;
const OURS_CSS = `
  app-billet-particles, app-public-billet > footer { display: none !important; }
`;

/** One box to measure: the nth match of a selector, or the first text inside it. */
interface Probe {
  readonly selector: string;
  readonly nth?: number;
  readonly text?: boolean;
}

interface Pair {
  readonly name: string;
  readonly original: Probe;
  readonly ours: Probe;
  /** The computed styles to compare; default all of STYLE_KEYS. */
  readonly styles?: readonly StyleKey[];
}

const PAIRS: readonly Pair[] = [
  {
    name: 'page background',
    original: { selector: 'html' },
    ours: { selector: 'app-billet-view' },
    styles: ['backgroundColor'],
  },
  { name: 'page', original: { selector: '.page' }, ours: { selector: '.page' } },
  { name: 'hero', original: { selector: '.hero' }, ours: { selector: '.hero' } },
  { name: 'hero label', original: { selector: '.hero-label' }, ours: { selector: '.hero-label' } },
  { name: 'hero title', original: { selector: '.hero-title' }, ours: { selector: '.hero-title' } },
  {
    name: 'title line 1',
    original: { selector: '.hero-title', text: true },
    ours: { selector: '.title-line', text: true },
  },
  {
    name: 'title line 2',
    original: { selector: '.hero-title em' },
    ours: { selector: '.title-accent' },
  },
  {
    name: 'title line 2 text',
    original: { selector: '.hero-title em', text: true },
    ours: { selector: '.title-accent', text: true },
  },
  { name: 'hero sub', original: { selector: '.hero-sub' }, ours: { selector: '.hero-sub' } },
  { name: 'scene', original: { selector: '.botanical' }, ours: { selector: '.scene' } },
  { name: 'scene hint', original: { selector: '.canvas-hint' }, ours: { selector: '.scene-hint' } },
  { name: 'divider', original: { selector: '.divider' }, ours: { selector: '.page > .divider' } },
  {
    name: 'divider line 1',
    original: { selector: '.divider-line', nth: 0 },
    ours: { selector: '.page > .divider .line', nth: 0 },
  },
  {
    name: 'divider mark',
    original: { selector: '.divider-diamond' },
    ours: { selector: '.page > .divider .mark' },
  },
  {
    name: 'divider line 2',
    original: { selector: '.divider-line', nth: 1 },
    ours: { selector: '.page > .divider .line', nth: 1 },
  },
  ...[0, 1].flatMap((nth) => [
    {
      name: `section ${nth + 1}`,
      original: { selector: '.section', nth },
      ours: { selector: '.page > .block', nth },
    },
    {
      name: `section ${nth + 1} text`,
      original: { selector: '.section-text', nth },
      ours: { selector: '.paragraph', nth },
    },
  ]),
  {
    name: 'section 1 emphasis',
    original: { selector: '.section-text em' },
    ours: { selector: '.paragraph em' },
  },
  { name: 'card', original: { selector: '.fun-card' }, ours: { selector: '.card' } },
  { name: 'card icon', original: { selector: '.fun-card-icon' }, ours: { selector: '.card-icon' } },
  { name: 'card text', original: { selector: '.fun-card-text' }, ours: { selector: '.card-text' } },
  ...[0, 1].map((nth) => ({
    name: `card strong ${nth + 1}`,
    original: { selector: '.fun-card-text strong', nth },
    ours: { selector: '.card-text strong', nth },
  })),
  { name: 'note', original: { selector: '.soundbar-note' }, ours: { selector: '.note' } },
  { name: 'signature', original: { selector: '.signature' }, ours: { selector: '.signature' } },
  {
    name: 'signature name',
    original: { selector: '.signature-name' },
    ours: { selector: '.signature-name' },
  },
  {
    name: 'signature sub',
    original: { selector: '.signature-sub' },
    ours: { selector: '.signature-sub' },
  },
];

const STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'color',
  'backgroundColor',
] as const;

type StyleKey = (typeof STYLE_KEYS)[number];

interface Measure {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly style: Record<StyleKey, string>;
}

interface MeasureArgs {
  readonly probes: readonly Probe[];
  readonly keys: readonly StyleKey[];
}

/** Runs in the page (serialized, so self-contained): document-relative boxes and computed styles. */
function measure({ probes, keys }: MeasureArgs): (Measure | null)[] {
  return probes.map(({ selector, nth = 0, text }) => {
    const element = document.querySelectorAll(selector)[nth];
    if (!element) return null;
    let rect = element.getBoundingClientRect();
    if (text) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
      });
      const node = walker.nextNode();
      if (!node) return null;
      const range = document.createRange();
      const content = node.textContent ?? '';
      const start = content.length - content.trimStart().length;
      range.setStart(node, start);
      range.setEnd(node, content.trimEnd().length);
      rect = range.getBoundingClientRect();
    }
    const computed = getComputedStyle(element);
    const style = Object.fromEntries(keys.map((key) => [key, computed[key]])) as Record<
      StyleKey,
      string
    >;
    return {
      box: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      style,
    };
  });
}

const firstFamily = (family: string) =>
  family
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');

function sameStyle(key: StyleKey, a: string, b: string): boolean {
  if (key === 'fontFamily') return firstFamily(a) === firstFamily(b);
  const px = /^(-?[\d.]+)px$/;
  const [ma, mb] = [px.exec(a), px.exec(b)];
  if (ma && mb) return Math.abs(Number(ma[1]) - Number(mb[1])) <= 0.05;
  return a === b;
}

/** Every difference beyond the tolerances, one line each. */
function geometryDiffs(original: (Measure | null)[], ours: (Measure | null)[]): string[] {
  return PAIRS.flatMap((pair, i) => {
    const [a, b] = [original[i], ours[i]];
    if (!a || !b) return [`${pair.name}: missing in ${a ? 'ours' : 'the original'}`];
    const box = (['x', 'y', 'width', 'height'] as const)
      .filter((edge) => Math.abs(a.box[edge] - b.box[edge]) > GEOMETRY_TOLERANCE)
      .map(
        (edge) => `${pair.name} ${edge}: ${a.box[edge].toFixed(2)} vs ${b.box[edge].toFixed(2)}`,
      );
    const style = (pair.styles ?? STYLE_KEYS)
      .filter((key) => !sameStyle(key, a.style[key], b.style[key]))
      .map((key) => `${pair.name} ${key}: ${a.style[key]} vs ${b.style[key]}`);
    return [...box, ...style];
  });
}

/** Both pages must have the card's faces, or the comparison would be one of fallback fonts. */
const CARD_FACES = ['Cormorant Garamond normal', 'Cormorant Garamond italic', 'Jost normal'];

/** Applies the test CSS and waits for the fonts; answers the faces that loaded. */
async function settle(page: Page, css: string): Promise<string[]> {
  await page.addStyleTag({ content: css });
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => `${face.family.replaceAll('"', '')} ${face.style}`);
  });
}

async function screenshot(page: Page, mask: Locator): Promise<PNG> {
  const buffer = await page.screenshot({
    fullPage: true,
    mask: [mask],
    maskColor: MASK_COLOR,
    animations: 'disabled',
    caret: 'hide',
  });
  return PNG.sync.read(buffer);
}

/** Pads both to the larger size (padding counts as difference) and counts differing pixels. */
function pixelDiff(a: PNG, b: PNG): { ratio: number; mismatched: number; diff: PNG } {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (image: PNG) => {
    if (image.width === width && image.height === height) return image;
    const padded = new PNG({ width, height });
    padded.data.fill(0);
    PNG.bitblt(image, padded, 0, 0, image.width, image.height, 0, 0);
    return padded;
  };
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(pad(a).data, pad(b).data, diff.data, width, height, {
    threshold: PIXEL_THRESHOLD,
  });
  return { ratio: mismatched / (width * height), mismatched, diff };
}

for (const viewport of VIEWPORTS) {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`${viewport.width}×${viewport.height} ${colorScheme}`, () => {
      test.use({ viewport, colorScheme, reducedMotion: 'reduce' });

      test('the Muttertag billet matches the live card', async ({ page, context }, testInfo) => {
        const original = await context.newPage();
        await original.goto(ORIGINAL_URL, { waitUntil: 'networkidle' });
        expect(await settle(original, ORIGINAL_CSS)).toEqual(expect.arrayContaining(CARD_FACES));

        await mockBilletApi(page, { 'parity-token': publicBillet(PARITY_DOCUMENT) });
        await page.goto(OURS_URL);
        await expect(page.locator('app-billet-view .signature-sub')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await settle(page, OURS_CSS)).toEqual(expect.arrayContaining(CARD_FACES));

        const probes = (side: 'original' | 'ours') => PAIRS.map((pair) => pair[side]);
        const diffs = geometryDiffs(
          await original.evaluate(measure, { probes: probes('original'), keys: STYLE_KEYS }),
          await page.evaluate(measure, { probes: probes('ours'), keys: STYLE_KEYS }),
        );

        const before = await screenshot(original, original.locator('.botanical'));
        const after = await screenshot(page, page.locator('app-billet-view .scene'));
        const { ratio, mismatched, diff } = pixelDiff(before, after);
        for (const [name, image] of Object.entries({ original: before, ours: after, diff })) {
          const path = testInfo.outputPath(`${name}.png`);
          writeFileSync(path, PNG.sync.write(image));
          await testInfo.attach(`${name}.png`, { path, contentType: 'image/png' });
        }
        const size = `${before.width}×${before.height} vs ${after.width}×${after.height}`;
        console.log(
          `[parity] ${viewport.width}×${viewport.height} ${colorScheme}: ` +
            `${(ratio * 100).toFixed(3)} % of pixels differ (${mismatched}), pages ${size}`,
        );

        expect(diffs, 'geometry and computed styles').toEqual([]);
        expect(ratio, `pixel mismatch ratio (${size})`).toBeLessThanOrEqual(MAX_MISMATCH_RATIO);
      });
    });
  }
}
