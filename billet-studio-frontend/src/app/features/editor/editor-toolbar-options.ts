import { BILLET_LANGS, type BilletLang } from '../../billet/billet-document';

/** The preview's colour mode: the billet's own ('auto'), or forced light or dark. */
export type PreviewMode = 'auto' | 'light' | 'dark';

interface PreviewModeOption {
  readonly mode: PreviewMode;
  readonly labelKey: string;
  /** Shown where the choice is a menu item. */
  readonly icon: string;
}

export const PREVIEW_MODES: readonly PreviewModeOption[] = [
  { mode: 'auto', labelKey: 'EDITOR.MODE_AUTO', icon: 'bi-circle-half' },
  { mode: 'light', labelKey: 'EDITOR.MODE_LIGHT', icon: 'bi-sun' },
  { mode: 'dark', labelKey: 'EDITOR.MODE_DARK', icon: 'bi-moon-stars' },
];

const LANGUAGE_KEYS: Readonly<Record<BilletLang, string>> = {
  de: 'NAV.LANGUAGE_DE',
  en: 'NAV.LANGUAGE_EN',
};

/** The billet's languages, each named in its own language. */
export const LANG_OPTIONS = BILLET_LANGS.map((lang) => ({ lang, labelKey: LANGUAGE_KEYS[lang] }));
