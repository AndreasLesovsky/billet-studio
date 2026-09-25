import { expect, test } from '@playwright/test';

import { FLOWER_BOUQUET, mockBilletApi, PARITY_DOCUMENT, publicBillet } from './support/billet-api';

// The recipient's page /b/:shareToken against a stand-in backend. The browser's language is
// English (Playwright's default locale), so the site UI is English while the billet is German.

/** A hero word wider than a phone: the midnight preset's script accent on the Christmas greeting. */
const CHRISTMAS_DOCUMENT = {
  ...PARITY_DOCUMENT,
  hero: { ...PARITY_DOCUMENT.hero, titleLine1: 'Frohe', titleLine2: 'Weihnachten' },
  typography: {
    ...(PARITY_DOCUMENT['typography'] as object),
    titleAccent: { fontId: 'great-vibes', weight: 400, italic: false, size: 1.1 },
  },
};

/** Line boxes the element's text is set on. */
function lineCount(element: Element): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getClientRects().length;
}

test.describe('public billet page', () => {
  test.beforeEach(async ({ page }) => {
    await mockBilletApi(page, {
      'parity-token': publicBillet(PARITY_DOCUMENT),
      'christmas-token': publicBillet(CHRISTMAS_DOCUMENT, null),
    });
  });

  test('a link that leads nowhere says so and leads home, and leaving it drops the noindex', async ({
    page,
  }) => {
    await page.goto('/b/no-such-token');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This billet is not here');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test('the billet sets the page title, its language and noindex', async ({ page }) => {
    await page.goto('/b/parity-token');

    await expect(page.locator('app-billet-view h1')).toHaveText(/Für\s*Mama/);
    await expect(page).toHaveTitle('Für Mama · Muttertag 2026');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('a CC-BY model is credited under the billet, with a link to its source', async ({
    page,
  }) => {
    await page.goto('/b/parity-token');

    const credit = page.locator('app-public-billet footer');
    await expect(credit).toContainText('3D model:');
    await expect(credit).toHaveAttribute('lang', 'en');
    const source = credit.getByRole('link', { name: 'Flower Bouquet by icecool (CC-BY-4.0)' });
    await expect(source).toHaveAttribute('href', FLOWER_BOUQUET.credit.split(' ').at(-1)!);
  });

  test('a hero word too wide for a phone shrinks onto one line instead of breaking', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/b/christmas-token');

    const accent = page.locator('app-billet-view .title-accent');
    await expect(accent).toHaveText('Weihnachten');
    await expect.poll(() => accent.evaluate(lineCount)).toBe(1);
  });
});
