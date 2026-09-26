import { FONT_ROLES, type BilletDocument } from '../../billet/billet-document';
import { roleTexts } from '../../billet/role-texts';
import { fontStack } from '../../billet/typography';

/** The longest the page holds the billet back for its fonts; a slow font then swaps in. */
const FONT_WAIT_CAP_MS = 1500;

/** One face to load: a CSS font shorthand and the characters it has to cover. */
export interface FontFaceRequest {
  readonly font: string;
  readonly text: string;
}

/**
 * The faces the billet's text is set in: each used role's font, weight and style. Body text is also
 * needed italic (cards, notes, *emphasis*). The characters pick the unicode-range subsets to load.
 */
export function billetFontFaces(document: BilletDocument): FontFaceRequest[] {
  const { typography } = document;
  const texts = roleTexts(document);
  const faces = new Map<string, string>();
  for (const role of FONT_ROLES) {
    const text = texts[role].join('');
    if (!text.trim()) continue;
    const ref = typography[role];
    const styles = role === 'body' ? ['normal', 'italic'] : [ref.italic ? 'italic' : 'normal'];
    for (const style of styles) {
      const font = `${style} ${ref.weight} 1em ${fontStack(ref, role)}`;
      faces.set(font, (faces.get(font) ?? '') + text);
    }
  }
  return Array.from(faces, ([font, text]) => ({ font, text: [...new Set(text)].join('') }));
}

/**
 * Resolves once every face has loaded or failed, or after the cap - whichever comes first. Without
 * a FontFaceSet (no CSS Font Loading API) it resolves at once.
 */
export function whenFontsReady(
  fonts: Pick<FontFaceSet, 'load'> | undefined,
  faces: readonly FontFaceRequest[],
  capMs = FONT_WAIT_CAP_MS,
): Promise<void> {
  if (!fonts || faces.length === 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, capMs)));
  const loaded = Promise.allSettled(faces.map(async (face) => fonts.load(face.font, face.text)));
  return Promise.race([loaded.then(() => undefined), cap]).finally(() => clearTimeout(timer));
}
