import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';

import { createModelUndo } from './model-undo';

describe('createModelUndo', () => {
  it('is not dirty before a baseline exists', () => {
    const model = signal({ name: 'Anna' });
    const undo = createModelUndo(model);

    model.set({ name: 'Anne' });

    expect(undo.canUndo()).toBe(false);
  });

  it('turns dirty on a change after the baseline and clean again when the value returns', () => {
    const model = signal({ name: 'Anna' });
    const undo = createModelUndo(model);
    undo.saveSnapshot();

    model.set({ name: 'Anne' });
    expect(undo.canUndo()).toBe(true);

    model.set({ name: 'Anna' });
    expect(undo.canUndo()).toBe(false);
  });

  it('undo restores the baseline', () => {
    const model = signal({ name: 'Anna', tags: ['a'] });
    const undo = createModelUndo(model);
    undo.saveSnapshot();
    model.set({ name: 'Anne', tags: ['a', 'b'] });

    undo.undo();

    expect(model()).toEqual({ name: 'Anna', tags: ['a'] });
    expect(undo.canUndo()).toBe(false);
  });

  it('the baseline is a copy: mutating a restored value cannot rewrite it', () => {
    const model = signal({ tags: ['a'] });
    const undo = createModelUndo(model);
    undo.saveSnapshot();

    undo.undo();
    model().tags.push('b');
    undo.undo();

    expect(model().tags).toEqual(['a']);
  });

  it('re-baselining after a save makes the saved state the clean one', () => {
    const model = signal({ name: 'Anna' });
    const undo = createModelUndo(model);
    undo.saveSnapshot();
    model.set({ name: 'Anne' });

    undo.saveSnapshot();

    expect(undo.canUndo()).toBe(false);
  });
});
