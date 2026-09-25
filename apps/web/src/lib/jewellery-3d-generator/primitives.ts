/**
 * Phase D Step 2 — reusable procedural geometry primitives. These are the ONLY
 * mesh-generating functions in the whole system; every category strategy
 * (`strategies/`) composes these instead of writing its own geometry code (Phase D's
 * own explicit requirement: "do not duplicate mesh-generation logic across
 * categories").
 *
 * WHY A FIXED REFERENCE AXIS, NOT THREE.JS'S OWN FRENET FRAMES, FOR THE BAND SWEEP:
 * `Curve.computeFrenetFrames` is the standard way to orient a cross-section along a
 * general 3D path, but its normal/binormal vectors are only well-defined where the
 * curve has real curvature -- on a near-straight or symmetric segment (exactly the
 * shape of a choker's gentle front arc, or a ring/bangle's perfectly circular loop)
 * the Frenet normal can flip or spin unpredictably between samples, twisting the
 * swept cross-section. Every jewellery category this system targets (necklace,
 * haaram, bangle, bracelet, ring) is a band lying in a roughly flat plane, wrapping a
 * roughly-cylindrical body part whose own axis is known and fixed for the whole
 * piece -- so a FIXED reference "up" vector (the body part's own axis, e.g. vertical
 * for a neck, or a ring/bangle's own hole axis) is not a simplification, it is the
 * physically correct choice for this specific class of curves, and it never twists.
 *
 * FLAT SHADING VIA NON-INDEXED GEOMETRY: every primitive below builds a non-indexed
 * `BufferGeometry` (each triangle owns its own 3 unique vertex entries, never shared
 * with a neighboring triangle) before calling `computeVertexNormals()`. For
 * non-indexed geometry this produces correct per-face ("flat") normals with no
 * averaging across different faces -- appropriate for a faceted metal band, and far
 * simpler than hand-computing face normals.
 */
import * as THREE from "three";

import { buildJewelleryCurve } from "@/lib/jewellery-3d-generator/curves";
import type { BandGeometrySpec } from "@/lib/jewellery-3d-generator/types";

const DEFAULT_BAND_SEGMENTS = 48;

function toVector3(v: { x: number; y: number; z: number } | undefined, fallback: THREE.Vector3): THREE.Vector3 {
  if (!v) return fallback.clone();
  return new THREE.Vector3(v.x, v.y, v.z);
}

export interface BandFrame {
  center: THREE.Vector3;
  widthDir: THREE.Vector3;
  depthDir: THREE.Vector3;
}

/** The single, fundamental frame computation -- everything else (band sweeping,
 * pendant/drop/ornament placement) calls this so there is exactly one implementation
 * of "orient a cross-section at parameter t," never a second one recomputed by a
 * category strategy. See this module's file docstring for why a FIXED reference "up"
 * vector is used instead of `Curve.computeFrenetFrames`. */
export function computeBandFrameAt(curve: THREE.CatmullRomCurve3, t: number, upAxisInput?: { x: number; y: number; z: number }): BandFrame {
  const upAxis = toVector3(upAxisInput, new THREE.Vector3(0, 1, 0)).normalize();
  const center = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  let depthDir = new THREE.Vector3().crossVectors(tangent, upAxis);
  if (depthDir.lengthSq() < 1e-8) {
    // Degenerate only when the curve's tangent is (near-)parallel to upAxis -- not
    // expected for any real jewellery curve this system targets, but a safe,
    // arbitrary, non-degenerate fallback avoids ever producing a NaN/zero vertex.
    depthDir = new THREE.Vector3(1, 0, 0);
  }
  depthDir.normalize();
  const widthDir = new THREE.Vector3().crossVectors(depthDir, tangent).normalize();
  return { center, widthDir, depthDir };
}

/** Samples `count` evenly-spaced (by arc length) frames along a curve. Exported so
 * category strategies can position pendants/drops/ornaments relative to the SAME
 * frames the band geometry itself was swept from, rather than recomputing curve math
 * independently. */
export function sampleBandFrames(curve: THREE.CatmullRomCurve3, count: number, upAxisInput?: { x: number; y: number; z: number }): BandFrame[] {
  const frames: BandFrame[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    frames.push(computeBandFrameAt(curve, t, upAxisInput));
  }
  return frames;
}

function pushQuad(positions: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
  // Two triangles, a-b-c and a-c-d -- caller supplies corners already in a
  // consistent winding order for an outward-facing normal.
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
}

/** The swept-band primitive -- the shared geometry behind every band-like category
 * (necklace/haaram front arc, bangle/bracelet/ring closed loop). Produces a real,
 * closed 3D solid with the cross-section's own width/depth as genuine mesh extent
 * (never a flat plane -- Phase D Step 14's explicit requirement). */
export function createSweptBandGeometry(spec: BandGeometrySpec): THREE.BufferGeometry {
  const curve = buildJewelleryCurve(spec.curve);
  const closed = spec.curve.kind === "closed";
  const segments = spec.segments ?? DEFAULT_BAND_SEGMENTS;
  const halfWidth = spec.crossSection.widthMm / 2;
  const halfDepth = spec.crossSection.depthMm / 2;

  const frameCount = closed ? segments : segments + 1;
  const frames = sampleBandFrames(curve, frameCount, spec.upAxis);

  const corner = (frame: BandFrame, wSign: number, dSign: number): THREE.Vector3 =>
    frame.center.clone().addScaledVector(frame.widthDir, halfWidth * wSign).addScaledVector(frame.depthDir, halfDepth * dSign);

  const positions: number[] = [];
  const ringCount = closed ? frames.length : frames.length - 1;
  for (let i = 0; i < ringCount; i++) {
    const a = frames[i];
    const b = frames[(i + 1) % frames.length];
    // Corners, consistently ordered: top-front(+w+d), top-back(+w-d), bottom-back(-w-d), bottom-front(-w+d).
    const aTF = corner(a, 1, 1);
    const aTB = corner(a, 1, -1);
    const aBB = corner(a, -1, -1);
    const aBF = corner(a, -1, 1);
    const bTF = corner(b, 1, 1);
    const bTB = corner(b, 1, -1);
    const bBB = corner(b, -1, -1);
    const bBF = corner(b, -1, 1);

    pushQuad(positions, aTF, bTF, bTB, aTB); // top face
    pushQuad(positions, aTB, bTB, bBB, aBB); // back face
    pushQuad(positions, aBB, bBB, bBF, aBF); // bottom face
    pushQuad(positions, aBF, bBF, bTF, aTF); // front face
  }

  if (!closed) {
    const first = frames[0];
    const last = frames[frames.length - 1];
    // End caps -- an open band (choker/necklace/haaram) has two real cut ends;
    // a closed band (bangle/bracelet/ring) has none.
    pushQuad(positions, corner(first, 1, -1), corner(first, 1, 1), corner(first, -1, 1), corner(first, -1, -1));
    pushQuad(positions, corner(last, 1, 1), corner(last, 1, -1), corner(last, -1, -1), corner(last, -1, 1));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A dome/boss primitive (an ellipsoid) -- used for a central pendant medallion's
 * raised gold setting. A genuine, simplified stand-in for a piece's real medallion
 * shape (see `docs/procedural-jewellery-system.md`'s limitations section), not a
 * flat disc -- it has real depth. */
export function createBossGeometry(widthMm: number, heightMm: number, depthMm: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, 16, 12).toNonIndexed();
  geometry.scale(widthMm, heightMm, depthMm);
  geometry.computeVertexNormals();
  return geometry;
}

/** A hanging drop/pear-shape primitive (a cone: point at top where it attaches,
 * rounded base hanging below -- the correct orientation for a hanging drop, not an
 * arbitrary choice). */
export function createDropGeometry(widthMm: number, heightMm: number, depthMm: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(widthMm / 2, heightMm, 10, 1).toNonIndexed();
  const depthScale = widthMm > 0 ? depthMm / widthMm : 1;
  geometry.scale(1, 1, depthScale);
  geometry.computeVertexNormals();
  return geometry;
}

/** A faceted gemstone primitive (an octahedron -- genuine flat facets, not a smooth
 * sphere) -- used for accent stones and a central pendant's own set stone. */
export function createFacetedGemGeometry(widthMm: number, heightMm: number, depthMm: number): THREE.BufferGeometry {
  const geometry = new THREE.OctahedronGeometry(0.5, 0).toNonIndexed();
  geometry.scale(widthMm, heightMm, depthMm);
  geometry.computeVertexNormals();
  return geometry;
}

/** A rounded gemstone primitive (a low-poly sphere) -- for a "rounded" `GemSpec`
 * shape, as distinct from `createFacetedGemGeometry`'s faceted look. */
export function createRoundedGemGeometry(widthMm: number, heightMm: number, depthMm: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, 12, 10).toNonIndexed();
  geometry.scale(widthMm, heightMm, depthMm);
  geometry.computeVertexNormals();
  return geometry;
}

/** Linear repetition (Phase D Step 2) -- `count` evenly-spaced parameter values along
 * an OPEN curve, for placing repeating drops/ornaments along a band. Excludes the
 * absolute curve ends by a small margin so elements don't sit exactly on the band's
 * own end caps. */
export function evenlySpacedOpenCurveParams(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  const margin = 0.5 / count;
  const usable = 1 - margin * 2;
  return Array.from({ length: count }, (_, i) => margin + (i / (count - 1)) * usable);
}

/** Radial repetition (Phase D Step 2) -- `count` evenly-spaced parameter values
 * around a CLOSED curve, for placing repeating ornaments around a bangle/bracelet/
 * ring. */
export function evenlySpacedClosedCurveParams(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => i / count);
}

/** Graduated sizing (Phase D Step 2's "repeated ornament" with real-world variation)
 * -- a symmetric peak-at-center taper, matching the Diamond Choker's own MEASURED
 * drop-fringe shape (longer at the center, shorter toward the sides -- see
 * `docs/diamond-choker-prototype-measurements.md` §3). With `count <= 2`, every
 * element is equally "at an end," so all receive `shortestMm` -- not a bug, a
 * correct edge case (there is no true center to be longer at). */
export function computeGraduatedLengths(count: number, shortestMm: number, longestMm: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [longestMm];
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const distanceFromCenter = Math.abs(i - mid) / mid;
    return longestMm - (longestMm - shortestMm) * distanceFromCenter;
  });
}

/** Mirrors a local-space position across the X or Z axis (Phase D Step 2's
 * "mirrored component" primitive) -- used to place a symmetric pair of components
 * (e.g. two accent stones flanking a pendant) from a single authored position. */
export function mirrorPositionAcrossAxis(position: { x: number; y: number; z: number }, axis: "x" | "z"): { x: number; y: number; z: number } {
  return axis === "x" ? { x: -position.x, y: position.y, z: position.z } : { x: position.x, y: position.y, z: -position.z };
}
