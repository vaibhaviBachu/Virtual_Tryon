/**
 * Phase D — generic procedural 3D jewellery specification.
 *
 * WHY THIS EXISTS: Phase C's research concluded we can build our own GLB generator
 * with zero new dependencies. The FIRST version of that generator must not be a
 * `generateDiamondChoker()` one-off -- the actual requirement is a specification +
 * generator that can eventually describe any vault category (necklace, haaram,
 * earring, bangle, bracelet, ring, maang_tikka, nose_ring, jewellery_set), so a new
 * catalogue item needs a new SPECIFICATION (data), not a new geometry pipeline
 * (code). This module is that specification's type contract -- deliberately
 * decoupled from any one item's numbers (those live in `fixtures/`).
 *
 * DESIGN NOTE ON "CATEGORY-APPROPRIATE DIMENSIONS" (Phase D Step 8): rather than a
 * different geometry primitive per category, every band-like category (necklace,
 * haaram, bangle, bracelet, ring) is expressed as ONE `BandGeometrySpec`: an open or
 * closed curve plus a rectangular cross-section. A ring's "inner/outer radius" and a
 * choker's "width/wrap sagitta" are both just different CURVE + CROSS-SECTION
 * parameterizations of the exact same primitive (see `primitives.ts`'s
 * `createSweptBandGeometry`) -- the category strategy layer (`strategies/`) is what
 * decides how a category's own real-world parameters map onto this one shared shape,
 * never a second geometry implementation.
 */
import type * as THREE from "three";

/** The generation-system's own curated category set -- distinct from the vault's
 * free-text `JewelleryCategory` DB column (confirmed unconstrained by Phase A's
 * schema audit). Several DB category slugs can map onto one of these (e.g. a DB
 * "choker" or "chain" slug both map to generation category "necklace", since the
 * geometry -- a curved band + optional pendant/drops -- is identical; only the
 * specification's own numbers differ). */
export type JewelleryCategory =
  | "necklace"
  | "haaram"
  | "earring"
  | "bangle"
  | "bracelet"
  | "ring"
  | "maang_tikka"
  | "nose_ring"
  | "jewellery_set";

/** Where a value in a specification came from -- carried at the top level so every
 * generated asset is traceable to its provenance, the same discipline
 * `docs/diamond-choker-prototype-measurements.json` already established for the
 * Diamond Choker specifically, generalized here so it applies to ANY item this
 * generator ever produces, including purely synthetic architecture-validation
 * fixtures that are not, and must never be presented as, real catalogue data. */
export type JewellerySpecStatus = "prototype_estimated" | "catalogue_verified" | "synthetic_validation_fixture";

export interface JewelleryDimensions {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  weightG?: number | null;
}

/** Mirrors `Gltf3dAssetMetadata`'s `attachmentType`/`anchor` fields
 * (`jewellery-representation.ts`) -- this specification's attachment data is
 * designed to feed that EXISTING contract directly, not duplicate/replace it. */
export interface JewelleryAttachmentSpec {
  /** Free text, e.g. "neck_choker", "ear_lobe", "finger", "wrist" -- same convention
   * as the existing `JewelleryAsset.attachment_point` column. */
  type: string;
  pointLocal: { x: number; y: number; z: number };
}

/** A curve's own shape parameters -- Phase D Step 4's "generic curve system."
 * `buildJewelleryCurve` (curves.ts) turns this into a real `THREE.Curve<Vector3>`.
 * Deliberately covers only the shapes this project's jewellery categories actually
 * need (open/closed, circular/elliptical/line/control-point spline) -- a true
 * cubic-Bezier variant could be added as one more `shape` value later without
 * changing anything else, if a future category ever needs it. */
export interface CurveSpec {
  kind: "open" | "closed";
  shape: "line" | "circular" | "elliptical" | "control-points";
  /** For `shape: "circular"`. The curve's own radius, in the curve's local plane. */
  radiusMm?: number;
  /** For `shape: "elliptical"`. */
  radiusXMm?: number;
  radiusYMm?: number;
  /** For `shape: "control-points"` -- a spline (Catmull-Rom) is fit through these. */
  controlPoints?: { x: number; y: number; z: number }[];
  /** For `shape: "line"` -- exactly 2 points. */
  lineStart?: { x: number; y: number; z: number };
  lineEnd?: { x: number; y: number; z: number };
}

/** A rectangular cross-section swept along a `CurveSpec` -- see this module's file
 * docstring for why this ONE shape covers every band-like category. `upAxis` is the
 * fixed reference direction the cross-section's `widthMm` extent is measured along at
 * every point on the curve (see `primitives.ts`'s file docstring for why a FIXED
 * reference axis is used instead of the curve's own Frenet frame). `depthMm` is
 * measured along `cross(tangent, upAxis)` at each point. */
export interface BandGeometrySpec {
  curve: CurveSpec;
  crossSection: {
    widthMm: number;
    depthMm: number;
  };
  /** The fixed reference direction used to orient the cross-section (see above).
   * Defaults to world +Y (0,1,0) when omitted -- correct for any band lying in a
   * roughly horizontal plane (a choker/necklace/haaram in front of a neck, a
   * bangle/bracelet/ring encircling a wrist/finger). */
  upAxis?: { x: number; y: number; z: number };
  materialId: string;
  /** Sampling resolution along the curve. A sane default is applied by the
   * primitive if omitted. */
  segments?: number;
}

export interface GemSpec {
  shape: "faceted" | "rounded";
  widthMm: number;
  heightMm: number;
  depthMm: number;
  materialId: string;
  /** Local-space position, relative to whatever component owns this gem (the
   * pendant, or the band's own root, depending on where it's attached). */
  positionLocal: { x: number; y: number; z: number };
}

export interface PendantSpec {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  /** 0..1 fraction along the band's curve; 0.5 is the curve's own center. */
  positionOnCurve: number;
  /** How far in front of the band's own surface the pendant sits, along the band's
   * local "depth" direction at that point on the curve. */
  forwardOffsetMm: number;
  materialId: string;
  gem?: GemSpec | null;
}

/** A repeating decorative element (Phase D Step 2's "repeated ornament" / "linear
 * repetition" / "radial repetition" primitives) placed along a band's curve.
 * `graduated` produces a symmetric peak-at-center taper (the Diamond Choker's real,
 * measured drop-fringe shape); omitting it places every element at the same size. */
export interface RepeatingElementSpec {
  kind: "drop" | "ornament";
  count: number;
  placement: "linear" | "radial";
  graduated?: { shortestMm: number; longestMm: number } | null;
  elementSizeMm: { widthMm: number; heightMm: number; depthMm: number };
  materialId: string;
}

export type MaterialPreset =
  | "gold"
  | "silver"
  | "platinum"
  | "polished-metal"
  | "brushed-metal"
  | "diamond"
  | "gemstone";

/** Phase D Step 6's generic material system. `id` is the key every other spec field
 * (`BandGeometrySpec.materialId`, `GemSpec.materialId`, ...) references -- never a
 * direct object reference, so the specification stays plain-data/serializable. */
export interface MaterialSpec {
  id: string;
  preset: MaterialPreset;
  colorHex?: string;
  metalnessOverride?: number;
  roughnessOverride?: number;
}

export interface SymmetrySpec {
  mirrored: boolean;
  axis?: "x" | "z";
  /** A real, measured or estimated left/right symmetry score, 0..1, if known --
   * purely descriptive metadata (mirrors the Diamond Choker measurement spec's own
   * `left_right_symmetry_score`), never consumed by the generator itself. */
  measuredScore?: number | null;
}

export interface JewelleryGenerationOptions {
  curveSegments?: number;
  triangleBudgetHint?: number;
}

/** The generic specification `generateJewellery3D` (glb-export.ts) consumes. Every
 * category is expressed through the SAME fields -- see this module's file docstring
 * for why `band` alone (not category-specific dimension fields) covers necklace,
 * haaram, bangle, bracelet, AND ring. `band`/`pendant`/`repeatingElements`/`gems` are
 * all independently optional because not every category uses all of them (a plain
 * ring has a `band` and `gems` but no `pendant`/`repeatingElements`; an earring may
 * have no `band` at all). */
export interface Jewellery3DSpecification {
  id: string;
  category: JewelleryCategory;
  status: JewellerySpecStatus;
  /** Free text, e.g. "This item's real physical dimensions are unset in the
   * catalogue; values below are prototype estimates" -- required whenever `status`
   * is not `"catalogue_verified"`, so the provenance is never silently lost once
   * this specification is passed around as plain data. */
  provenanceNote: string;
  dimensions: JewelleryDimensions;
  attachment: JewelleryAttachmentSpec;
  band?: BandGeometrySpec | null;
  pendant?: PendantSpec | null;
  repeatingElements?: RepeatingElementSpec[] | null;
  gems?: GemSpec[] | null;
  materials: MaterialSpec[];
  symmetry: SymmetrySpec;
  generation?: JewelleryGenerationOptions | null;
}

/** A generic component node -- Phase D Step 5. Deliberately holds a real
 * `THREE.BufferGeometry` (not a re-described shape) because the primitives already
 * produce genuine Three.js geometry; there is no value in re-abstracting that a
 * second time for a first version of this system. A node with `geometry: null` is a
 * pure organizational group (e.g. the tree's root, or a "drops" group holding many
 * individual drop children). */
export interface JewelleryComponent {
  name: string;
  geometry: THREE.BufferGeometry | null;
  materialId: string | null;
  position: { x: number; y: number; z: number };
  rotationDegrees?: { yawDegrees: number; pitchDegrees: number; rollDegrees: number } | null;
  children: JewelleryComponent[];
}
