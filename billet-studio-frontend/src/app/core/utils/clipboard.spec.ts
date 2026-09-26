import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard';

describe('copyText', () => {
  const LINK = 'https://billet.example/b/abcdefghijklmnopqrstuv';

  function field(): HTMLInputElement {
    const input = document.createElement('input');
    input.value = LINK;
    document.body.append(input);
    return input;
  }

  afterEach(() => document.body.replaceChildren());

  it('writes the text to the clipboard and leaves the field alone', async () => {
    const writeText = vi.fn(async () => undefined);
    const input = field();

    expect(await copyText(LINK, input, { writeText })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(document.activeElement).not.toBe(input);
  });

  it('without a clipboard, or when it refuses, selects the whole field for a keyboard copy', async () => {
    const refused = { writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) };

    for (const clipboard of [null, refused]) {
      const input = field();
      expect(await copyText(LINK, input, clipboard)).toBe('selected');
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, LINK.length]);
    }
  });
});
