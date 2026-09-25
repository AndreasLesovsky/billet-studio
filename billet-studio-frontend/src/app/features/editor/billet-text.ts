import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

import { sanitizeText, truncateGraphemes } from '../../billet/text/text-sanitize';

type TextControl = HTMLInputElement | HTMLTextAreaElement;

/**
 * Text hygiene for every billet text field, typed or pasted: no carriage return, a tab becomes a
 * space, no other control character (what the backend accepts), and never longer than the field's
 * maxlength - which [formField] sets from the schema's maxLength - cut between graphemes only.
 *
 * The listener captures, so at the target it runs before [formField] reads the value; while an IME
 * composes, the text is left alone until the composition ends.
 */
@Directive({ selector: 'input[appBilletText], textarea[appBilletText]' })
export class BilletText {
  constructor() {
    const element: TextControl = inject(ElementRef).nativeElement;
    const abort = new AbortController();
    inject(DestroyRef).onDestroy(() => abort.abort());

    element.addEventListener(
      'input',
      (event) => {
        if (!(event as InputEvent).isComposing) cleanText(element);
      },
      { capture: true, signal: abort.signal },
    );
    element.addEventListener(
      'compositionend',
      () => {
        if (cleanText(element)) element.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { signal: abort.signal },
    );
  }
}

/** Cleans the control's value in place, keeping the caret; true when it changed. */
function cleanText(element: TextControl): boolean {
  const raw = element.value;
  const max = element.maxLength >= 0 ? element.maxLength : Infinity;
  const cleaned = truncateGraphemes(sanitizeText(raw), max);
  if (cleaned === raw) return false;
  const caret = (element.selectionEnd ?? raw.length) - (raw.length - cleaned.length);
  element.value = cleaned;
  const at = Math.min(cleaned.length, Math.max(0, caret));
  element.setSelectionRange(at, at);
  return true;
}
