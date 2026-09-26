import { expect, test, type Page } from '@playwright/test';

import { mockGuestApi } from './support/guest-api';
import { withoutWebGl } from './support/scene';

// A guest's way through the editor: a template becomes a billet on this device, edits show in the
// preview, the history undoes them, the billet survives a reload and is managed in "Meine Billets".
// German UI (the browser's language); the backend answers only the model library.

test.use({ locale: 'de-DE' });

const FIRST_PARAGRAPH = /^Mit dir fühlt sich/;
const SECOND_PARAGRAPH = /^Ich liebe unsere/;
const EDIT_URL = /\/billets\/local\/[0-9a-z]+\/edit$/;
const INDEX_KEY = 'billet-studio.local.index';

const preview = (page: Page) => page.locator('app-preview-frame app-billet-view');
const previewBlocks = (page: Page) => preview(page).locator('app-billet-block');
const blockCards = (page: Page) => page.locator('app-block-editor');
const blockText = (page: Page, index: number) =>
  blockCards(page).nth(index).getByRole('textbox', { name: 'Text', exact: true });

/** A phone's toolbar shows the title as a button that opens its field in the side sheet. */
const PHONE_TITLE = 'Titel bearbeiten: Valentinstag';

/** /templates → "Vorlage verwenden" on Valentinstag → the new billet's editor. */
async function openValentinstag(page: Page): Promise<void> {
  await page.goto('/templates');
  await page.getByRole('link', { name: 'Vorlage verwenden Valentinstag' }).click();
  await expect(page).toHaveURL(EDIT_URL);
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(page.getByRole('button', { name: PHONE_TITLE })).toBeVisible();
  } else {
    await expect(page.getByRole('textbox', { name: 'Titel des Billets' })).toHaveValue(
      'Valentinstag',
    );
  }
}

/**
 * The labels of the editor's tabs that are not shown in full: hidden, cut by their tab, or pushed
 * out of the row. The row itself overflowing counts too.
 */
function truncatedTabs(page: Page) {
  return page.getByRole('tablist', { name: 'Bearbeiten' }).evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const cut = [...row.querySelectorAll('[role="tab"]')].flatMap((tab) => {
      const box = tab.getBoundingClientRect();
      const label = tab.querySelector('.ui-tab__label')!;
      const labelBox = label.getBoundingClientRect();
      const inside = labelBox.left >= box.left && labelBox.right <= box.right;
      const whole = labelBox.width > 1 && label.scrollWidth <= label.clientWidth;
      return inside && whole && box.right <= rowBox.right ? [] : [label.textContent!.trim()];
    });
    return row.scrollWidth > row.clientWidth ? [...cut, 'row overflows'] : cut;
  });
}

/** The billet documents this browser stores, by their index entry's order (newest first). */
function storedDocuments(page: Page) {
  return page.evaluate((indexKey) => {
    const index: { localId: string }[] = JSON.parse(localStorage.getItem(indexKey) ?? '[]');
    return index.map(({ localId }) =>
      JSON.parse(localStorage.getItem(`billet-studio.local.doc.${localId}`) ?? 'null'),
    );
  }, INDEX_KEY);
}

test.describe('editor as a guest', () => {
  let pageErrors: Error[];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await mockGuestApi(page);
    await withoutWebGl(page);
  });

  test.afterEach(() => {
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  });

  test('a template becomes a billet on this device, and its text edits show in the preview', async ({
    page,
  }) => {
    await openValentinstag(page);

    await expect(preview(page).locator('h1')).toHaveText(/Für dich,\s*mein Herz/);
    await expect(previewBlocks(page).first()).toHaveText(FIRST_PARAGRAPH);
    await expect(page.locator('app-editor-toolbar').getByText('Lokal gespeichert')).toBeVisible();

    await blockText(page, 0).fill('Danke, dass du immer für mich da bist.');
    await expect(previewBlocks(page).first()).toHaveText('Danke, dass du immer für mich da bist.');
  });

  test('picking another theme recolours the preview, never the editor', async ({ page }) => {
    await openValentinstag(page);
    const colours = () =>
      preview(page).evaluate((view) => {
        const style = getComputedStyle(view);
        return {
          background: style.backgroundColor,
          accent: style.getPropertyValue('--billet-accent'),
        };
      });
    // The editor's chrome: its panels' plane and text, and the accent of its buttons.
    const chrome = () =>
      page.locator('app-editor').evaluate((editor) => {
        const tab = getComputedStyle(editor.querySelector('[role="tab"][aria-selected="true"]')!);
        const inspector = getComputedStyle(editor.querySelector('.editor__inspector .ui-card')!);
        return [inspector.backgroundColor, inspector.color, inspector.fontFamily, tab.color];
      });
    const sakura = await colours();

    await page.getByRole('tab', { name: 'Design' }).click();
    const studio = await chrome();
    await page.getByRole('button', { name: 'Theme wählen' }).click();
    await page.locator('label.ui-theme-option', { hasText: 'Mitternacht' }).click();

    await expect.poll(async () => (await colours()).background).not.toBe(sakura.background);
    await expect.poll(async () => (await colours()).accent).not.toBe(sakura.accent);
    expect(await chrome()).toEqual(studio);
  });

  test('a block moves down by keyboard and keeps the focus on its button', async ({ page }) => {
    await openValentinstag(page);
    const down = blockCards(page).first().getByRole('button', { name: 'Nach unten' });

    await down.focus();
    await page.keyboard.press('Enter');

    await expect(previewBlocks(page).nth(0)).toHaveText(SECOND_PARAGRAPH);
    await expect(previewBlocks(page).nth(1)).toHaveText(FIRST_PARAGRAPH);
    await expect(blockText(page, 1)).toHaveValue(FIRST_PARAGRAPH);
    await expect(blockCards(page).nth(1).getByRole('button', { name: 'Nach unten' })).toBeFocused();
    await expect(page.getByText('Absatz ist jetzt an Position 2 von 4.')).toBeAttached();
  });

  test('Ctrl+Z in a text field undoes the editor history step by step, and redo brings it back', async ({
    page,
  }) => {
    await openValentinstag(page);
    const edited = 'Du bist die Beste.';

    await blockText(page, 0).fill(edited);
    await blockCards(page).first().getByRole('button', { name: 'Nach unten' }).click();
    await expect(previewBlocks(page).nth(1)).toHaveText(edited);

    const textarea = blockText(page, 1);
    await textarea.focus();
    await page.keyboard.press('Control+z');
    // The move is undone; the textarea is the same field and keeps the focus.
    await expect(previewBlocks(page).nth(0)).toHaveText(edited);
    await expect(blockText(page, 0)).toBeFocused();

    await page.keyboard.press('Control+z');
    await expect(blockText(page, 0)).toHaveValue(FIRST_PARAGRAPH);
    await expect(previewBlocks(page).nth(0)).toHaveText(FIRST_PARAGRAPH);
    await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeDisabled();

    await page.getByRole('button', { name: 'Wiederholen' }).click();
    await expect(blockText(page, 0)).toHaveValue(edited);
    await expect(previewBlocks(page).nth(0)).toHaveText(edited);
    await expect(previewBlocks(page).nth(1)).toHaveText(SECOND_PARAGRAPH);
  });

  test('an edit is still there after a reload, also one made just before it', async ({ page }) => {
    await openValentinstag(page);

    await page
      .getByRole('textbox', { name: 'Titel des Billets' })
      .fill('Für meinen Lieblingsmenschen');
    await expect
      .poll(async () => (await storedDocuments(page))[0].title)
      .toBe('Für meinen Lieblingsmenschen');
    // Still within the autosave's wait: leaving the page writes it.
    await blockText(page, 0).fill('Neu geschrieben.');
    await page.reload();

    await expect(page.getByRole('textbox', { name: 'Titel des Billets' })).toHaveValue(
      'Für meinen Lieblingsmenschen',
    );
    await expect(blockText(page, 0)).toHaveValue('Neu geschrieben.');
    await expect(previewBlocks(page).first()).toHaveText('Neu geschrieben.');
  });

  test('"Meine Billets" lists the billet, duplicates it and deletes the copy', async ({ page }) => {
    await openValentinstag(page);
    await page.goto('/billets');

    const titles = page.locator('app-billet-list h2');
    await expect(titles).toHaveText(['Valentinstag']);
    await expect(page.getByText('1 von 20 Plätzen belegt.')).toBeVisible();

    await page.getByRole('button', { name: 'Duplizieren Valentinstag' }).click();
    await expect(titles).toHaveText(['Valentinstag (Kopie)', 'Valentinstag']);

    await page.getByRole('button', { name: '„Valentinstag (Kopie)“ löschen' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Billet löschen?' });
    await dialog.getByRole('button', { name: 'Löschen' }).click();

    await expect(dialog).toBeHidden();
    await expect(titles).toHaveText(['Valentinstag']);
    expect(await storedDocuments(page)).toHaveLength(1);

    await page.getByRole('link', { name: 'Bearbeiten Valentinstag' }).click();
    await expect(page).toHaveURL(EDIT_URL);
  });

  test('the tab row shows every label in full beside three columns and beside two', async ({
    page,
  }) => {
    await openValentinstag(page);
    const tabs = page.getByRole('tablist', { name: 'Bearbeiten' }).getByRole('tab');

    for (const [width, count] of [
      [1280, 4],
      [870, 5],
    ]) {
      await page.setViewportSize({ width, height: 720 });
      await expect(tabs).toHaveCount(count);
      await expect.poll(() => truncatedTabs(page), `at ${width}px`).toEqual([]);
    }
  });

  test('on a phone the bottom tabs switch between preview and content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openValentinstag(page);

    const tabs = page.getByRole('tablist', { name: 'Bearbeiten' });
    const content = page.locator('#editor-panel-content');
    const previewPanel = page.locator('#editor-panel-preview');
    await expect(content).toBeVisible();
    await expect(previewPanel).toBeHidden();

    await tabs.getByRole('tab', { name: 'Vorschau' }).click();
    await expect(previewPanel).toBeVisible();
    await expect(content).toBeHidden();
    await expect(preview(page).locator('h1')).toBeInViewport();
    const bar = await tabs.boundingBox();
    expect(bar!.y + bar!.height).toBeCloseTo(844, 0);

    await tabs.getByRole('tab', { name: 'Inhalt' }).click();
    await expect(content).toBeVisible();
    await expect(previewPanel).toBeHidden();
  });

  test('on a phone the title opens the tools side sheet at its field; Esc goes back to it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openValentinstag(page);

    await page.getByRole('button', { name: PHONE_TITLE }).click();
    const sheet = page.getByRole('dialog', { name: 'Werkzeuge' });
    const title = sheet.getByRole('textbox', { name: 'Titel des Billets' });
    await expect(title).toBeFocused();
    await title.fill('Für meinen Lieblingsmenschen');
    await page.keyboard.press('Escape');

    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Titel bearbeiten: Für meinen Lieblingsmenschen' }),
    ).toBeFocused();
  });

  test('pasted tabs and carriage returns arrive as spaces and plain line breaks', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openValentinstag(page);
    const textarea = blockText(page, 0);

    await page.evaluate(() => navigator.clipboard.writeText('Liebe\tGrüße\r\nvon mir\r'));
    await textarea.fill('');
    await textarea.focus();
    await page.keyboard.press('Control+v');

    await expect(textarea).toHaveValue('Liebe Grüße\nvon mir\n');
    await expect
      .poll(async () => (await storedDocuments(page))[0].blocks[0].text)
      .toBe('Liebe Grüße\nvon mir\n');
  });
});
