import { describe, expect, it } from "vitest";

import {
  EAR_ANCHOR_VERTICAL_OFFSET_FRACTION,
  MAX_EARRING_ROTATION_DEGREES,
  MAX_NECKLACE_ROTATION_DEGREES,
  NECKLACE_NECK_ANCHOR_FRACTION,
} from "@/lib/live-ar/constants";
import {
  buildLiveTransform,
  computeAnchor,
  computeEarringRotation,
  computeNecklaceRotation,
  computeRotation,
  computeScale,
  planCategoryRenders,
} from "@/lib/live-ar/geometry";
import type { JewelleryAssetGeometry, LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 1000;
const IMAGE_H = 1200;

function faceWithEars(): LiveFaceLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[1] = { x: 0.5, y: 0.55 }; // nose tip, equidistant -> symmetric confidence
  landmarks[234] = { x: 0.3, y: 0.5 }; // smaller x -> "left" per screen-position convention
  landmarks[454] = { x: 0.7, y: 0.5 };
  return {
    landmarks,
    faceBoundingBox: { xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 },
    detectionConfidence: 0.9,
  };
}

describe("computeAnchor — earrings (mirrors ai/tests/test_geometry_anchors.py)", () => {
  it("applies the documented vertical offset toward the earlobe", () => {
    const face = faceWithEars();
    const result = computeAnchor("earrings", "left", face, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(true);
    const faceHeightPx = (0.8 - 0.2) * IMAGE_H;
    const expectedX = 0.3 * IMAGE_W;
    const expectedY = 0.5 * IMAGE_H + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * faceHeightPx;
    expect(result.anchorPx!.x).toBeCloseTo(expectedX, 6);
    expect(result.anchorPx!.y).toBeCloseTo(expectedY, 6);
  });

  it("reference measurement is the face bounding-box width in pixels", () => {
    const face = faceWithEars();
    const result = computeAnchor("earrings", "right", face, null, IMAGE_W, IMAGE_H);
    expect(result.referenceMeasurementPx).toBeCloseTo((0.7 - 0.3) * IMAGE_W, 6);
  });

  it("fails with a structured code when there is no face", () => {
    const result = computeAnchor("earrings", "left", null, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("FACE_NOT_VISIBLE");
  });

  it("fails with a structured code when the face confidence is too low", () => {
    const face = { ...faceWithEars(), detectionConfidence: 0.1 };
    const result = computeAnchor("earrings", "left", face, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("FACE_NOT_VISIBLE");
  });

  it("fails with LOW_EAR_CONFIDENCE when the head is turned sharply away from one ear", () => {
    const face = faceWithEars();
    // Per ai/landmarks/face.py's asymmetry convention (mirrored exactly in
    // resolveEarConfidence): the nose landing CLOSE to an edge landmark (small
    // nose-to-edge distance on that side) means that side is heavily foreshortened, so
    // moving the nose near the LEFT edge landmark drives the LEFT ear's confidence down.
    face.landmarks[1] = { x: 0.32, y: 0.5 };
    const result = computeAnchor("earrings", "left", face, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(["EAR_NOT_VISIBLE", "LOW_EAR_CONFIDENCE"]).toContain(result.errorCode);
  });
});

function poseWithShoulders(leftX = 0.35, rightX = 0.65, y = 0.4, mouthY = 0.1): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[9] = { x: 0.48, y: mouthY, visibility: 0.9 }; // mouth left corner
  landmarks[10] = { x: 0.52, y: mouthY, visibility: 0.9 }; // mouth right corner
  landmarks[11] = { x: leftX, y, visibility: 0.9 };
  landmarks[12] = { x: rightX, y, visibility: 0.9 };
  return { landmarks, confidence: 0.9 };
}

describe("computeAnchor — necklace (mirrors ai/tests/test_geometry_anchors.py, plus the Live-AR-only neck-interpolation refinement)", () => {
  it("interpolates between the mouth landmarks and the shoulder midpoint toward the collarbone", () => {
    const pose = poseWithShoulders();
    const result = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(true);
    const shoulderWidthPx = (0.65 - 0.35) * IMAGE_W;
    const mouthMidYPx = 0.1 * IMAGE_H;
    const shoulderYPx = 0.4 * IMAGE_H;
    const expectedX = 0.5 * IMAGE_W; // mouth and shoulder midpoints are both centered
    const expectedY = mouthMidYPx + NECKLACE_NECK_ANCHOR_FRACTION * (shoulderYPx - mouthMidYPx);
    expect(result.anchorPx!.x).toBeCloseTo(expectedX, 6);
    expect(result.anchorPx!.y).toBeCloseTo(expectedY, 6);
    expect(result.referenceMeasurementPx).toBeCloseTo(shoulderWidthPx, 6);
    expect(result.method).toBe("pose_mouth_to_shoulder_neck_interpolation");
  });

  it("adapts to a longer visible neck (mouth further from shoulders) without changing shoulder width", () => {
    const shortNeck = computeAnchor("necklace", null, null, poseWithShoulders(0.35, 0.65, 0.4, 0.1), IMAGE_W, IMAGE_H);
    const longNeck = computeAnchor("necklace", null, null, poseWithShoulders(0.35, 0.65, 0.4, 0.02), IMAGE_W, IMAGE_H);
    // A mouth landmark further above the shoulders (smaller y) pulls the interpolated
    // anchor's y up too, even though shoulder width -- and thus the OLD fixed-offset
    // formula's result -- would have been identical in both cases.
    expect(longNeck.anchorPx!.y).toBeLessThan(shortNeck.anchorPx!.y);
    expect(longNeck.referenceMeasurementPx).toBeCloseTo(shortNeck.referenceMeasurementPx!, 6);
  });

  it("fails with a structured code when there is no pose", () => {
    const result = computeAnchor("necklace", null, null, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("NECK_NOT_VISIBLE");
  });

  it("necklace length none/medium are numerically identical to unchanged behavior", () => {
    const pose = poseWithShoulders();
    const baseline = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const withMedium = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H, "medium");
    expect(withMedium.anchorPx!.y).toBeCloseTo(baseline.anchorPx!.y, 6);
  });

  it("short < medium < long (uncalibrated placeholders, ordering only)", () => {
    const pose = poseWithShoulders();
    const baseline = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const short = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H, "short");
    const long = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H, "long");
    expect(short.anchorPx!.y).toBeLessThan(baseline.anchorPx!.y);
    expect(baseline.anchorPx!.y).toBeLessThan(long.anchorPx!.y);
  });
});

describe("computeAnchor — unsupported category", () => {
  it("returns a structured error", () => {
    // @ts-expect-error deliberately invalid category for the error-path test
    const result = computeAnchor("ring", null, null, null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_CATEGORY");
  });
});

describe("computeNecklaceRotation (mirrors ai/tests/test_geometry_rotation.py + the real sign-bug regression)", () => {
  it("is near-neutral for level, non-mirrored, front-facing shoulders", () => {
    // Landmark 11 ("left_shoulder") at LARGER x than 12 ("right_shoulder") — the real
    // MediaPipe anatomical convention for an ordinary photo (see geometry.ts docstring).
    const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
    landmarks[11] = { x: 0.65, y: 0.4, visibility: 0.9 };
    landmarks[12] = { x: 0.35, y: 0.4, visibility: 0.9 };
    const result = computeNecklaceRotation({ landmarks, confidence: 0.9 }, 1000, 1000);
    expect(result.rotationDegrees).toBeCloseTo(0, 6);
    expect(result.clamped).toBe(false);
  });

  it("is capped at the safety bound for an extreme tilt", () => {
    const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
    landmarks[11] = { x: 0.65, y: 0.4, visibility: 0.9 };
    landmarks[12] = { x: 0.35, y: 5.4, visibility: 0.9 };
    const result = computeNecklaceRotation({ landmarks, confidence: 0.9 }, 1000, 1000);
    expect(Math.abs(result.rotationDegrees)).toBeLessThanOrEqual(MAX_NECKLACE_ROTATION_DEGREES);
    expect(result.clamped).toBe(true);
  });

  it("neutral fallback when there is no pose", () => {
    const result = computeNecklaceRotation(null, 1000, 1000);
    expect(result.success).toBe(false);
    expect(result.rotationDegrees).toBe(0);
  });

  it("REGRESSION: a screen-position ('left has smaller x') fixture must NOT flip ~180deg", () => {
    // This is the exact real-world scenario that exposed the Python bug this session:
    // using the WRONG (screen-position) assumption for which landmark is "left" made an
    // ordinary frontal photo compute a raw rotation near +/-180deg. Using the correct
    // MediaPipe anatomical convention (landmark 11 at the LARGER x), the real recovered
    // coordinates from that production render must give a small rotation.
    const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
    landmarks[11] = { x: 471.7 / 640, y: 288.75 / 480, visibility: 0.9 };
    landmarks[12] = { x: 244.52 / 640, y: 289.16 / 480, visibility: 0.9 };
    const result = computeNecklaceRotation({ landmarks, confidence: 0.9 }, 640, 480);
    expect(Math.abs(result.rotationDegrees)).toBeLessThan(10);
  });
});

describe("computeEarringRotation", () => {
  it("is near-neutral for a level, front-facing face", () => {
    const face = faceWithEars();
    const result = computeEarringRotation(face, IMAGE_W, IMAGE_H);
    expect(result.rotationDegrees).toBeCloseTo(0, 6);
  });

  it("produces a nonzero rotation matching the real geometry for a tilted face", () => {
    const face = faceWithEars();
    face.landmarks[454] = { x: 0.7, y: 0.55 }; // tilt: right edge lower than left edge
    const result = computeEarringRotation(face, IMAGE_W, IMAGE_H);
    const dxPx = 0.4 * IMAGE_W;
    const dyPx = 0.05 * IMAGE_H;
    const expected = (Math.atan2(dyPx, dxPx) * 180) / Math.PI;
    expect(result.rotationDegrees).toBeCloseTo(expected, 6);
  });

  it("is capped at the safety bound for extreme noise", () => {
    const face = faceWithEars();
    face.landmarks[454] = { x: 0.7, y: 5.5 };
    const result = computeEarringRotation(face, IMAGE_W, IMAGE_H);
    expect(Math.abs(result.rotationDegrees)).toBeLessThanOrEqual(MAX_EARRING_ROTATION_DEGREES);
  });

  it("neutral fallback when there is no face", () => {
    const result = computeEarringRotation(null, IMAGE_W, IMAGE_H);
    expect(result.success).toBe(false);
    expect(result.rotationDegrees).toBe(0);
  });
});

describe("computeRotation dispatcher", () => {
  it("routes to the earring/necklace implementations", () => {
    const face = faceWithEars();
    const pose = poseWithShoulders();
    expect(computeRotation("earrings", face, null, IMAGE_W, IMAGE_H).method).toBe("face_edge_landmark_roll");
    expect(computeRotation("necklace", null, pose, IMAGE_W, IMAGE_H).method).toBe("shoulder_landmark_tilt");
  });
});

function makeAssetGeometry(overrides: Partial<JewelleryAssetGeometry> = {}): JewelleryAssetGeometry {
  return {
    widthPx: 300,
    heightPx: 300,
    alphaBbox: [50, 50, 250, 250], // 200x200 visible content
    anchorPx: { x: 150, y: 50 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
    ...overrides,
  };
}

describe("computeScale (mirrors ai/tests/test_geometry_scale.py)", () => {
  it("uses the relative-scale fallback when there is no physical_width_mm", () => {
    const pose = poseWithShoulders(0, 1, 0.5); // shoulder_width_px = 1000
    const anchor = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry();
    const result = computeScale("necklace", geometry, anchor);
    expect(result.success).toBe(true);
    expect(result.usedPhysicalDimensions).toBe(false);
    expect(result.method).toBe("relative_to_shoulder_width");
  });

  it("uses the physical-mm calibration path when available", () => {
    const pose = poseWithShoulders(0, 1, 0.5);
    const anchor = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry({ physicalWidthMm: 180 });
    const result = computeScale("necklace", geometry, anchor);
    expect(result.success).toBe(true);
    expect(result.usedPhysicalDimensions).toBe(true);
    expect(result.method).toBe("physical_mm_via_shoulder_width_calibration");
  });

  it("fails cleanly when the anchor itself failed", () => {
    const anchor = computeAnchor("necklace", null, null, null, IMAGE_W, IMAGE_H);
    const result = computeScale("necklace", makeAssetGeometry(), anchor);
    expect(result.success).toBe(false);
    expect(result.method).toBe("no_reference_measurement");
  });

  it("fails cleanly when the asset has no measurable width", () => {
    const pose = poseWithShoulders(0, 1, 0.5);
    const anchor = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry({ alphaBbox: [10, 10, 10, 10] });
    const result = computeScale("necklace", geometry, anchor);
    expect(result.success).toBe(false);
    expect(result.method).toBe("asset_has_no_measurable_width");
  });
});

describe("buildLiveTransform", () => {
  it("combines a successful anchor/scale/rotation into a renderable transform", () => {
    const pose = poseWithShoulders(0, 1, 0.5);
    const anchor = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry();
    const scale = computeScale("necklace", geometry, anchor);
    const rotation = computeNecklaceRotation(pose, IMAGE_W, IMAGE_H);

    const transform = buildLiveTransform(geometry, anchor, scale, rotation, false);
    expect(transform).not.toBeNull();
    expect(transform!.anchorPx).toEqual(anchor.anchorPx);
    expect(transform!.scaleFactor).toBe(scale.scaleFactor);
    expect(transform!.rotationDegrees).toBe(rotation.rotationDegrees);
    expect(transform!.sourceAnchorPx).toEqual(geometry.anchorPx);
    expect(transform!.mirrored).toBe(false);
  });

  it("returns null when the anchor failed", () => {
    const anchor = computeAnchor("necklace", null, null, null, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry();
    const scale = computeScale("necklace", geometry, anchor);
    const rotation = computeNecklaceRotation(null, IMAGE_W, IMAGE_H);
    expect(buildLiveTransform(geometry, anchor, scale, rotation, false)).toBeNull();
  });

  it("returns null when scale failed even if anchor succeeded", () => {
    const pose = poseWithShoulders(0, 1, 0.5);
    const anchor = computeAnchor("necklace", null, null, pose, IMAGE_W, IMAGE_H);
    const geometry = makeAssetGeometry({ alphaBbox: [10, 10, 10, 10] });
    const scale = computeScale("necklace", geometry, anchor);
    const rotation = computeNecklaceRotation(pose, IMAGE_W, IMAGE_H);
    expect(scale.success).toBe(false);
    expect(buildLiveTransform(geometry, anchor, scale, rotation, false)).toBeNull();
  });
});

describe("planCategoryRenders", () => {
  it("plans a single necklace slot", () => {
    const pose = poseWithShoulders(0, 1, 0.5);
    const plans = planCategoryRenders("necklace", makeAssetGeometry(), null, pose, IMAGE_W, IMAGE_H);
    expect(plans).toHaveLength(1);
    expect(plans[0].slot).toBe("necklace");
    expect(plans[0].transform).not.toBeNull();
  });

  it("plans both left and right earring slots", () => {
    const face = faceWithEars();
    const plans = planCategoryRenders("earrings", makeAssetGeometry(), face, null, IMAGE_W, IMAGE_H);
    expect(plans.map((p) => p.slot)).toEqual(["left", "right"]);
    expect(plans[0].transform).not.toBeNull();
    expect(plans[1].transform).not.toBeNull();
  });

  it("mirrors the right earring's transform only when the asset is marked mirrorable", () => {
    const face = faceWithEars();
    const unmirrored = planCategoryRenders("earrings", makeAssetGeometry({ mirrorable: false }), face, null, IMAGE_W, IMAGE_H);
    const mirrored = planCategoryRenders("earrings", makeAssetGeometry({ mirrorable: true }), face, null, IMAGE_W, IMAGE_H);
    expect(unmirrored[1].transform!.mirrored).toBe(false);
    expect(mirrored[1].transform!.mirrored).toBe(true);
    // Left is never mirrored either way.
    expect(unmirrored[0].transform!.mirrored).toBe(false);
    expect(mirrored[0].transform!.mirrored).toBe(false);
  });

  it("returns a null transform for a slot whose placement failed, without failing the whole plan", () => {
    const plans = planCategoryRenders("earrings", makeAssetGeometry(), null, null, IMAGE_W, IMAGE_H);
    expect(plans).toHaveLength(2);
    expect(plans[0].transform).toBeNull();
    expect(plans[1].transform).toBeNull();
  });
});
