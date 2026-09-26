import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { AccountBackend } from './support/account-api';
import { mockBilletApi, PARITY_DOCUMENT, publicBillet } from './support/billet-api';
import { mockGuestApi } from './support/guest-api';
import { withoutWebGl } from './support/scene';

// axe (WCAG 2.0 A/AA, 2.1 AA) on every page a visitor reaches, in the states that add UI: the
// header menus, the delete confirmation, the editor (content tab, design tab with each picker open,
// in both colour modes; on a phone with its tools side sheet; on a tablet with its "More" menu), the
// share dialog, the billet page in both colour modes.
// German UI (the browser's language). A violation fails the test; the only accepted ones are
// listed in ACCEPTED with their reason.

test.use({ locale: 'de-DE' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

interface Accepted {
  readonly rule: string;
  /** A selector axe reports for the node. */
  readonly target: string;
  readonly reason: string;
}

/**
 * Deliberate deviations. axe cannot measure the billet's hero lines at all (their band is a
 * pseudo-element), so the hero label's accepted 3.7:1 (CLAUDE.md §11) never shows up here; billet
 * contrast is enforced on the presets by generate-themes.mjs and theme-contrast.spec.ts.
 */
const ACCEPTED: readonly Accepted[] = [
  {
    rule: 'color-contrast',
    target: '.ui-theme-card',
    reason:
      'A theme card is a picture of its billet preset (aria-hidden; the radio is named by the ' +
      "card's Studio label). Its sample word is the preset's accent on accentSoft, held at >= 3:1 " +
      "like the hero label it shows (rose: the live card's 3.7:1, a user decision). WCAG 1.4.3 " +
      'exempts text that is pure decoration or part of a picture.',
  },
];

/** One line per violating node, minus the accepted ones. */
async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations.flatMap((violation) =>
    violation.nodes
      .filter(
        (node) =>
          !ACCEPTED.some(
            (accepted) =>
              accepted.rule === violation.id && node.target.join(' ').includes(accepted.target),
          ),
      )
      .map(
        (node) =>
          `${violation.id} (${violation.impact}): ${node.target.join(' ')} - ${node.failureSummary?.replaceAll('\n', ' ')}`,
      ),
  );
}

/** axe reads colours as drawn: a toast still fading in would count as low contrast. */
function finiteAnimationsDone(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * The particle layer lies over the whole billet, empty under reduced motion (billet-particles.ts).
 * axe cannot see through it and would leave every line of billet text unmeasured.
 */
const PARTICLE_LAYER_HIDDEN = 'app-billet-particles { display: none !important; }';

async function expectAccessible(page: Page, state: string): Promise<void> {
  await page.addStyleTag({ content: PARTICLE_LAYER_HIDDEN });
  await finiteAnimationsDone(page);
  expect(await violations(page), state).toEqual([]);
}

/** /templates → "Vorlage verwenden" on Valentinstag → the new billet's editor. */
async function openValentinstag(page: Page): Promise<void> {
  await page.goto('/templates');
  await page.getByRole('link', { name: 'Vorlage verwenden Valentinstag' }).click();
  // A phone's toolbar shows the title as a button that opens its field in the side sheet.
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(
      page.getByRole('button', { name: 'Titel bearbeiten: Valentinstag' }),
    ).toBeVisible();
  } else {
    await expect(page.getByRole('textbox', { name: 'Titel des Billets' })).toHaveValue(
      'Valentinstag',
    );
  }
}

test.describe('accessibility', () => {
  test.describe('as a guest', () => {
    test.beforeEach(async ({ page }) => {
      await mockGuestApi(page);
      await withoutWebGl(page);
    });

    for (const { path, heading } of [
      { path: '/', heading: 'Deine Worte, mit einem Geschenk in 3D.' },
      { path: '/templates', heading: 'Vorlagen' },
      { path: '/login', heading: 'Anmelden' },
      { path: '/register', heading: 'Konto erstellen' },
      { path: '/billets', heading: 'Meine Billets' },
      { path: '/no-such-page', heading: 'Seite nicht gefunden' },
    ]) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await expectAccessible(page, path);
      });
    }

    test('the header menus open', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Farbmodus: System' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'colour mode menu');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Kontomenü' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'account menu');
    });

    test('/billets with a billet on this device, and its delete confirmation', async ({ page }) => {
      await openValentinstag(page);
      await page.goto('/billets');
      await expect(page.locator('app-billet-list h2')).toHaveText(['Valentinstag']);
      await expectAccessible(page, 'device billets');

      await page.getByRole('button', { name: '„Valentinstag“ löschen' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Billet löschen?' })).toBeVisible();
      await expectAccessible(page, 'delete confirmation');
    });

    test('the editor on a phone, and its tools side sheet', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openValentinstag(page);
      await expectAccessible(page, 'phone, content tab');

      await page.getByRole('tab', { name: 'Vorschau' }).click();
      await expect(page.locator('#editor-panel-preview')).toBeVisible();
      await expectAccessible(page, 'phone, preview tab');

      await page.getByRole('button', { name: 'Werkzeuge öffnen' }).click();
      await expect(page.getByRole('dialog', { name: 'Werkzeuge' })).toBeVisible();
      await expectAccessible(page, 'phone, tools side sheet');
    });

    test('the editor on a tablet, and its "More" menu', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await openValentinstag(page);
      await page.getByRole('button', { name: 'Mehr' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'tablet, "More" menu');
    });

    for (const colorScheme of ['light', 'dark'] as const) {
      test(`the editor in ${colorScheme} mode: content tab, design tab with its pickers open`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await openValentinstag(page);
        await expectAccessible(page, 'content tab');

        await page.getByRole('tab', { name: 'Design' }).click();
        await page.getByRole('button', { name: 'Theme wählen' }).click();
        await expect(page.getByRole('group', { name: 'Theme', exact: true })).toBeVisible();
        await expectAccessible(page, 'design tab, theme picker open');

        await page.getByRole('button', { name: 'Akzent #c2456f' }).click();
        await expect(page.getByRole('dialog', { name: 'Akzent' })).toBeVisible();
        await expectAccessible(page, 'design tab, colour picker open');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Schrift Playfair Display' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectAccessible(page, 'design tab, font picker open');
      });
    }
  });

  test('signed in: the billet list and the share dialog', async ({ page }) => {
    await new AccountBackend().install(page);
    await withoutWebGl(page);
    await openValentinstag(page);
    await page.goto('/login');
    await page.getByLabel('E-Mail', { exact: true }).fill('anna@example.com');
    await page.getByLabel('Passwort', { exact: true }).fill('Test-Passwort-1');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/billets$/);
    const notice = page.getByRole('region', { name: '1 Billet liegt nur auf diesem Gerät' });
    await expect(notice).toBeVisible();
    await expectAccessible(page, 'list with a device billet to move');

    await notice.getByRole('button', { name: 'Alle ins Konto übernehmen' }).click();
    const account = page.getByRole('region', { name: 'In deinem Konto' });
    await expect(account.getByRole('heading', { level: 3 })).toHaveText(['Valentinstag']);
    await expectAccessible(page, 'list with an account billet');

    await account.getByRole('button', { name: 'Teilen Valentinstag' }).click();
    const dialog = page.getByRole('dialog', { name: '„Valentinstag“ teilen' });
    await expect(dialog.getByRole('button', { name: 'Veröffentlichen' })).toBeVisible();
    await expectAccessible(page, 'share dialog, not published');

    await dialog.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Link zu deinem Billet' })).toBeVisible();
    await expectAccessible(page, 'share dialog, published');
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the billet page in ${colorScheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await mockBilletApi(page, { 'parity-token': publicBillet(PARITY_DOCUMENT) });
      await withoutWebGl(page);
      await page.goto('/b/parity-token');
      await expect(page.locator('app-billet-view .signature-sub')).toBeVisible();
      await expectAccessible(page, `/b/:token ${colorScheme}`);
    });
  }
});
