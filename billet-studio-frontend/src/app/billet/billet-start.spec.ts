import { convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';

import type { ModelAssetDto } from '../core/models/models';
import { billetPresetFor } from '../core/theme/billet-theme-presets.generated';
import { createDocument } from './billet-document';
import { parseStartParams, startDocument, type StartParams } from './billet-start';

function asset(slug: string, overrides: Partial<ModelAssetDto> = {}): ModelAssetDto {
  return {
    slug,
    nameDe: 'Geschenk',
    nameEn: 'Gift box',
    occasion: 'general',
    fileUrl: `models/${slug}.v1.glb`,
    previewUrl: `models/previews/${slug}.v1.webp`,
    fileSizeBytes: 1,
    credit: null,
    active: true,
    defaults: {
      fitSize: 1.3,
      yOffset: -0.08,
      exposure: 0.6,
      cameraDistance: 2.8,
      cameraHeight: 0.1,
      autoRotateSpeed: 0.45,
    },
    ...overrides,
  };
}

const NONE: StartParams = {
  templateId: null,
  themeId: null,
  model: null,
  particles: null,
  divider: null,
  colorMode: null,
  lang: null,
};

const params = (values: Record<string, string>) => parseStartParams(convertToParamMap(values));

describe('billet start params', () => {
  it('reads every known value of a start link', () => {
    expect(
      params({
        template: 'geburtstag',
        theme: 'midnight',
        model: 'champagne-bottle',
        particles: 'none',
        divider: 'star',
        colorMode: 'dark',
        lang: 'en',
      }),
    ).toEqual({
      templateId: 'geburtstag',
      themeId: 'midnight',
      model: 'champagne-bottle',
      particles: 'none',
      divider: 'star',
      colorMode: 'dark',
      lang: 'en',
    });
  });

  it('reads unknown, malformed or missing values as "the template decides"', () => {
    expect(
      params({
        template: 'BLANK',
        theme: 'studio',
        model: '../etc',
        particles: 'NONE',
        divider: 'zigzag',
        colorMode: 'system',
        lang: 'fr',
      }),
    ).toEqual(NONE);
    expect(params({})).toEqual(NONE);
  });

  it('builds the template in the link language with its theme, model, particles, divider and mode', () => {
    const bottle = asset('champagne-bottle', { nameDe: 'Champagnerflasche' });
    const { document, templateId } = startDocument(
      {
        ...NONE,
        templateId: 'geburtstag',
        themeId: 'midnight',
        model: 'champagne-bottle',
        particles: 'snowflake',
        divider: 'line',
        colorMode: 'dark',
        lang: 'en',
      },
      'de',
      [bottle],
    );

    const template = createDocument({ lang: 'en', templateId: 'geburtstag' });
    const midnight = billetPresetFor('midnight');
    expect(templateId).toBe('geburtstag');
    expect(document.lang).toBe('en');
    expect(document.hero).toEqual(template.hero);
    expect(document.theme).toBe('midnight');
    expect(document.palette.dark).toEqual(midnight.palette.dark);
    expect(document.scene).toMatchObject({
      enabled: true,
      modelSlug: 'champagne-bottle',
      ariaLabel: '3D champagne bottle, drag to rotate',
      hint: template.scene.hint,
      ...bottle.defaults,
    });
    expect(document.particles).toMatchObject({
      enabled: true,
      shape: 'snowflake',
      colors: midnight.particleColors,
    });
    expect(document.divider).toEqual({ style: 'line' });
    expect(document.colorMode).toBe('dark');
  });

  it('switches the scene and the particles off for "none"', () => {
    const { document } = startDocument(
      { ...NONE, templateId: 'weihnachten', model: 'none', particles: 'none' },
      'de',
    );

    expect(document.scene.enabled).toBe(false);
    expect(document.particles.enabled).toBe(false);
  });

  it('keeps the template model for a slug that is not active in the library', () => {
    const template = createDocument({ lang: 'de', templateId: 'hochzeit' });
    const library = [asset('gift-box', { active: false })];

    for (const model of ['gift-box', 'unicorn']) {
      const { document } = startDocument({ ...NONE, templateId: 'hochzeit', model }, 'de', library);
      expect(document.scene).toEqual(template.scene);
    }
  });

  it('names a model the templates do not use after its library name', () => {
    const { document } = startDocument({ ...NONE, model: 'gift-box' }, 'de', [asset('gift-box')]);

    expect(document.scene.ariaLabel).toBe('3D Geschenk, interaktiv drehbar');
  });
});
