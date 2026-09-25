import type { BilletDocument } from '../../../../billet/billet-document';
import type { ModelAssetDto, ModelDefaultsDto } from '../../../../core/models/models';

/** The scene fields a catalog model brings its own values for (tbl_models defaults). */
export const ASSET_DEFAULT_KEYS = [
  'fitSize',
  'yOffset',
  'exposure',
  'cameraDistance',
  'cameraHeight',
  'autoRotateSpeed',
] as const satisfies readonly (keyof ModelDefaultsDto)[];

type Scene = BilletDocument['scene'];

export function matchesAssetDefaults(scene: Scene, defaults: ModelDefaultsDto): boolean {
  return ASSET_DEFAULT_KEYS.every((key) => scene[key] === defaults[key]);
}

/** The model's own framing; height, rotation on/off and the texts stay the billet's. */
export function withAssetDefaults(
  document: BilletDocument,
  defaults: ModelDefaultsDto,
): BilletDocument {
  const scene: Scene = { ...document.scene };
  for (const key of ASSET_DEFAULT_KEYS) scene[key] = defaults[key];
  return { ...document, scene };
}

/** Another 3D model, framed with its defaults. */
export function withAsset(document: BilletDocument, asset: ModelAssetDto): BilletDocument {
  const next = withAssetDefaults(document, asset.defaults);
  return { ...next, scene: { ...next.scene, modelSlug: asset.slug } };
}
