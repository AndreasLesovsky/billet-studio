import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';

import { API_URL, pointAppAtE2eBackend } from './support/e2e-stack';

// The account flows against the real backend and a throwaway MariaDB (playwright.backend.config.ts,
// `npm run e2e:backend`): signing up, the autosave and its version conflict, the published snapshot
// behind a share link, a guest's billet moving into the account, deleting. Every test signs up an
// account of its own, so the tests share nothing and the database may outlive a run.

interface Account {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/**
 * German UI (the browser's language). Reduced motion stops the particles and the model's rotation:
 * with the real models loaded, parallel workers whose pages keep animating them starved the machine
 * until pages missed their timeouts; nothing here depends on motion.
 */
const BROWSER = { locale: 'de-DE', reducedMotion: 'reduce' } as const;

const test = base.extend<{ pageErrors: Error[]; visitor: BrowserContext }>({
  context: async ({ context }, use) => {
    await pointAppAtE2eBackend(context);
    await use(context);
  },
  pageErrors: [
    async ({ context }, use) => {
      const errors: Error[] = [];
      const watch = (page: Page) => page.on('pageerror', (error) => errors.push(error));
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(errors);
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
  /** Someone else's browser: its own storage and cookies, never signed in. */
  visitor: async ({ browser, pageErrors }, use) => {
    const visitor = await browser.newContext(BROWSER);
    await pointAppAtE2eBackend(visitor);
    visitor.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error)));
    await use(visitor);
    await visitor.close();
  },
});

test.use(BROWSER);

const ACCOUNT_EDIT_URL = /\/billets\/\d+\/edit$/;
const FIRST_PARAGRAPH = /^Du warst immer da/;
const FIRST_EDIT = 'Danke, dass du immer für mich da bist.';
const SECOND_EDIT = 'Und danke für jeden Sonntag am Telefon.';

const blockText = (page: Page, index: number) =>
  page.locator('app-block-editor').nth(index).getByRole('textbox', { name: 'Text', exact: true });
const firstBlock = (page: Page) => page.locator('app-billet-view app-billet-block').first();
const toolbar = (page: Page) => page.locator('app-editor-toolbar');
const saveStatus = (page: Page) => toolbar(page).locator('.editor-toolbar__status > span');
const accountBillets = (page: Page) => page.getByRole('region', { name: 'In deinem Konto' });

/** Unique per test and run: the database lives as long as its container, not as one run. */
function newAccount(): Account {
  const id = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  return { name: 'Anna Test', email: `anna.${id}@e2e.test`, password: 'E2e-Passwort-1' };
}

/** Through the API; the sign-up form has a test of its own. */
async function signUp(request: APIRequestContext, account: Account): Promise<void> {
  const response = await request.post(`${API_URL}auth/register`, {
    data: { ...account, preferredLanguage: 'de' },
  });
  expect(response.status()).toBe(201);
}

/** Fills and sends the login form the page shows. */
async function signIn(page: Page, { email, password }: Account): Promise<void> {
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

async function signUpAndIn(page: Page, request: APIRequestContext): Promise<void> {
  const account = newAccount();
  await signUp(request, account);
  await page.goto('/login');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/billets$/);
}

/** "Vorlage verwenden" in the gallery. */
async function useTemplate(page: Page, template: string): Promise<void> {
  await page.goto('/templates');
  await page.getByRole('link', { name: `Vorlage verwenden ${template}` }).click();
}

/** The page's next answer to `method` on a path matching `path`. */
function answer(page: Page, method: string, path: RegExp): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && path.test(new URL(response.url()).pathname),
  );
}

/** Replaces the first block's text and waits for the autosave's answer. */
async function editFirstBlock(page: Page, text: string): Promise<Response> {
  const saved = answer(page, 'PUT', /^\/v1\/billets\/\d+$/);
  await blockText(page, 0).fill(text);
  return saved;
}

test('signing up signs in and lands on the billet list', async ({ page }) => {
  const account = newAccount();
  await page.goto('/register');
  await page.getByLabel('Name', { exact: true }).fill(account.name);
  await page.getByLabel('E-Mail', { exact: true }).fill(account.email);
  await page.getByLabel('Passwort', { exact: true }).fill(account.password);
  await page.getByLabel('Passwort bestätigen', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();

  await expect(page).toHaveURL(/\/billets$/);
  await expect(accountBillets(page).getByText('0 von 50 Plätzen belegt.')).toBeVisible();
  await expect(
    accountBillets(page).getByRole('heading', { name: 'Noch keine Billets' }),
  ).toBeVisible();
});

test('a billet from a template saves itself, and a tab that saved late gets the conflict notice', async ({
  page,
  context,
  request,
}) => {
  await signUpAndIn(page, request);
  await useTemplate(page, 'Muttertag');
  await expect(page).toHaveURL(ACCOUNT_EDIT_URL);
  await expect(blockText(page, 0)).toHaveValue(FIRST_PARAGRAPH);

  // The edit is saved without asking, and the account has it after a reload.
  const saved = editFirstBlock(page, FIRST_EDIT);
  await expect(saveStatus(page)).toHaveText(/Speichert/);
  expect((await saved).status()).toBe(200);
  await expect(saveStatus(page)).toHaveText('Gespeichert');
  await page.reload();
  await expect(blockText(page, 0)).toHaveValue(FIRST_EDIT);

  // A second tab opens the same version; the first tab saves, then the second one does.
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(blockText(second, 0)).toHaveValue(FIRST_EDIT);
  expect((await editFirstBlock(page, SECOND_EDIT)).status()).toBe(200);
  expect((await editFirstBlock(second, 'Aus dem zweiten Tab.')).status()).toBe(409);

  const conflict = second.getByRole('alert').filter({ hasText: 'anderswo geändert' });
  await expect(conflict).toBeVisible();
  await expect(saveStatus(second)).toHaveText('Konflikt');

  // "Neu laden" takes the account's copy: the first tab's edit, nothing left to save.
  await conflict.getByRole('button', { name: 'Neu laden' }).click();
  await expect(conflict).toBeHidden();
  await expect(blockText(second, 0)).toHaveValue(SECOND_EDIT);
  await expect(saveStatus(second)).toHaveText('Gespeichert');
});

test('a share link shows the published snapshot to anyone, until changes are published or sharing stops', async ({
  page,
  context,
  request,
  visitor,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUpAndIn(page, request);
  await useTemplate(page, 'Muttertag');
  await expect(page).toHaveURL(ACCOUNT_EDIT_URL);
  expect((await editFirstBlock(page, FIRST_EDIT)).status()).toBe(200);

  // Publish, then copy the link.
  await toolbar(page).getByRole('button', { name: 'Teilen' }).click();
  const dialog = page.getByRole('dialog', { name: '„Muttertag für Mama“ teilen' });
  await dialog.getByRole('button', { name: 'Veröffentlichen' }).click();
  const link = dialog.getByRole('textbox', { name: 'Link zu deinem Billet' });
  await expect(link).toHaveValue(/^http:\/\/localhost:4320\/b\/[\w-]{22}$/);
  await dialog.getByRole('button', { name: 'Link kopieren' }).click();
  await expect(page.locator('app-toast').getByText('Link kopiert.')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toBe(await link.inputValue());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Someone without an account opens it.
  const shared = await visitor.newPage();
  await shared.goto(url);
  await expect(firstBlock(shared)).toHaveText(FIRST_EDIT);

  // A later edit stays private until it is published.
  expect((await editFirstBlock(page, SECOND_EDIT)).status()).toBe(200);
  await expect(toolbar(page).getByText('Unveröffentlichte Änderungen')).toBeVisible();
  await shared.reload();
  await expect(firstBlock(shared)).toHaveText(FIRST_EDIT);

  await toolbar(page).getByRole('button', { name: 'Teilen' }).click();
  const republished = answer(page, 'POST', /\/publish$/);
  await dialog.getByRole('button', { name: 'Änderungen veröffentlichen' }).click();
  expect((await republished).status()).toBe(200);
  await expect(toolbar(page).getByText('Veröffentlicht', { exact: true })).toBeVisible();
  await shared.reload();
  await expect(firstBlock(shared)).toHaveText(SECOND_EDIT);

  // Sharing stops: the link leads nowhere.
  await dialog.getByRole('button', { name: 'Nicht mehr teilen' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Nicht mehr teilen?' });
  const unpublished = answer(page, 'POST', /\/unpublish$/);
  await confirm.getByRole('button', { name: 'Nicht mehr teilen' }).click();
  expect((await unpublished).status()).toBe(204);
  await expect(dialog.getByRole('button', { name: 'Veröffentlichen' })).toBeVisible();
  await shared.reload();
  await expect(shared.getByRole('heading', { level: 1 })).toHaveText(
    'Dieses Billet gibt es hier nicht',
  );
});

test("a guest's billet moves into the account after signing in, and is deleted there", async ({
  page,
  request,
}) => {
  const account = newAccount();
  await signUp(request, account);
  const title = page.getByRole('textbox', { name: 'Titel des Billets' });

  // A guest starts a billet on this device and signs in from its editor.
  await useTemplate(page, 'Geburtstag');
  await expect(page).toHaveURL(/\/billets\/local\/[0-9a-z]+\/edit$/);
  await expect(title).toHaveValue('Geburtstag');
  await toolbar(page).getByRole('link', { name: 'Anmelden' }).click();
  await signIn(page, account);

  // Back in the billet, which lives on this device only until it is taken over.
  const device = page.getByRole('region', { name: 'Dieses Billet liegt nur auf diesem Gerät' });
  await device.getByRole('button', { name: 'Ins Konto übernehmen' }).click();
  await expect(page).toHaveURL(ACCOUNT_EDIT_URL);
  await expect(title).toHaveValue('Geburtstag');

  await page.goto('/billets');
  const billets = accountBillets(page);
  await expect(billets.getByRole('heading', { level: 3 })).toHaveText(['Geburtstag']);
  await expect(page.getByRole('heading', { name: 'Nur auf diesem Gerät' })).toBeHidden();

  await billets.getByRole('button', { name: '„Geburtstag“ löschen' }).click();
  const deleted = answer(page, 'DELETE', /^\/v1\/billets\/\d+$/);
  await page
    .getByRole('alertdialog', { name: 'Billet löschen?' })
    .getByRole('button', { name: 'Löschen' })
    .click();
  expect((await deleted).status()).toBe(204);
  await expect(billets.getByRole('heading', { name: 'Noch keine Billets' })).toBeVisible();
  await page.reload();
  await expect(billets.getByText('0 von 50 Plätzen belegt.')).toBeVisible();
});
