import { describe, expect, it } from 'vitest';

import { createDocument } from '../../../../billet/billet-document';
import type { ModelAssetDto } from '../../../../core/models/models';
import { matchesAssetDefaults, withAsset } from './asset-defaults';

const cake: ModelAssetDto = {
  slug: 'birthday-cake',
  nameDe: 'Geburtstagstorte',
  nameEn: 'Birthday cake',
  occasion: 'birthday',
  fileUrl: 'models/birthday-cake.v1.glb',
  previewUrl: 'models/previews/birthday-cake.v1.webp',
  fileSizeBytes: 1,
  credit: null,
  active: true,
  defaults: {
    fitSize: 2,
    yOffset: -0.05,
    exposure: 0.85,
    cameraDistance: 3.1,
    cameraHeight: 0.3,
    autoRotateSpeed: 0.6,
  },
};

describe('asset defaults', () => {
  it("picking a model brings its framing and keeps the billet's height, rotation switch and texts", () => {
    const document = createDocument({ lang: 'de' });
    const scene = { ...document.scene, height: 30, autoRotate: false, hint: 'Hallo' };
    const next = withAsset({ ...document, scene }, cake);

    expect(next.scene).toEqual({ ...scene, modelSlug: 'birthday-cake', ...cake.defaults });
    expect(next.blocks).toBe(document.blocks);
    expect(matchesAssetDefaults(next.scene, cake.defaults)).toBe(true);
    expect(matchesAssetDefaults({ ...next.scene, cameraHeight: 0.31 }, cake.defaults)).toBe(false);
  });
});
