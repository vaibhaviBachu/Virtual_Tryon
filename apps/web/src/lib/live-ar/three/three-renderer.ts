/**
 * M6.8 3D rendering foundation — the persistent WebGL2 renderer (spec Step 3/7/17).
 *
 * `createThreeRenderer`/`renderThreeFrame` genuinely require a real WebGL2 context --
 * `canvas.getContext("webgl2")` returns `null` in this project's jsdom test
 * environment (the same category of gap `occlusion-pixel.test.ts` hit for Canvas 2D,
 * solved there with `node-canvas`; there is no equivalently lightweight drop-in for
 * WebGL2, so this module's genuinely GPU-dependent functions are NOT covered by
 * `vitest run` -- see docs/live-ar-3d-representation-assessment.md's M6.8 addendum
 * for how they were instead verified once, ad hoc, in a real headless browser).
 * `getThreeRenderStats` is a thin, pure read of `renderer.info` and IS unit-tested
 * against a fake object matching that shape.
 */
import * as THREE from "three";

/** Creates the persistent WebGLRenderer, explicitly requesting a WebGL2 context (spec
 * Step 1: "Use WebGL 2") with a transparent (`alpha: true`) background so this canvas
 * can be composited over the existing camera/2D canvas (spec Step 7). Call ONCE per
 * session (spec Step 17: "do NOT create new Three.js renderer every frame") --
 * callers own the returned instance and reuse it every frame. Throws (never silently
 * falls back to WebGL1) if this browser cannot provide a WebGL2 context, so a caller
 * can fall back to the existing 2D/2.5D renderer explicitly (spec Step 18) rather
 * than silently rendering with unverified capabilities. */
export function createThreeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!context) {
    throw new Error("WebGL2 is not available in this browser -- fall back to the existing PNG/2.5D renderer.");
  }
  const renderer = new THREE.WebGLRenderer({ canvas, context: context as WebGL2RenderingContext, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0); // fully transparent clear -- required for compositing over the camera feed
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** Resizes the renderer's drawing buffer to match the video viewport -- call only when
 * the size actually changed (mirrors `ensureCanvasSize`'s existing convention in
 * renderer.ts; `setSize`'s own `updateStyle` third argument is left at its default
 * `true` since this canvas is styled by CSS like every other canvas in this pipeline). */
export function resizeThreeRenderer(renderer: THREE.WebGLRenderer, widthPx: number, heightPx: number): void {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  if (size.x === widthPx && size.y === heightPx) return;
  renderer.setSize(widthPx, heightPx);
}

/** Renders exactly one frame. No per-frame allocation -- `scene`/`camera`/`renderer`
 * are all caller-owned, persistent objects (spec Step 17). */
export function renderThreeFrame(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  renderer.render(scene, camera);
}

export interface ThreeRenderStats {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

/** Real, measured render-cost indicators (spec Step 17: "Use renderer.info where
 * useful for: draw calls, triangles, textures, geometries") -- never estimated. Takes
 * the renderer's own `.info` object shape directly (not the renderer itself) so this
 * is testable against a plain fake object, without needing a real WebGLRenderer. */
export function getThreeRenderStats(info: THREE.WebGLRenderer["info"]): ThreeRenderStats {
  return {
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    textures: info.memory.textures,
    geometries: info.memory.geometries,
  };
}

/** Frees the renderer's own GPU context/resources (distinct from
 * three-asset-loader.ts's `clearGltfAssetCache`, which frees loaded ASSETS -- this
 * frees the renderer itself). Call when the Live AR session ends entirely, never per
 * jewellery-selection change. */
export function disposeThreeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
}
