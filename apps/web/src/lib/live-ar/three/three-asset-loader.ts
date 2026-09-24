/**
 * M6.8 3D rendering foundation — GLB/glTF loading + caching + disposal (spec Step 16:
 * "GLB assets must load once. Never reload the GLB every frame. Use a cache...
 * Dispose unused GPU resources appropriately").
 *
 * CACHE vs. INSTANCE, AND WHY DISPOSAL IS SPLIT ACROSS TWO FUNCTIONS: `loadGltfAsset`
 * caches the MASTER parsed scene per URL (never re-fetched/re-parsed once cached, same
 * discipline as asset-cache.ts's `loadJewelleryAssetTexture` for the 2D pipeline).
 * `cloneGltfInstance` gives each simultaneously-worn item (e.g. a necklace AND a
 * haaram worn together) its OWN `Object3D` with an independent transform, but Three.js's
 * `.clone()` SHARES the underlying geometry/material/texture GPU resources with the
 * cached master by reference (the normal, efficient way to have several instances of
 * one asset) -- so disposing an INSTANCE must never dispose those shared resources.
 * Only `clearGltfAssetCache` (evicting the master itself) actually calls `.dispose()`
 * on geometry/materials/textures. Removing an instance from the scene needs no
 * disposal call at all -- just detach it.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { LoadedGltfAsset } from "@/lib/live-ar/three/three-types";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedGltfAsset>>();

/** Loads (or returns the cached) GLB/glTF asset for a given URL. Never call this per
 * frame -- call it once when the jewellery selection changes (mirrors
 * asset-cache.ts's `loadJewelleryAssetTexture` doc comment exactly), and hold/clone
 * the result. If loading fails, the cache entry is removed so a retry can try again,
 * rather than being stuck on a rejected promise forever -- same convention as
 * asset-cache.ts. */
export function loadGltfAsset(url: string): Promise<LoadedGltfAsset> {
  const existing = cache.get(url);
  if (existing) return existing;

  const promise = new Promise<LoadedGltfAsset>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const boundingBox = new THREE.Box3().setFromObject(gltf.scene);
        resolve({ scene: gltf.scene, boundingBox });
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(`Failed to load glTF asset: ${url}`))
    );
  });
  cache.set(url, promise);
  promise.catch(() => cache.delete(url));
  return promise;
}

/** Gives one renderable instance of a cached asset its own `Object3D` (independent
 * position/quaternion/scale) while sharing the cached geometry/materials/textures by
 * reference -- see this module's file docstring for why disposing this returned
 * instance later must NOT call `.dispose()` on anything (use `removeGltfInstance`). */
export function cloneGltfInstance(asset: LoadedGltfAsset): THREE.Group {
  return asset.scene.clone(true);
}

/** Detaches an instance from its parent. No GPU disposal -- an instance never owns
 * its own geometry/material/texture (see this module's file docstring). Safe to call
 * even if the instance has no parent (a no-op then). */
export function removeGltfInstance(instance: THREE.Object3D): void {
  instance.parent?.remove(instance);
}

/** Actually frees GPU resources (geometry, every material property that is a
 * `Texture`, and the material itself) for a scene graph -- call this ONLY on a cached
 * MASTER asset when evicting it from the cache (e.g. the catalogue item was removed,
 * or the cache is being cleared for tests), never on a per-instance clone. */
function disposeObject3DResources(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

/** Evicts one (or, with no argument, every) cached glTF asset, disposing its GPU
 * resources. Never called per frame -- only when a catalogue item's asset genuinely
 * needs to be freed (e.g. removed from the current selection entirely) or in test
 * teardown. */
export function clearGltfAssetCache(url?: string): void {
  const urlsToClear = url ? [url] : Array.from(cache.keys());
  for (const key of urlsToClear) {
    const pending = cache.get(key);
    cache.delete(key);
    pending?.then((asset) => disposeObject3DResources(asset.scene)).catch(() => {});
  }
}
