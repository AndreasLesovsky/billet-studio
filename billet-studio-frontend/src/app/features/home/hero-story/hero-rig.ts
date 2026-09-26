import {
  AnimationMixer,
  Box3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  Quaternion,
  type ShaderMaterial,
  Vector3,
} from 'three';

import type { AssetInstance } from '../../../billet/scene/asset-cache';
import { fitTransform } from '../../../billet/scene/scene-math';
import type { HeroGiftAsset } from './hero-assets.generated';
import { parseDockExtras, type DockExtras } from './hero-framing';

// The story GLB's parts the runtime drives (docs/hero-story.md, "Node names" and "Materials the
// runtime replaces"), and the gifts built into GiftSlot → giftSpin → giftFit → gift.

const FX_PREFIX = 'Fx_';
const SHADOW_MATERIAL_PREFIX = 'M_Shadow_';
const PRINT_FRONT = 'M_Print_Front';
const PRINT_INSIDE = 'M_Print_Inside';
const SCREEN = 'M_Screen';
/** The Fx the story cannot do without; only shadow patches may lack theirs. */
const REQUIRED_FX = ['Wake', 'Notif', 'Billet', 'CardFade'] as const;

interface ShadowPatch {
  readonly material: Material;
  readonly baseOpacity: number;
  /** Fx_Shadow_<Name>; without one the patch stays at full strength. */
  readonly fx: Object3D | null;
}

/** The story's nodes and the materials the runtime cloned from it (it disposes those). */
export interface StoryRig {
  readonly cam: Object3D;
  readonly camTarget: Object3D;
  readonly slot: Object3D;
  readonly dock: Object3D;
  readonly dockExtras: DockExtras;
  readonly phone: Object3D;
  /** The phone's pose as the story clip last set it, without the idle float. */
  readonly phonePose: { readonly position: Vector3; readonly quaternion: Quaternion };
  readonly fx: ReadonlyMap<string, Object3D>;
  readonly cardMaterials: readonly Material[];
  readonly printFront: readonly MeshStandardMaterial[];
  readonly printInside: readonly MeshStandardMaterial[];
  readonly shadows: readonly ShadowPatch[];
  /** Every material the rig cloned; the screen material is not among them. */
  readonly owned: readonly Material[];
}

/**
 * Finds the contract's nodes in the story instance, clones the materials it changes (the cache's
 * originals stay untouched) and puts the display's ShaderMaterial on the screen. Throws when a
 * node the story needs is missing.
 */
export function bindStoryRig(root: Object3D, screen: ShaderMaterial): StoryRig {
  const node = (name: string): Object3D => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`Hero story: node ${name} is missing`);
    return found;
  };
  const fx = new Map<string, Object3D>();
  root.traverse((object) => {
    if (object.name.startsWith(FX_PREFIX)) fx.set(object.name.slice(FX_PREFIX.length), object);
  });
  // A misnamed Fx (a Blender duplicate suffix, a typo) would silently play a wrong story.
  const missingFx = REQUIRED_FX.filter((name) => !fx.has(name));
  if (missingFx.length > 0) {
    throw new Error(`Hero story: ${missingFx.map((name) => FX_PREFIX + name).join(', ')} missing`);
  }

  const clones = new Map<Material, Material>();
  const cloneOf = (material: Material): Material => {
    let clone = clones.get(material);
    if (!clone) {
      clone = material.clone();
      clones.set(material, clone);
    }
    return clone;
  };

  const card = node('Card');
  const cardMaterials = new Set<Material>();
  card.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mapMaterials(mesh.material, (material) => {
      // Shadow patches fade by their own Fx, whatever their parent.
      if (material.name === SCREEN || material.name.startsWith(SHADOW_MATERIAL_PREFIX)) {
        return material;
      }
      const clone = cloneOf(material);
      // Transparent for the whole story, so Fx_CardFade never switches programs mid-play; at
      // opacity 1 with depth writes it draws like an opaque material.
      clone.transparent = true;
      cardMaterials.add(clone);
      return clone;
    });
  });

  const shadows: ShadowPatch[] = [];
  let screens = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mapMaterials(mesh.material, (material) => {
      if (material.name === SCREEN) {
        screens++;
        return screen;
      }
      if (!material.name.startsWith(SHADOW_MATERIAL_PREFIX)) return material;
      const clone = cloneOf(material);
      if (!shadows.some((patch) => patch.material === clone)) {
        const name = material.name.slice(SHADOW_MATERIAL_PREFIX.length);
        shadows.push({
          material: clone,
          baseOpacity: material.opacity,
          fx: fx.get(`Shadow_${name}`) ?? null,
        });
      }
      return clone;
    });
  });
  if (screens === 0) throw new Error(`Hero story: no mesh uses ${SCREEN}`);

  const byName = (name: string): MeshStandardMaterial[] => {
    const found = [...cardMaterials].filter((m) => m.name === name) as MeshStandardMaterial[];
    if (found.length === 0) throw new Error(`Hero story: no card mesh uses ${name}`);
    return found;
  };
  const phone = node('Phone');
  const dock = node('Phone_ScreenDock');
  return {
    cam: node('Cam'),
    camTarget: node('CamTarget'),
    slot: node('GiftSlot'),
    dock,
    dockExtras: parseDockExtras(dock.userData),
    phone,
    phonePose: { position: phone.position.clone(), quaternion: phone.quaternion.clone() },
    fx,
    cardMaterials: [...cardMaterials],
    printFront: byName(PRINT_FRONT),
    printInside: byName(PRINT_INSIDE),
    shadows,
    owned: [...clones.values()],
  };
}

function mapMaterials(
  material: Material | Material[],
  map: (material: Material) => Material,
): Material | Material[] {
  return Array.isArray(material) ? material.map(map) : map(material);
}

/**
 * An Fx_<Name> empty's value: its local x, 0..1 (docs/hero-story.md, "Fx control values"). The
 * required ones exist (bindStoryRig checks them).
 */
export function fxValue(rig: StoryRig, name: (typeof REQUIRED_FX)[number]): number {
  return clamp01(rig.fx.get(name)?.position.x ?? 0);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Card fade and shadow strength for the current pose. */
export function applyRigFx(rig: StoryRig): void {
  const fade = fxValue(rig, 'CardFade');
  for (const material of rig.cardMaterials) {
    material.opacity = fade;
    material.visible = fade > 0.001;
  }
  for (const patch of rig.shadows) {
    patch.material.opacity = patch.baseOpacity * (patch.fx ? clamp01(patch.fx.position.x) : 1);
  }
}

/** A gift in its fit node, with its own mixer and exposure-compensated material clones. */
export interface HeroGift {
  /** giftFit: the gift at its billet-unit size, centred like the billet's scene. */
  readonly fit: Object3D;
  readonly mixer: AnimationMixer | null;
  readonly instance: AssetInstance;
  readonly materials: readonly Material[];
}

/**
 * Builds giftFit around a gift instance. The catalog gives each model its own exposure while the
 * hero renders with one, so each clone scales its final radiance by giftExposure / heroExposure,
 * which is exactly what the billet's toneMappingExposure does before the tone curve.
 */
export function createGift(
  instance: AssetInstance,
  asset: HeroGiftAsset,
  heroExposure: number,
): HeroGift {
  const box = new Box3().setFromObject(instance.root);
  const size = box.getSize(new Vector3());
  const [x, y, z] = box.getCenter(new Vector3()).toArray();
  const { scale, position } = fitTransform(
    { center: [x, y, z], maxDim: Math.max(size.x, size.y, size.z) },
    asset.fitSize,
    asset.yOffset,
  );

  const factor = asset.exposure / heroExposure;
  const clones = new Map<Material, Material>();
  instance.root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mapMaterials(mesh.material, (material) => {
      let clone = clones.get(material);
      if (!clone) {
        clone = compensate(material.clone(), factor);
        clones.set(material, clone);
      }
      return clone;
    });
  });

  const fit = new Object3D();
  fit.name = 'giftFit';
  fit.scale.setScalar(scale);
  fit.position.set(...position);
  fit.add(instance.root);
  const mixer = instance.clips.length > 0 ? new AnimationMixer(instance.root) : null;
  for (const clip of instance.clips) mixer?.clipAction(clip).play();
  mixer?.update(0);
  return { fit, mixer, instance, materials: [...clones.values()] };
}

const EXPOSURE_CHUNK = '#include <opaque_fragment>';

/**
 * Multiplies the material's outgoing light (direct, environment and emissive alike) by `factor`
 * before tone mapping: every built-in material ends with `outgoingLight` → opaque_fragment.
 */
function compensate(material: Material, factor: number): Material {
  if (factor === 1) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uGiftExposure'] = { value: factor };
    const body = shader.fragmentShader.replace(
      EXPOSURE_CHUNK,
      `outgoingLight *= uGiftExposure;\n${EXPOSURE_CHUNK}`,
    );
    shader.fragmentShader = `uniform float uGiftExposure;\n${body}`;
  };
  // The factor is a uniform: every compensated gift material of a kind shares one program.
  material.customProgramCacheKey = () => 'hero-gift-exposure';
  return material;
}

export function releaseGift(gift: HeroGift): void {
  gift.fit.removeFromParent();
  gift.mixer?.stopAllAction();
  gift.mixer?.uncacheRoot(gift.instance.root);
  gift.materials.forEach((material) => material.dispose());
  gift.instance.release();
}
