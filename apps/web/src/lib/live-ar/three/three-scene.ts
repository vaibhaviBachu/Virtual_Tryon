/**
 * M6.8 3D rendering foundation — persistent scene + lighting (spec Step 13: "use a
 * lightweight real-time lighting setup... environment lighting / HDR environment +
 * restrained key/fill lighting... do not build a complicated cinematic renderer...
 * jewellery reacts to scene lighting rather than having a static yellow/orange
 * appearance").
 *
 * NO EXTERNAL HDR ASSET IS EMBEDDED OR FABRICATED (same "do not invent an asset that
 * doesn't exist" discipline as everywhere else this milestone): `applyEnvironmentLighting`
 * uses Three.js's own `RoomEnvironment` -- a small PROCEDURALLY GENERATED scene the
 * library ships specifically for this "give PBR metal materials something plausible to
 * reflect, without needing a real photographed HDR file" case. It is standard library
 * utility code, not a fabricated content asset.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface RestrainedLightingConfig {
  keyIntensity: number;
  fillIntensity: number;
}

export const DEFAULT_LIGHTING_CONFIG: RestrainedLightingConfig = { keyIntensity: 2, fillIntensity: 0.4 };

/** Creates the persistent scene. Callers create this ONCE (spec Step 17: "do NOT...
 * create new scene every frame") and reuse it every frame. */
export function createThreeScene(): THREE.Scene {
  return new THREE.Scene();
}

/** Adds a single restrained key light (a `DirectionalLight`, simulating one dominant
 * light direction) plus a dim ambient fill (never a second strong directional light --
 * "restrained," per spec Step 13) to `scene`. Returns both lights so a caller can
 * adjust intensity live (spec Step 13's "keep lighting configurable") without
 * recreating them. Pure Three.js object construction -- no WebGL context required,
 * so this is directly unit-testable. */
export function addRestrainedLighting(scene: THREE.Scene, config: RestrainedLightingConfig = DEFAULT_LIGHTING_CONFIG) {
  const key = new THREE.DirectionalLight(0xffffff, config.keyIntensity);
  key.position.set(1, 1, 1);
  const fill = new THREE.AmbientLight(0xffffff, config.fillIntensity);
  scene.add(key, fill);
  return { key, fill };
}

/** Generates a prefiltered environment map from `RoomEnvironment` and assigns it as
 * `scene.environment` (spec Step 13's "environment lighting" — this is what makes a
 * `metalness≈1` PBR material actually show reflections instead of looking flat).
 * REQUIRES A REAL WebGLRenderer -- `PMREMGenerator` performs an actual GPU render
 * pass internally, so unlike every other function in this module, this one cannot be
 * exercised in a jsdom/no-WebGL test environment. Kept as its own small, isolated
 * function specifically so that untestable surface is as small as possible (spec
 * Step 26 acknowledges this: "if 3D rendering cannot be unit-tested completely,
 * isolate the pure transformation mathematics and test that" -- the inverse of that
 * principle applies here: isolate the UNAVOIDABLY-GPU-dependent part). Disposes the
 * `RoomEnvironment` scene's own temporary resources after generating the map (the
 * PMREM texture itself is NOT disposed here -- it's assigned to `scene.environment`
 * and lives for the scene's lifetime; dispose it via `scene.environment?.dispose()`
 * when the scene itself is torn down). */
export function applyEnvironmentLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  pmremGenerator.dispose();
  return envTexture;
}
