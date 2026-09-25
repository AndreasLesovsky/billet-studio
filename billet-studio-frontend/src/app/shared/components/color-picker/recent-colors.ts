import { Injectable, signal } from '@angular/core';

import { parseHexInput } from './color-math';

const STORAGE_KEY = 'billet-studio.recent-colors';
const MAX_RECENT = 10;

/**
 * The colours last picked in any colour picker, newest first, kept per browser. Storage can be
 * missing or blocked (private mode, disabled site data): the list then lives for the session only.
 */
@Injectable({ providedIn: 'root' })
export class RecentColors {
  private readonly list = signal<readonly string[]>(readStored());

  readonly colors = this.list.asReadonly();

  add(color: string): void {
    const hex = parseHexInput(color);
    if (!hex) return;
    const next = [hex, ...this.list().filter((c) => c !== hex)].slice(0, MAX_RECENT);
    this.list.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // No storage: the session list above is all there is.
    }
  }
}

function readStored(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    const colors = stored
      .map((entry) => (typeof entry === 'string' ? parseHexInput(entry) : null))
      .filter((hex): hex is string => hex !== null);
    return [...new Set(colors)].slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}
