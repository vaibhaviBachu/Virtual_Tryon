/**
 * Shared contract for the two capture sources. The full validation/preprocessing
 * pipeline (format/size/resolution/orientation checks) is Milestone 3 scope — this
 * interface exists now so that work slots in without changing how the Studio consumes
 * a captured image.
 */
export interface CapturedPhoto {
  blob: Blob;
  objectUrl: string;
  source: "camera" | "upload";
}
