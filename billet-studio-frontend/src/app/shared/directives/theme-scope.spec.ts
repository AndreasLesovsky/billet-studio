import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ColorModeService } from '../../core/theme/color-mode-service';
import { ColorMode } from '../../core/theme/theme-registry.generated';
import { ThemeScope } from './theme-scope';

@Component({
  imports: [ThemeScope],
  template: `<div [appThemeScope]="theme()" [themeMode]="mode()"></div>`,
})
class Host {
  readonly theme = signal('sage');
  readonly mode = signal<ColorMode | undefined>(undefined);
}

/**
 * The binding rule "nothing outside the editor renders in an editor theme" (CLAUDE.md section 9):
 * a scope may only be opened by the editor, the theme picker and the dev ui-kit, and nothing but
 * ThemeScope writes data-theme (theme-boot.js sets the site theme on <html>).
 */
const APP = join('src', 'app');
const SCOPE_ALLOWED = [
  'shared/directives/theme-scope.ts',
  'shared/components/theme-picker/',
  'features/dev/ui-kit/',
  'features/editor/',
];
const THEME_WRITE =
  /\[attr\.data-theme\]|\sdata-theme\s*=|setAttribute\(\s*['"]data-theme|dataset(?:\.theme|\[['"]theme['"]\])\s*=(?!=)/;

/** Code only: a comment that names ThemeScope or data-theme is not a use. */
const withoutComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function sources(): { path: string; text: string }[] {
  return readdirSync(APP, { recursive: true, encoding: 'utf8' })
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => /\.(ts|html)$/.test(p) && !p.endsWith('.spec.ts'))
    .map((path) => ({ path, text: withoutComments(readFileSync(join(APP, path), 'utf8')) }));
}

describe('ThemeScope', () => {
  const resolvedMode = signal<ColorMode>('light');

  function render() {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: ColorModeService, useValue: { resolvedMode } }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const scope = (fixture.nativeElement as HTMLElement).querySelector('div')!;
    return { fixture, scope };
  }

  it('scopes its element to the theme, in the site mode unless a mode is given', () => {
    resolvedMode.set('dark');
    const { fixture, scope } = render();

    expect(scope.classList).toContain('ui-theme-scope');
    expect([scope.dataset['theme'], scope.dataset['mode']]).toEqual(['sage', 'dark']);

    resolvedMode.set('light');
    fixture.detectChanges();
    expect(scope.dataset['mode']).toBe('light');

    fixture.componentInstance.mode.set('dark');
    fixture.detectChanges();
    expect(scope.dataset['mode']).toBe('dark');
  });

  it('renders the default theme for an unknown id, the site theme included', () => {
    const { fixture, scope } = render();

    fixture.componentInstance.theme.set('studio');
    fixture.detectChanges();
    expect(scope.dataset['theme']).toBe('rose');
  });

  it('is used only by the editor, the theme picker and the dev ui-kit', () => {
    const violations = sources()
      .filter(({ text }) => /\bThemeScope\b|appThemeScope/.test(text))
      .map(({ path }) => path)
      .filter((path) => !SCOPE_ALLOWED.some((allowed) => path.startsWith(allowed)));

    expect(violations).toEqual([]);
  });

  it('is the only code that writes data-theme', () => {
    const violations = sources()
      .filter(({ path, text }) => path !== SCOPE_ALLOWED[0] && THEME_WRITE.test(text))
      .map(({ path }) => path);

    expect(violations).toEqual([]);
  });
});
