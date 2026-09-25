import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBlock, createDocument, type BilletDocument } from '../../billet/billet-document';
import {
  createEditorHistory,
  HISTORY_LIMIT,
  TYPING_STEP_MS,
  type EditorHistory,
} from './editor-history';

interface Doc {
  title: string;
  sub: string;
  count: number;
}

describe('createEditorHistory', () => {
  let clock: number;
  let model: WritableSignal<Doc>;
  let history: EditorHistory<Doc>;

  /** What [formField] does on a keystroke, followed by the editor's input listener. */
  function type(field: 'title' | 'sub', text: string, afterMs = 100): void {
    clock += afterMs;
    model.update((doc) => ({ ...doc, [field]: doc[field] + text }));
    history.record();
  }

  const titles = () => model().title;

  beforeEach(() => {
    clock = 0;
    model = signal<Doc>({ title: '', sub: '', count: 0 });
    history = createEditorHistory(model, { now: () => clock });
  });

  it('undoes and redoes steps in order, and a new change drops what could be redone', () => {
    for (const count of [1, 2, 3]) history.commit((doc) => ({ ...doc, count }));

    history.undo();
    history.undo();
    expect(model().count).toBe(1);
    history.redo();
    expect(model().count).toBe(2);
    expect(history.canRedo()).toBe(true);

    history.commit((doc) => ({ ...doc, count: 9 }));
    expect(history.canRedo()).toBe(false);
    history.redo();
    expect(model().count).toBe(9);

    history.undo();
    history.undo();
    history.undo();
    expect(model().count).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it('groups typing per field: one step until a pause, another field or a blur', () => {
    type('title', 'H');
    type('title', 'al');
    type('title', 'lo', TYPING_STEP_MS);
    type('title', ' Mama', TYPING_STEP_MS + 1);
    type('sub', 'von');
    type('title', '!');
    history.seal();
    type('title', '?');

    const steps: string[] = [];
    while (history.canUndo()) {
      history.undo();
      steps.push(`${titles()}|${model().sub}`);
    }
    expect(steps).toEqual(['Hallo Mama!|von', 'Hallo Mama|von', 'Hallo Mama|', 'Hallo|', '|']);
  });

  it('a change the form made since the last record is undone first, not lost', () => {
    type('title', 'Hallo');
    model.update((doc) => ({ ...doc, sub: 'unrecorded' }));
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(model()).toEqual({ title: 'Hallo', sub: '', count: 0 });
    history.redo();
    expect(model().sub).toBe('unrecorded');
  });

  it(`keeps the last ${HISTORY_LIMIT} steps`, () => {
    for (let count = 1; count <= HISTORY_LIMIT + 20; count++) {
      history.commit((doc) => ({ ...doc, count }));
    }
    let undone = 0;
    while (history.canUndo()) {
      history.undo();
      undone++;
    }
    expect(undone).toBe(HISTORY_LIMIT);
    expect(model().count).toBe(20);
  });

  it('undo restores the very block objects, so the form keeps the same fields', () => {
    const blocks = [createBlock('paragraph', { text: 'Eins' }), createBlock('note')];
    const doc = signal<BilletDocument>({ ...createDocument({ lang: 'de' }), blocks });
    const tree = TestBed.runInInjectionContext(() => form(doc));
    const billetHistory = createEditorHistory(doc);
    const firstField = tree.blocks[0];

    tree.blocks[0].text().value.set('Eins und zwei');
    billetHistory.record();
    billetHistory.commit((d) => ({ ...d, blocks: [...d.blocks].reverse() }));
    billetHistory.undo();
    billetHistory.undo();

    expect(doc().blocks[0]).toBe(blocks[0]);
    expect(doc().blocks[1]).toBe(blocks[1]);
    expect(tree.blocks[0]).toBe(firstField);
    expect(tree.blocks[0].text().value()).toBe('Eins');
  });
});
