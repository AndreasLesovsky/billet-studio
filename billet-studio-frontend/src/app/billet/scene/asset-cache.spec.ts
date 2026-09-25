import { TestBed } from '@angular/core/testing';
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';

import { AssetCache } from './asset-cache';
import { ThreeRuntime, type ThreeBundle } from './three-runtime';

interface LoadRequest {
  readonly url: string;
  readonly resolve: (gltf: GLTF) => void;
  readonly reject: (error: unknown) => void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

/** An AssetCache over a fake GLTFLoader whose requests the test answers. */
function setup() {
  const requests: LoadRequest[] = [];
  const loader = {
    load: (
      url: string,
      resolve: LoadRequest['resolve'],
      _: unknown,
      reject: LoadRequest['reject'],
    ) => requests.push({ url, resolve, reject }),
  };
  const bundle = {
    createGltfLoader: () => loader,
    cloneAsset: (root: Object3D) => root.clone(),
  } as unknown as ThreeBundle;
  TestBed.configureTestingModule({
    providers: [{ provide: ThreeRuntime, useValue: { load: () => Promise.resolve(bundle) } }],
  });

  const respond = async (url: string, gltf: GLTF) => {
    await settle();
    requests
      .filter((request) => request.url === url)
      .at(-1)
      ?.resolve(gltf);
    await settle();
  };
  return { cache: TestBed.inject(AssetCache), requests, respond };
}

/** A one-mesh asset that counts dispose events of its geometry, material and texture. */
function fakeAsset() {
  const texture = new Texture();
  const geometry = new BufferGeometry();
  const material = new MeshStandardMaterial({ map: texture });
  const disposed = vi.fn();
  for (const resource of [texture, geometry, material]) {
    resource.addEventListener('dispose', disposed);
  }
  const gltf = { scene: new Group().add(new Mesh(geometry, material)), animations: [] };
  return { gltf: gltf as unknown as GLTF, disposed };
}

describe('AssetCache', () => {
  it('loads a URL once for concurrent callers and retries after a failed load', async () => {
    const { cache, requests, respond } = setup();
    const first = cache.load('a.glb');
    const second = cache.load('a.glb');
    await settle();
    expect(requests).toHaveLength(1);

    requests[0].reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await expect(second).rejects.toThrow('offline');

    const retry = cache.load('a.glb');
    const asset = fakeAsset();
    await respond('a.glb', asset.gltf);
    expect(requests).toHaveLength(2);
    await expect(retry).resolves.toBe(asset.gltf);
  });

  it('keeps four assets and disposes the least recently used one no scene shows', async () => {
    const { cache, requests, respond } = setup();
    const [a, b, c, d, e] = Array.from({ length: 5 }, fakeAsset);

    const shown = cache.instantiate('a.glb');
    // A scene destroyed while its asset loads leaves no pin behind.
    const abandoned = new AbortController();
    const gone = cache.instantiate('b.glb', { signal: abandoned.signal });
    abandoned.abort();
    await expect(gone).rejects.toBeDefined();

    await respond('a.glb', a.gltf);
    await respond('b.glb', b.gltf);
    const instance = await shown;
    for (const [url, asset] of [
      ['c.glb', c],
      ['d.glb', d],
      ['e.glb', e],
    ] as const) {
      const loading = cache.load(url);
      await respond(url, asset.gltf);
      await loading;
    }

    expect(b.disposed).toHaveBeenCalledTimes(3);
    expect(a.disposed).not.toHaveBeenCalled();
    expect(instance.root).not.toBe(a.gltf.scene);

    // Releasing the scene's copy frees its GPU side only; the cached asset serves the next scene.
    instance.release();
    expect(a.disposed).toHaveBeenCalledTimes(3);
    await expect(cache.load('a.glb')).resolves.toBe(a.gltf);
    expect(requests).toHaveLength(5);
  });
});
