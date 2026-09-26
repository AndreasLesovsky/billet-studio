import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TEMPLATE_IDS, TEMPLATES } from '../../../billet/templates/templates';
import { HERO_ASSETS } from './hero-assets.generated';
import { HERO_HOME } from './hero-home.generated';

/** Every `url` in the table (story, prints, lock, messages, screens, gifts). */
function urls(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'url' && typeof entry === 'string' ? [entry] : urls(entry),
  );
}

// hero-assets.generated.ts is written from the pipeline's manifests; a template added or changed
// without re-running hero:gifts / hero:capture / hero:assets shows the wrong gift or no screen.
describe('hero assets', () => {
  it('shows each template with the gift its billets get', () => {
    const mismatches = TEMPLATE_IDS.filter(
      (id) => HERO_ASSETS.gifts[id]?.slug !== TEMPLATES[id].modelSlug,
    );
    expect(mismatches).toEqual([]);
  });

  it('has a screen texture with a scene area for every template, language and colour mode', () => {
    const missing = TEMPLATE_IDS.flatMap((id) =>
      (['de', 'en'] as const).flatMap((lang) =>
        (['light', 'dark'] as const)
          .filter((mode) => {
            const screen = HERO_ASSETS.screens[id]?.[lang]?.[mode];
            return !screen?.url || !(screen.sceneRect.h > 0);
          })
          .map((mode) => `${id} ${lang} ${mode}`),
      ),
    );
    expect(missing).toEqual([]);
  });

  // hero:capture and hero:gifts delete the hashed files they replace; a table not regenerated
  // afterwards would point the hero at files that are gone (and quietly drop it to no 3D).
  it('names only files that exist under public/', () => {
    const all = [...urls(HERO_ASSETS), ...(HERO_HOME.storyUrl ? [HERO_HOME.storyUrl] : [])];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((url) => !existsSync(join('public', url)))).toEqual([]);
  });

  it('gives the home page the same story and credits as the full table', () => {
    expect(HERO_HOME.storyUrl).toBe(HERO_ASSETS.story?.url ?? null);
    expect(
      TEMPLATE_IDS.filter((id) => HERO_HOME.credits[id] !== HERO_ASSETS.gifts[id].credit),
    ).toEqual([]);
  });
});
