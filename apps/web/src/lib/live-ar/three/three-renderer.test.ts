import { describe, expect, it } from "vitest";
import type * as THREE from "three";

import { getThreeRenderStats } from "@/lib/live-ar/three/three-renderer";

// createThreeRenderer/resizeThreeRenderer/renderThreeFrame/disposeThreeRenderer are
// NOT tested here -- constructing a real THREE.WebGLRenderer requires a real WebGL2
// context, which jsdom's canvas.getContext("webgl2") returns null for (verified
// directly, same as occlusion-pixel.test.ts's file docstring documents for Canvas 2D
// before node-canvas was introduced there). See this module's own file docstring.

function fakeRendererInfo(overrides: Partial<{ calls: number; triangles: number; textures: number; geometries: number }> = {}): THREE.WebGLRenderer["info"] {
  return {
    render: { calls: overrides.calls ?? 0, triangles: overrides.triangles ?? 0, points: 0, lines: 0, frame: 0 },
    memory: { textures: overrides.textures ?? 0, geometries: overrides.geometries ?? 0 },
    programs: null,
    autoReset: true,
    reset: () => {},
    update: () => {},
  } as unknown as THREE.WebGLRenderer["info"];
}

describe("getThreeRenderStats", () => {
  it("reads real numbers directly off the renderer's own info object -- never estimated", () => {
    const info = fakeRendererInfo({ calls: 3, triangles: 1200, textures: 2, geometries: 1 });
    expect(getThreeRenderStats(info)).toEqual({ drawCalls: 3, triangles: 1200, textures: 2, geometries: 1 });
  });

  it("reports all-zero for a fresh/idle renderer, never a fabricated placeholder", () => {
    expect(getThreeRenderStats(fakeRendererInfo())).toEqual({ drawCalls: 0, triangles: 0, textures: 0, geometries: 0 });
  });
});
