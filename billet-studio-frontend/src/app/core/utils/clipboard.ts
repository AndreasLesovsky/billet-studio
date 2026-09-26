/** How a copy went: into the clipboard, or only selected for the user to copy by keyboard. */
export type CopyOutcome = 'copied' | 'selected';

/**
 * Copies `text` with the Clipboard API. Where that is missing or refused (an insecure context, a
 * denied permission), `field` - which shows the same text - is focused and selected instead.
 */
export async function copyText(
  text: string,
  field: HTMLInputElement,
  clipboard: Pick<Clipboard, 'writeText'> | null = globalThis.navigator?.clipboard ?? null,
): Promise<CopyOutcome> {
  try {
    if (!clipboard) throw new Error('No Clipboard API');
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    field.focus();
    field.select();
    return 'selected';
  }
}
