import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Entry of the lazy three.js chunk, reached only through ThreeRuntime's dynamic import().

export { clone as cloneAsset } from 'three/examples/jsm/utils/SkeletonUtils.js';
export { SceneStage } from './scene-stage';

/**
 * Every GLB is meshopt-compressed (EXT_meshopt_compression). Quantization, WebP textures, GPU
 * instancing and unlit materials are extensions GLTFLoader handles itself.
 */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
