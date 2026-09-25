/**
 * Phase D Step 4 — generic curve system. Turns a plain-data `CurveSpec` (types.ts)
 * into a real `THREE.CatmullRomCurve3`, the one curve representation every band-like
 * category (necklace, haaram, bangle, bracelet, ring) is built on -- an OPEN curve
 * for a choker/necklace/haaram's front arc, a CLOSED curve for a bangle/bracelet/
 * ring's full loop, both through the exact same code path.
 */
import * as THREE from "three";

import type { CurveSpec } from "@/lib/jewellery-3d-generator/types";

const DEFAULT_CIRCLE_SAMPLE_POINTS = 24;

function resolveControlPoints(spec: CurveSpec): THREE.Vector3[] {
  switch (spec.shape) {
    case "control-points": {
      if (!spec.controlPoints || spec.controlPoints.length < 2) {
        throw new Error('CurveSpec shape "control-points" requires at least 2 controlPoints.');
      }
      return spec.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    }
    case "line": {
      if (!spec.lineStart || !spec.lineEnd) {
        throw new Error('CurveSpec shape "line" requires lineStart and lineEnd.');
      }
      return [new THREE.Vector3(spec.lineStart.x, spec.lineStart.y, spec.lineStart.z), new THREE.Vector3(spec.lineEnd.x, spec.lineEnd.y, spec.lineEnd.z)];
    }
    case "circular": {
      if (!(spec.radiusMm && spec.radiusMm > 0)) {
        throw new Error('CurveSpec shape "circular" requires a positive radiusMm.');
      }
      return sampleEllipse(spec.radiusMm, spec.radiusMm);
    }
    case "elliptical": {
      if (!(spec.radiusXMm && spec.radiusXMm > 0) || !(spec.radiusYMm && spec.radiusYMm > 0)) {
        throw new Error('CurveSpec shape "elliptical" requires positive radiusXMm and radiusYMm.');
      }
      return sampleEllipse(spec.radiusXMm, spec.radiusYMm);
    }
  }
}

/** Samples a horizontal-plane (XZ) ellipse -- the curve's own local plane; a category
 * strategy is responsible for orienting this plane (see `BandGeometrySpec.upAxis`)
 * relative to the body part it wraps. */
function sampleEllipse(radiusX: number, radiusZ: number, points = DEFAULT_CIRCLE_SAMPLE_POINTS): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    result.push(new THREE.Vector3(Math.cos(angle) * radiusX, 0, Math.sin(angle) * radiusZ));
  }
  return result;
}

/** Builds the real curve a `CurveSpec` describes. `closed` must match `spec.kind`
 * exactly -- a `"closed"` curve (bangle/bracelet/ring) has its last control point
 * implicitly connect back to its first; an `"open"` curve (choker/necklace/haaram)
 * does not. */
export function buildJewelleryCurve(spec: CurveSpec): THREE.CatmullRomCurve3 {
  const points = resolveControlPoints(spec);
  const closed = spec.kind === "closed";
  return new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.5);
}
