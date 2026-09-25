/**
 * Phase F — the generic body-attachment orientation resolver (Step 5/18:
 * "JewelleryAttachmentResolver or equivalent generic architecture... must eventually
 * support neck/ear/wrist/finger/forehead/nose... only implement neck deeply").
 *
 * A registry keyed by `CategorySlug` (reusing this codebase's own existing tracked-
 * category taxonomy -- types.ts -- rather than inventing a second, parallel one),
 * mirroring the exact pattern already established for `strategies/registry.ts`
 * (Phase D) and `GLTF_3D_ASSET_REGISTRY` (Phase E, three-live-bridge.ts): one real
 * entry ("necklace"), everything else resolves to `null`, and adding a new category
 * means adding ONE function + ONE registry line, never new call-site branching.
 *
 * WHAT THIS RESOLVES: an ORIENTATION only (yaw/pitch/roll) -- never a position. The
 * existing, already-validated 2D-anchor-derived position (three-live-bridge.ts,
 * unchanged from Phase E) remains the source of truth for WHERE the jewellery sits;
 * this module only answers HOW IT IS ROTATED, which is the actual root cause Phase F
 * diagnosed (see docs/true-body-surface-jewellery-attachment.md §1-3): Phase E's
 * choker had a real position but an almost-flat, yaw-proxy-only orientation, which
 * is why a real curved 3D object still read as "floating in front of," not "worn."
 */
import { computeNecklaceRotation, estimateHeadYawAsymmetry } from "@/lib/live-ar/geometry";
import { decomposeFacialTransformMatrix } from "@/lib/live-ar/three/head-pose";
import { yawAsymmetryToRadians } from "@/lib/live-ar/three/three-transform";
import type { CategorySlug, LiveFaceLandmarks, LivePoseLandmarks } from "@/lib/live-ar/types";

export interface SurfaceOrientation {
  yawRadians: number;
  pitchRadians: number;
  rollRadians: number;
  /** 0..1, independent of the underlying `computeNecklaceRotation`/pose-matrix
   * confidence conventions -- a plain, comparable scalar for debug display and for
   * any future caller that wants to gate on "how much do we trust this frame's
   * orientation." */
  confidence: number;
  method: "shoulder_roll_plus_real_facial_transform_matrix" | "shoulder_roll_plus_2d_yaw_proxy_fallback";
}

/**
 * Step 16's own question ("should the anchor depend more on shoulders than face?"),
 * answered concretely for orientation: ROLL always comes from the real shoulder-line
 * tilt (`computeNecklaceRotation`, unmodified, unchanged from M6.4) -- a choker is
 * worn on the body, and the body's own visible tilt is a real, already-measured
 * signal, never the face's. YAW and PITCH come from the face's real 3D pose
 * (`decomposeFacialTransformMatrix`) when available, because this codebase has no
 * equivalent real 3D ROTATION measurement for the shoulders/torso themselves
 * (PoseLandmarker gives landmark positions, not a transformation matrix) -- using the
 * head's real yaw/pitch as the best available proxy for "how the neck itself is
 * currently turned" is a documented, named choice, not a claim that head and body
 * rotation are physically identical (see docs/true-body-surface-jewellery-
 * attachment.md §16 for the honest account of this limitation).
 *
 * Falls back to the existing M6.6/M6.8 2D yaw proxy (pitch forced to 0, exactly
 * Phase E's prior behavior) whenever the transformation matrix isn't available this
 * frame (face lost, or the matrix simply wasn't produced) -- never a crash, never a
 * fabricated angle.
 */
export function resolveNeckAttachmentOrientation(
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
): SurfaceOrientation {
  const rotation = computeNecklaceRotation(pose, imageWidthPx, imageHeightPx);
  const rollRadians = (rotation.rotationDegrees * Math.PI) / 180;

  const headPose = decomposeFacialTransformMatrix(face?.faceTransformMatrix ?? null);
  if (headPose) {
    return {
      yawRadians: headPose.yawRadians,
      pitchRadians: headPose.pitchRadians,
      rollRadians,
      confidence: rotation.success ? 1 : 0.6,
      method: "shoulder_roll_plus_real_facial_transform_matrix",
    };
  }

  const yawAsymmetry = estimateHeadYawAsymmetry(face) ?? 0;
  return {
    yawRadians: yawAsymmetryToRadians(yawAsymmetry),
    pitchRadians: 0,
    rollRadians,
    confidence: rotation.success ? 0.5 : 0.2,
    method: "shoulder_roll_plus_2d_yaw_proxy_fallback",
  };
}

type AttachmentOrientationResolver = (
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
) => SurfaceOrientation;

/** Registered today: exactly the one category this phase implements deeply
 * ("necklace" -- Step 18's own stop condition). "earrings" (and any future
 * wrist/finger/forehead/nose category, once this runtime tracks it at all) resolves
 * to `null` -- honest "not implemented yet," never a silent fallback to the wrong
 * body region's math. */
const ATTACHMENT_ORIENTATION_RESOLVERS: Partial<Record<CategorySlug, AttachmentOrientationResolver>> = {
  necklace: resolveNeckAttachmentOrientation,
};

export function resolveAttachmentOrientation(
  category: CategorySlug,
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
): SurfaceOrientation | null {
  const resolver = ATTACHMENT_ORIENTATION_RESOLVERS[category];
  return resolver ? resolver(face, pose, imageWidthPx, imageHeightPx) : null;
}
