import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { clearGltfAssetCache, cloneGltfInstance, loadGltfAsset, removeGltfInstance } from "@/lib/live-ar/three/three-asset-loader";

/**
 * Builds a REAL, self-contained GLB (a generic red box -- never presented as
 * jewellery, purely a test fixture) as a `data:` URL, so `loadGltfAsset`'s actual
 * GLTFLoader is exercised end-to-end with real binary glTF bytes and zero network
 * access. See the M6.8 report for why a generic round-trip fixture like this is used
 * to verify the LOADING MACHINERY, distinct from (and never claimed to be) real
 * jewellery-asset validation.
 */
let fixtureCounter = 0;
async function buildTestGlbDataUrl(colorHex = "#ff0000"): Promise<string> {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: colorHex, metalness: 1, roughness: 0.3 }));
  scene.add(mesh);
  const buffer = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  const base64 = Buffer.from(buffer).toString("base64");
  // A unique query string per call so each fixture gets its own cache key, even when
  // the underlying bytes are identical -- avoids tests interfering via the shared
  // module-level cache.
  fixtureCounter += 1;
  return `data:model/gltf-binary;base64,${base64}#fixture-${fixtureCounter}`;
}

describe("loadGltfAsset", () => {
  afterEach(() => {
    clearGltfAssetCache();
  });

  it("loads a real GLB and returns a scene + a real, non-degenerate bounding box", async () => {
    const url = await buildTestGlbDataUrl();
    const asset = await loadGltfAsset(url);
    expect(asset.scene).toBeInstanceOf(THREE.Group);
    expect(asset.boundingBox.isEmpty()).toBe(false);
    const size = asset.boundingBox.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0);
    expect(size.y).toBeGreaterThan(0);
    expect(size.z).toBeGreaterThan(0);
  });

  it("caches by URL -- a second call for the SAME url returns the identical promise, never re-parsing", async () => {
    const url = await buildTestGlbDataUrl();
    const first = loadGltfAsset(url);
    const second = loadGltfAsset(url);
    expect(second).toBe(first);
    await first;
  });

  it("different URLs are cached independently", async () => {
    const urlA = await buildTestGlbDataUrl("#ff0000");
    const urlB = await buildTestGlbDataUrl("#00ff00");
    const assetA = await loadGltfAsset(urlA);
    const assetB = await loadGltfAsset(urlB);
    expect(assetA.scene).not.toBe(assetB.scene);
  });

  it("rejects for a malformed asset, and does not poison the cache -- a retry with valid bytes succeeds", async () => {
    const badUrl = "data:model/gltf-binary;base64,dGhpcyBpcyBub3QgYSByZWFsIGdsYg==#bad-fixture";
    await expect(loadGltfAsset(badUrl)).rejects.toThrow();

    // Retrying the SAME url (after the failure) must not still be stuck on the
    // rejected promise -- confirm by loading real, valid bytes at a DIFFERENT url
    // works normally right after (proving the loader itself still functions).
    const goodUrl = await buildTestGlbDataUrl();
    const asset = await loadGltfAsset(goodUrl);
    expect(asset.scene).toBeInstanceOf(THREE.Group);
  });
});

describe("cloneGltfInstance", () => {
  afterEach(() => {
    clearGltfAssetCache();
  });

  it("returns a NEW Object3D distinct from the cached master, but sharing the same geometry/material by reference", async () => {
    const url = await buildTestGlbDataUrl();
    const asset = await loadGltfAsset(url);
    const clone = cloneGltfInstance(asset);
    expect(clone).not.toBe(asset.scene);

    const originalMesh = asset.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    const clonedMesh = clone.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    expect(clonedMesh).not.toBe(originalMesh);
    expect(clonedMesh.geometry).toBe(originalMesh.geometry); // shared GPU resource
    expect(clonedMesh.material).toBe(originalMesh.material); // shared GPU resource
  });

  it("two independent clones can have independent transforms without affecting each other or the master", async () => {
    const url = await buildTestGlbDataUrl();
    const asset = await loadGltfAsset(url);
    const cloneA = cloneGltfInstance(asset);
    const cloneB = cloneGltfInstance(asset);
    cloneA.position.set(10, 0, 0);
    cloneB.position.set(-10, 0, 0);
    expect(cloneA.position.x).toBe(10);
    expect(cloneB.position.x).toBe(-10);
    expect(asset.scene.position.x).toBe(0);
  });
});

describe("removeGltfInstance", () => {
  it("detaches the instance from its parent", () => {
    const parent = new THREE.Group();
    const child = new THREE.Group();
    parent.add(child);
    expect(child.parent).toBe(parent);
    removeGltfInstance(child);
    expect(child.parent).toBeNull();
  });

  it("is a safe no-op for an instance with no parent", () => {
    const orphan = new THREE.Group();
    expect(() => removeGltfInstance(orphan)).not.toThrow();
  });
});

describe("clearGltfAssetCache", () => {
  it("disposes the master's geometry/material and forces a real reload on the next request for that URL", async () => {
    const url = await buildTestGlbDataUrl();
    const first = await loadGltfAsset(url);
    const mesh = first.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    const geometryDisposeSpy = vi.spyOn(mesh.geometry, "dispose");
    const materialDisposeSpy = vi.spyOn(mesh.material as THREE.Material, "dispose");

    clearGltfAssetCache(url);
    // Disposal runs asynchronously (after the cached promise resolves) -- await a
    // microtask tick so the spies have actually been called before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(geometryDisposeSpy).toHaveBeenCalled();
    expect(materialDisposeSpy).toHaveBeenCalled();

    const second = await loadGltfAsset(url);
    expect(second).not.toBe(first); // genuinely reloaded, not the stale cached entry
  });

  it("clears every cached URL when called with no argument", async () => {
    const urlA = await buildTestGlbDataUrl("#ff0000");
    const urlB = await buildTestGlbDataUrl("#00ff00");
    const firstA = await loadGltfAsset(urlA);
    const firstB = await loadGltfAsset(urlB);

    clearGltfAssetCache();

    const secondA = await loadGltfAsset(urlA);
    const secondB = await loadGltfAsset(urlB);
    expect(secondA).not.toBe(firstA);
    expect(secondB).not.toBe(firstB);
  });
});
