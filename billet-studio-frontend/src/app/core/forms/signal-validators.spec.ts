import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { form, maxLength, minLength, pattern, required } from '@angular/forms/signals';

import {
  EMAIL_PATTERN,
  maxUtf8Bytes,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  nonBlank,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  passwordMatch,
} from './signal-validators';

interface Model {
  name: string;
  password: string;
  confirm: string;
}

function createForm(initial: Partial<Model> = {}) {
  const model = signal<Model>({ name: '', password: '', confirm: '', ...initial });
  const testForm = TestBed.runInInjectionContext(() =>
    form(model, (p) => {
      nonBlank(p.name, 'SPEC.NAME_REQUIRED');
      maxLength(p.name, NAME_MAX_LENGTH, { message: 'SPEC.MAX_LENGTH' });
      pattern(p.name, NAME_PATTERN, { message: 'SPEC.NAME_INVALID' });
      required(p.password, { message: 'SPEC.PASSWORD_REQUIRED' });
      minLength(p.password, PASSWORD_MIN_LENGTH, { message: 'SPEC.MIN_LENGTH' });
      maxUtf8Bytes(p.password, PASSWORD_MAX_BYTES, 'SPEC.PASSWORD_TOO_LONG');
      pattern(p.password, PASSWORD_PATTERN, { message: 'SPEC.PASSWORD_REQUIREMENTS' });
      passwordMatch(p.password, p.confirm, 'SPEC.PASSWORD_MISMATCH');
    }),
  );
  return { model, testForm };
}

describe('signal-validators', () => {
  describe('nonBlank', () => {
    it.each(['', '   ', '\t'])('rejects %j with its own message', (name) => {
      const { testForm } = createForm({ name });

      expect(testForm.name().errors()[0]).toMatchObject({
        kind: 'nonBlank',
        message: 'SPEC.NAME_REQUIRED',
      });
    });

    it('accepts any visible text', () => {
      const { testForm } = createForm({ name: 'Anna' });

      expect(testForm.name().errors()).toEqual([]);
    });
  });

  describe('passwordMatch', () => {
    it('puts the mismatch on the confirmation field, not on the password', () => {
      const { testForm } = createForm({ password: 'Secret123', confirm: 'Secret124' });

      expect(testForm.confirm().errors()[0]).toMatchObject({
        kind: 'passwordMismatch',
        message: 'SPEC.PASSWORD_MISMATCH',
      });
      expect(testForm.password().errors()).toEqual([]);
    });

    it('follows edits of either field', () => {
      const { model, testForm } = createForm({ password: 'Secret123', confirm: 'Secret123' });
      expect(testForm.confirm().valid()).toBe(true);

      model.update((m) => ({ ...m, password: 'Secret1234' }));

      expect(testForm.confirm().invalid()).toBe(true);
    });
  });

  describe('maxUtf8Bytes', () => {
    it('counts bytes, not characters - BCrypt reads at most 72 of them', () => {
      // 36 umlauts are 36 characters but 72 bytes: exactly at the limit.
      const atLimit = 'Aa1' + 'ä'.repeat(34) + 'b';
      expect(new TextEncoder().encode(atLimit).length).toBe(72);
      const { model, testForm } = createForm({ password: atLimit, confirm: atLimit });
      expect(testForm.password().valid()).toBe(true);

      const over = atLimit + 'ä';
      model.update((m) => ({ ...m, password: over, confirm: over }));

      expect(over.length).toBeLessThan(72);
      expect(testForm.password().errors()[0]).toMatchObject({
        kind: 'maxBytes',
        maxBytes: 72,
        message: 'SPEC.PASSWORD_TOO_LONG',
      });
    });
  });

  describe('the shared patterns', () => {
    it.each(['Anna', 'Jean-Luc', "O'Brien", 'Zoë Müller', 'Åsa'])(
      'NAME_PATTERN accepts %s',
      (name) => {
        expect(NAME_PATTERN.test(name)).toBe(true);
      },
    );

    it.each(['Anna1', 'Anna  Lena', ' Anna', 'Anna-', 'R2D2', 'a.b'])(
      'NAME_PATTERN rejects %j',
      (name) => {
        expect(NAME_PATTERN.test(name)).toBe(false);
      },
    );

    it.each(['anna@example.com', 'a.b-c@sub.example.de'])('EMAIL_PATTERN accepts %s', (email) => {
      expect(EMAIL_PATTERN.test(email)).toBe(true);
    });

    it.each(['anna', 'anna@example', 'anna@example.c', 'a b@example.com'])(
      'EMAIL_PATTERN rejects %j',
      (email) => {
        expect(EMAIL_PATTERN.test(email)).toBe(false);
      },
    );
  });
});
