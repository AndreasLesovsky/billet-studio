import { inject, Injectable } from '@angular/core';
import type {
  AnimationClip,
  BufferGeometry,
  InstancedMesh,
  Material,
  Mesh,
  Object3D,
  SkinnedMesh,
  Texture,
} from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { ThreeRuntime } from './three-runtime';

/** Parsed assets kept in memory; beyond this the least recently used unused one is disposed. */
const CAPACITY = 4;

interface LoadProgress {
  readonly loaded: number;
  /** Content-Length of the response, 0 when unknown. */
  readonly total: number;
}

type ProgressListener = (progress: LoadProgress) => void;

export interface InstantiateOptions {
  /** Aborting rejects the call at once; the download itself continues into the cache. */
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressListener;
}

/** A scene's own copy of a cached asset. */
export interface AssetInstance {
  readonly root: Object3D;
  readonly clips: readonly AnimationClip[];
  /** Call once the scene no longer shows `root`; frees what the copy owns. Idempotent. */
  release(): void;
}

interface PendingLoad {
  readonly promise: Promise<GLTF>;
  readonly listeners: Set<ProgressListener>;
}

/**
 * GLB assets by URL, shared by every scene of the session (pattern: viewer.js `preloadModel`).
 * Scenes never render the cached asset itself: `instantiate` clones it, so disposing a scene never
 * breaks the next use of the asset.
 */
@Injectable({ providedIn: 'root' })
export class AssetCache {
  private readonly runtime = inject(ThreeRuntime);
  private readonly pending = new Map<string, PendingLoad>();
  /** Loaded assets, least recently used first. */
  private readonly loaded = new Map<string, GLTF>();
  /** Live instances per URL. A URL is pinned from the start of `instantiate`, so an asset is never
   * evicted between its load and its clone. */
  private readonly pins = new Map<string, number>();
  private loader: GLTFLoader | null = null;

  /**
   * The shared parsed asset: never mutate or render it. One load per URL; concurrent callers share
   * it, and a failed load is dropped so the next call retries.
   */
  load(url: string, onProgress?: ProgressListener): Promise<GLTF> {
    const cached = this.loaded.get(url);
    if (cached) {
      this.loaded.delete(url);
      this.loaded.set(url, cached);
      return Promise.resolve(cached);
    }
    let pending = this.pending.get(url);
    if (!pending) {
      const listeners = new Set<ProgressListener>();
      const promise = this.fetch(url, listeners);
      pending = { promise, listeners };
      this.pending.set(url, pending);
      promise.then(
        (gltf) => {
          this.pending.delete(url);
          this.loaded.set(url, gltf);
          this.evict(url);
        },
        () => this.pending.delete(url),
      );
    }
    if (onProgress) pending.listeners.add(onProgress);
    return pending.promise;
  }

  /** A deep copy of the asset (skinned and instanced meshes included) plus its animation clips. */
  async instantiate(url: string, options: InstantiateOptions = {}): Promise<AssetInstance> {
    const { signal, onProgress } = options;
    signal?.throwIfAborted();
    this.pin(url);
    try {
      const [bundle, gltf] = await untilAborted(
        Promise.all([this.runtime.load(), this.load(url, onProgress)]),
        signal,
      );
      return this.createInstance(url, bundle.cloneAsset(gltf.scene), gltf.animations);
    } catch (error) {
      this.unpin(url);
      throw error;
    } finally {
      if (onProgress) this.pending.get(url)?.listeners.delete(onProgress);
    }
  }

  private async fetch(url: string, listeners: ReadonlySet<ProgressListener>): Promise<GLTF> {
    const bundle = await this.runtime.load();
    this.loader ??= bundle.createGltfLoader();
    const loader = this.loader;
    return new Promise<GLTF>((resolve, reject) => {
      const report = ({ loaded, total }: ProgressEvent): void =>
        listeners.forEach((listener) => listener({ loaded, total }));
      loader.load(url, resolve, report, reject);
    });
  }

  private createInstance(
    url: string,
    root: Object3D,
    clips: readonly AnimationClip[],
  ): AssetInstance {
    let released = false;
    return {
      root,
      clips,
      release: () => {
        if (released) return;
        released = true;
        disposeCloneOwned(root);
        // The last user frees the GPU copies; a second live scene would only have to re-upload.
        if (this.unpin(url) === 0) releaseShared(root, false);
        this.evict();
      },
    };
  }

  private pin(url: string): void {
    this.pins.set(url, (this.pins.get(url) ?? 0) + 1);
  }

  /** Returns the instances left. */
  private unpin(url: string): number {
    const left = (this.pins.get(url) ?? 1) - 1;
    if (left > 0) this.pins.set(url, left);
    else this.pins.delete(url);
    return left;
  }

  /** Disposes least recently used assets beyond CAPACITY; pinned ones and `keep` stay. */
  private evict(keep?: string): void {
    for (const [url, gltf] of this.loaded) {
      if (this.loaded.size <= CAPACITY) return;
      if (url === keep || this.pins.has(url)) continue;
      this.loaded.delete(url);
      disposeCloneOwned(gltf.scene);
      releaseShared(gltf.scene, true);
    }
  }
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Frees what every clone owns itself: instance matrices/colours and bone textures. */
function disposeCloneOwned(root: Object3D): void {
  root.traverse((node) => {
    if ((node as InstancedMesh).isInstancedMesh) (node as InstancedMesh).dispose();
    else if ((node as SkinnedMesh).isSkinnedMesh) (node as SkinnedMesh).skeleton.dispose();
  });
}

/**
 * Dispatches dispose on the geometries, materials and textures of a tree, so renderers free their
 * GPU copies. The CPU data stays, so an asset still cached uploads again on its next use; an
 * evicted one also closes its decoded images.
 */
function releaseShared(root: Object3D, closeImages: boolean): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((node) => {
    const { geometry, material } = node as Partial<Mesh>;
    if (geometry) geometries.add(geometry);
    for (const entry of [material ?? []].flat()) materials.add(entry);
  });
  const textures = new Set<Texture>();
  for (const material of materials) {
    for (const value of Object.values(material) as unknown[]) {
      if (isTexture(value)) textures.add(value);
    }
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  for (const texture of textures) {
    texture.dispose();
    if (closeImages && typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
      texture.image.close();
    }
  }
}

function isTexture(value: unknown): value is Texture {
  return (value as Texture | null)?.isTexture === true;
}
