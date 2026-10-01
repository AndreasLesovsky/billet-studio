import { expect, test, type Page } from '@playwright/test';

import { AccountBackend } from './support/account-api';
import { mockAssistant, type AssistBillet } from './support/assist-api';
import { mockGuestApi } from './support/guest-api';
import { withoutWebGl } from './support/scene';

// The billet assistant in the template gallery and on the home page: a sentence, an offer, a
// follow-up that changes one thing, and the offer started as a billet - on this device for a
// guest, in the account when signed in. The assistant's answers are mocked; what the model makes
// of a sentence is measured in AssistEval.

test.use({ locale: 'de-DE' });

const EDIT_URL = /\/billets\/local\/([0-9a-z]+)\/edit$/;

const BIRTHDAY: AssistBillet = {
  template: 'geburtstag',
  theme: 'midnight',
  particles: 'TEMPLATE_DEFAULT',
  divider: 'TEMPLATE_DEFAULT',
  colorMode: 'dark',
  lang: 'en',
  model: 'champagne-bottle',
};

const assistant = (page: Page) => page.getByRole('region', { name: 'Billet-Assistent' });
const message = (page: Page) => page.getByRole('textbox', { name: 'Dein Wunsch' });
const log = (page: Page) => page.getByRole('log', { name: 'Gespräch mit dem Assistenten' });

test.describe('billet assistant', () => {
  test.beforeEach(async ({ page }) => {
    await mockGuestApi(page);
    await withoutWebGl(page);
  });

  test('a suggestion, a follow-up and the offer started as a billet', async ({ page }) => {
    const mock = await mockAssistant(page, 'READY', [
      { billet: BIRTHDAY, notes: [] },
      { billet: { ...BIRTHDAY, colorMode: 'light' }, notes: [] },
    ]);
    await page.goto('/templates');

    await assistant(page)
      .getByRole('button', {
        name: 'Eine Geburtstagskarte für meinen Bruder, eher schick als bunt, mit Sektflasche statt Torte',
      })
      .click();
    const offers = log(page).getByRole('link', { name: 'Billet anlegen' });
    await expect(offers).toHaveCount(1);
    await expect(log(page)).toContainText('Champagnerflasche');
    await expect(log(page)).toContainText('Mitternacht');
    await expect(message(page)).toHaveValue('');

    await message(page).fill('lieber hell');
    await assistant(page).getByRole('button', { name: 'Senden' }).click();
    await expect(offers).toHaveCount(2);

    expect(mock.conversations[1]).toEqual([
      {
        role: 'user',
        content:
          'Eine Geburtstagskarte für meinen Bruder, eher schick als bunt, mit Sektflasche statt Torte',
        billet: null,
      },
      { role: 'assistant', content: null, billet: BIRTHDAY },
      { role: 'user', content: 'lieber hell', billet: null },
    ]);

    await offers.last().click();
    await expect(page).toHaveURL(EDIT_URL);
    await expect(page.getByRole('textbox', { name: 'Titel des Billets' })).toHaveValue('Birthday');
    const localId = EDIT_URL.exec(page.url())![1];
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      `billet-studio.local.doc.${localId}`,
    );
    expect(stored).toMatchObject({
      title: 'Birthday',
      lang: 'en',
      theme: 'midnight',
      colorMode: 'light',
      scene: { modelSlug: 'champagne-bottle', ariaLabel: '3D champagne bottle, drag to rotate' },
    });
  });

  test('offline it says so before anything is typed and sends nothing', async ({ page }) => {
    const mock = await mockAssistant(page, 'OFFLINE');
    await page.goto('/templates');

    await expect(assistant(page)).toContainText('gerade nicht erreichbar');
    await message(page).fill('Weihnachten, gemütlich');
    const send = assistant(page).getByRole('button', { name: 'Senden' });
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await message(page).press('Enter');

    await expect(message(page)).toHaveValue('Weihnachten, gemütlich');
    expect(mock.conversations).toEqual([]);
  });

  test('an answer that does not come is said under the message, which can be sent again', async ({
    page,
  }) => {
    await mockAssistant(page, 'READY', [null, { billet: BIRTHDAY, notes: [] }]);
    await page.goto('/templates');

    await message(page).fill('Eine Geburtstagskarte');
    await message(page).press('Enter');
    await expect(log(page)).toContainText('Der Assistent ist gerade nicht erreichbar');

    await log(page).getByRole('button', { name: 'Erneut versuchen' }).click();
    await expect(log(page).getByRole('link', { name: 'Billet anlegen' })).toHaveCount(1);
  });

  test('signed in, the offer on the home page creates the billet in the account', async ({
    page,
  }) => {
    const backend = new AccountBackend();
    await backend.install(page);
    await mockAssistant(page, 'READY', [{ billet: BIRTHDAY, notes: [] }]);
    await page.goto('/login');
    await page.getByLabel('E-Mail', { exact: true }).fill('anna@example.com');
    await page.getByLabel('Passwort', { exact: true }).fill('Test-Passwort-1');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/billets$/);

    await page.goto('/');
    await message(page).fill('Geburtstag, schick, mit Sekt');
    await message(page).press('Enter');
    await log(page).getByRole('link', { name: 'Billet anlegen' }).click();

    await expect(page).toHaveURL(/\/billets\/\d+\/edit$/);
    await expect(page.getByRole('textbox', { name: 'Titel des Billets' })).toHaveValue('Birthday');
    expect([...backend.billets.values()].map((billet) => billet.document.theme)).toEqual([
      'midnight',
    ]);
  });
});
