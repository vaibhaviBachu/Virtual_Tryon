/** Phase D — public entry points for the generic procedural 3D jewellery system. */
export { generateJewellery3D, glbToDataUrl } from "@/lib/jewellery-3d-generator/glb-export";
export type { GeneratedJewellery3DAsset } from "@/lib/jewellery-3d-generator/glb-export";
export { getCategoryStrategy, listImplementedCategories } from "@/lib/jewellery-3d-generator/strategies/registry";
export type {
  BandGeometrySpec,
  CurveSpec,
  GemSpec,
  Jewellery3DSpecification,
  JewelleryAttachmentSpec,
  JewelleryCategory,
  JewelleryComponent,
  JewelleryDimensions,
  JewellerySpecStatus,
  MaterialSpec,
  PendantSpec,
  RepeatingElementSpec,
  SymmetrySpec,
} from "@/lib/jewellery-3d-generator/types";
