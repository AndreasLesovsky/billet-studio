import { expect, test, type Page } from '@playwright/test';

import { AccountBackend, SHARE_TOKEN } from './support/account-api';

// A guest's billet goes into the account at sign-in, is published and shared, and an edit made in
// the editor is published as a change - saved first, so the link shows what the editor shows.
// German UI (the browser's language); a stand-in backend keeps the account's billets.

test.use({ locale: 'de-DE' });

const INDEX_KEY = 'billet-studio.local.index';

/** The billets this browser still stores. */
const localBillets = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[], INDEX_KEY);

test.describe('billets in the account', () => {
  let pageErrors: Error[];
  let backend: AccountBackend;

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    backend = new AccountBackend();
    await backend.install(page);
  });

  test.afterEach(() => {
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  });

  test('sign in, move the device billet into the account, publish it, publish an edit, stop sharing', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // A guest starts a billet on this device, then signs in and lands on "Meine Billets".
    await page.goto('/templates');
    await page.getByRole('link', { name: 'Vorlage verwenden Muttertag' }).click();
    await expect(page).toHaveURL(/\/billets\/local\/[0-9a-f]+\/edit$/);
    await page.goto('/login');
    await page.getByLabel('E-Mail', { exact: true }).fill('anna@example.com');
    await page.getByLabel('Passwort', { exact: true }).fill('Test-Passwort-1');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/billets$/);

    const notice = page.getByRole('region', { name: '1 Billet liegt nur auf diesem Gerät' });
    await notice.getByRole('button', { name: 'Alle ins Konto übernehmen' }).click();
    await expect(notice).toBeHidden();
    const account = page.getByRole('region', { name: 'In deinem Konto' });
    await expect(account.getByRole('heading', { level: 3 })).toHaveText(['Muttertag für Mama']);
    await expect(
      account.getByRole('link', { name: 'Bearbeiten Muttertag für Mama' }),
    ).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Nur auf diesem Gerät' })).toBeHidden();
    expect(await localBillets(page)).toEqual([]);

    // Publish from the list, then copy the link.
    await account.getByRole('button', { name: 'Teilen Muttertag für Mama' }).click();
    const listDialog = page.getByRole('dialog', { name: '„Muttertag für Mama“ teilen' });
    await listDialog.getByRole('button', { name: 'Veröffentlichen' }).click();
    const link = listDialog.getByRole('textbox', { name: 'Link zu deinem Billet' });
    await expect(link).toHaveValue(new RegExp(`/b/${SHARE_TOKEN}$`));
    const copy = listDialog.getByRole('button', { name: 'Link kopieren' });
    await expect(copy).toBeFocused();
    await copy.click();
    await expect(page.locator('app-toast').getByText('Link kopiert.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
    await page.keyboard.press('Escape');
    await expect(listDialog).toBeHidden();
    await expect(account.locator('app-billet-card').getByText('Veröffentlicht')).toBeVisible();

    // An edit is an unpublished change at once; publishing it saves it first.
    await account.getByRole('link', { name: 'Bearbeiten Muttertag für Mama' }).click();
    const toolbar = page.locator('app-editor-toolbar');
    await expect(toolbar.getByText('Veröffentlicht')).toBeVisible();
    await page.getByRole('textbox', { name: 'Titel des Billets' }).fill('Für die beste Mama');
    await expect(toolbar.getByText('Unveröffentlichte Änderungen')).toBeVisible();
    await toolbar.getByRole('button', { name: 'Teilen' }).click();
    const editorDialog = page.getByRole('dialog', { name: '„Für die beste Mama“ teilen' });
    const publishChanges = editorDialog.getByRole('button', { name: 'Änderungen veröffentlichen' });
    await publishChanges.click();
    await expect(publishChanges).toBeDisabled();
    const [billet] = backend.billets.values();
    expect(billet.published?.title).toBe('Für die beste Mama');
    expect(backend.requests.slice(-2)).toEqual([
      `PUT /v1/billets/${billet.id}`,
      `POST /v1/billets/${billet.id}/publish`,
    ]);

    // Stop sharing, confirmed; the token stays, so the dialog says publishing brings the link back.
    await editorDialog.getByRole('button', { name: 'Nicht mehr teilen' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Nicht mehr teilen?' });
    await confirm.getByRole('button', { name: 'Nicht mehr teilen' }).click();
    await expect(confirm).toBeHidden();
    await expect(editorDialog.getByRole('button', { name: 'Veröffentlichen' })).toBeFocused();
    await expect(editorDialog.getByText(/schon einmal geteilt/)).toBeVisible();
    expect(billet.published).toBeNull();
    expect(billet.shareToken).toBe(SHARE_TOKEN);
  });
});
