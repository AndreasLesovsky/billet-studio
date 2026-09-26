import { expect, test } from '@playwright/test';

import { mockGuestApi } from './support/guest-api';
import { withoutWebGl } from './support/scene';

// The home hero where the story does not play by itself (docs/hero-story.md, "Idle phase"): the
// end poster stands on the stage. German UI, light mode.

test.use({ locale: 'de-DE', colorScheme: 'light' });

const END_POSTER = /^\/hero\/posters\/end-de-light\.[0-9a-f]{8}\.webp$/;
const CHAPTERS = ['Schreib deine Worte', 'Leg ein Geschenk in 3D hinein', 'Teile es per Link'];
/** The first load of the hero chunk and three.js from ng serve. */
const FALLBACK_TIMEOUT_MS = 20_000;

test.describe('home hero', () => {
  test.beforeEach(async ({ page }) => {
    await mockGuestApi(page);
    await withoutWebGl(page);
  });

  test('reduced motion: the end poster, the chapters as text and "Animation abspielen"', async ({
    page,
  }) => {
    await page.goto('/');
    const stage = page.getByRole('img', { name: 'Animation: vom Billet zum geteilten Link' });
    await expect(stage.locator('img')).toHaveAttribute('src', END_POSTER);
    await expect(page.locator('.ui-hero-chapter__title')).toHaveText(CHAPTERS);
    await expect(page.getByRole('button', { name: 'Animation abspielen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Animation anhalten' })).toHaveCount(0);
  });

  test('no WebGL: the end poster, no controls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const poster = page.getByRole('img', {
      name: 'Ein Handy zeigt ein digitales Billet zum Valentinstag, davor steht ein rotes Herz in 3D.',
    });
    await expect(poster).toHaveAttribute('src', END_POSTER, { timeout: FALLBACK_TIMEOUT_MS });
    await expect(page.locator('.ui-hero-chapter__title')).toHaveText(CHAPTERS);
    await expect(page.locator('app-hero-story, app-hero-chapters').getByRole('button')).toHaveCount(
      0,
    );
  });
});
