import type { BilletDocument } from '../../billet/billet-document';

/**
 * What a panel may ask of the editor beyond binding fields: changes that are one undo step of
 * their own. Provided by the Editor for everything inside it (`inject(EditorCommands)`); a class
 * token, so the panels never import the Editor itself.
 */
export abstract class EditorCommands {
  /**
   * Replaces the document with `update(current)` as one undo step, autosaved like any edit. The
   * update returns a new document and keeps every object it does not change (see EditorHistory):
   * spread what changes, never clone what does not. Picking a theme is one:
   * `commit((d) => applyThemePreset(d, themeId))`.
   */
  abstract commit(update: (document: BilletDocument) => BilletDocument): void;
}
