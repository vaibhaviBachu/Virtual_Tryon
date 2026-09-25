/**
 * Phase 2.5D (docs/2-5d-jewellery-surface-attachment.md) — a real, subdivided,
 * curved mesh that carries the ACTUAL jewellery artwork as a texture, instead of
 * either (a) a flat plane (no wrap behaviour at all) or (b) Phase D's procedural
 * primitives (real 3D wrap behaviour, but not the real artwork). This module is
 * PURE geometry construction: no textures, no materials, no live tracking, no
 * WebGL -- fully unit-testable.
 *
 * THE SHAPE: a "curved ribbon" -- a swept cross-section exactly like Phase D's own
 * `createSweptBandGeometry` (`jewellery-3d-generator/primitives.ts`), except the
 * cross-section here is a single-sided vertical STRIP (no depth/thickness --
 * `primitives.ts`'s cross-section is a solid rectangle because a procedural mesh
 * needs real volume; this ribbon carries a TEXTURE, which already encodes the
 * jewellery's own apparent thickness/shading in the photograph itself, so a second,
 * geometric thickness is not needed here and is deliberately not added). Reusing
 * this project's own already-proven "fixed reference axis, not Frenet frames"
 * discipline for the same reason `primitives.ts` documents it: a jewellery band's
 * curve is always a roughly-planar arc/loop around a body part with a known,
 * fixed axis, and Frenet frames twist unpredictably on exactly this class of curve.
 *
 * DELIBERATELY NOT LIVE-TRACKED: this geometry is built ONCE per item (like Phase
 * D's procedural mesh), from the item's OWN physical proportions -- never rebuilt
 * per frame from the currently-estimated neck size (Phase G Step 22's "do not
 * regenerate geometry every frame"). Per-frame movement/orientation is handled
 * entirely by the EXISTING rigid transform (`three-transform.ts`'s
 * `computeSurfaceAttachedTransform`, unmodified), applied to this mesh's `Object3D`
 * exactly as it already is to the procedural GLB -- this module has no knowledge
 * of, and no dependency on, live tracking at all.
 */
import * as THREE from "three";

export interface CurvedRibbonControlPoint {
  x: number;
  y: number;
  z: number;
}

export interface CurvedRibbonParams {
  /** The horizontal curve the ribbon follows, in the mesh's own local space (mm).
   * At least 2 points; a Catmull-Rom spline is fit through them (THREE.js's own
   * `CatmullRomCurve3`, the same spline type this project already uses throughout
   * `jewellery-3d-generator/curves.ts` for authored jewellery curvature). */
  controlPointsMm: CurvedRibbonControlPoint[];
  closed: boolean;
  /** The ribbon's real vertical extent (mm) -- typically the item's own
   * `physicalHeightMm`. */
  heightMm: number;
  /** The fixed reference "up" direction the ribbon's height is measured along at
   * every point on the curve -- see this module's file docstring for why a fixed
   * axis, not a Frenet frame. Defaults to world +Y. */
  upAxis?: { x: number; y: number; z: number };
  /** Sampling resolution along the curve. Configurable (Step 5's own explicit
   * ask), with a sensible, lightweight default -- NOT hardcoded without a way to
   * override it. */
  segmentsU?: number;
  /** Sampling resolution across the ribbon's height. */
  segmentsV?: number;
}

export const DEFAULT_RIBBON_SEGMENTS_U = 48;
export const DEFAULT_RIBBON_SEGMENTS_V = 16;

/**
 * Builds the curved ribbon as a real, textured-ready `THREE.BufferGeometry`.
 * UVs are a standard planar (u, v) grid mapping DIRECTLY onto the full texture
 * (u=0..1 across the curve, v=0..1 from top to bottom of the MESH) -- Step 6's own
 * requirement ("UV coordinates must map the original image correctly... do not
 * redraw or regenerate the artwork"): nothing about the source image is altered;
 * only where each pixel's corresponding vertex sits in 3D space changes.
 *
 * v=0-at-mesh-top is only correct paired with `texture.flipY = false` on the
 * consuming texture (`curved-2_5d-bridge.ts`'s `buildCurved25dAsset`) -- THREE's
 * DEFAULT `flipY = true` samples v=0 from the source image's BOTTOM row, not its
 * top (confirmed the hard way: an earlier version of this pairing rendered the
 * real Diamond Choker upside down on a real webcam -- its top row, the
 * pointed/spiked design elements, appeared at the mesh's bottom).
 *
 * Non-indexed (flat per-quad winding, matching `jewellery-3d-generator/
 * primitives.ts`'s own established convention) -- normals point along the fixed
 * reference "depth" direction, correct for a single-sided textured ribbon meant to
 * be viewed with `THREE.DoubleSide` material (the mesh has no back geometry to
 * speak of; the material renders both faces of the same thin ribbon).
 */
export function createCurvedRibbonGeometry(params: CurvedRibbonParams): THREE.BufferGeometry {
  const { controlPointsMm, closed, heightMm } = params;
  if (controlPointsMm.length < 2) {
    throw new Error("createCurvedRibbonGeometry requires at least 2 control points.");
  }
  const segmentsU = params.segmentsU ?? DEFAULT_RIBBON_SEGMENTS_U;
  const segmentsV = params.segmentsV ?? DEFAULT_RIBBON_SEGMENTS_V;
  const upAxisInput = params.upAxis ?? { x: 0, y: 1, z: 0 };
  const upAxis = new THREE.Vector3(upAxisInput.x, upAxisInput.y, upAxisInput.z).normalize();

  const points = controlPointsMm.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.5);

  const rowCount = segmentsU + 1;
  const rows: { center: THREE.Vector3; widthDir: THREE.Vector3 }[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = i / segmentsU;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    let widthDir = new THREE.Vector3().crossVectors(upAxis, tangent);
    if (widthDir.lengthSq() < 1e-8) widthDir = new THREE.Vector3().crossVectors(upAxis, new THREE.Vector3(1, 0, 0));
    widthDir.crossVectors(tangent, widthDir).normalize(); // re-orthogonalize: the ribbon's own "up," perpendicular to tangent
    rows.push({ center, widthDir });
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const halfHeight = heightMm / 2;

  const vertexAt = (rowIndex: number, colIndex: number): { pos: THREE.Vector3; uv: [number, number] } => {
    const row = rows[rowIndex];
    const v = colIndex / segmentsV; // 0 at top, 1 at bottom
    const yOffset = halfHeight - v * heightMm;
    const pos = row.center.clone().addScaledVector(row.widthDir, yOffset);
    const u = rowIndex / segmentsU;
    return { pos, uv: [u, v] };
  };

  for (let i = 0; i < rowCount - 1; i++) {
    for (let j = 0; j < segmentsV; j++) {
      const a = vertexAt(i, j);
      const b = vertexAt(i + 1, j);
      const c = vertexAt(i + 1, j + 1);
      const d = vertexAt(i, j + 1);
      // Two triangles, a-b-c and a-c-d.
      for (const [p1, p2, p3] of [
        [a, b, c],
        [a, c, d],
      ] as const) {
        positions.push(p1.pos.x, p1.pos.y, p1.pos.z, p2.pos.x, p2.pos.y, p2.pos.z, p3.pos.x, p3.pos.y, p3.pos.z);
        uvs.push(...p1.uv, ...p2.uv, ...p3.uv);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  return geometry;
}
