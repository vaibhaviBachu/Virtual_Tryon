import { afterEach, describe, expect, it } from "vitest";

import {
  clearSavedNeckFractionOverride,
  readSavedNeckFractionOverride,
  saveNeckFractionOverride,
} from "@/lib/live-ar/neck-fraction-override";

describe("neck fraction override persistence", () => {
  afterEach(() => {
    clearSavedNeckFractionOverride();
  });

  it("returns null when nothing has been saved yet", () => {
    expect(readSavedNeckFractionOverride()).toBeNull();
  });

  it("round-trips a saved value", () => {
    saveNeckFractionOverride(0.1);
    expect(readSavedNeckFractionOverride()).toBeCloseTo(0.1, 6);
  });

  it("clearing removes a previously saved value", () => {
    saveNeckFractionOverride(0.42);
    clearSavedNeckFractionOverride();
    expect(readSavedNeckFractionOverride()).toBeNull();
  });

  it("rejects an out-of-range stored value rather than returning nonsense (e.g. corrupted storage)", () => {
    window.localStorage.setItem("liveAr.necklaceAttachmentFractionOverride", "4.2");
    expect(readSavedNeckFractionOverride()).toBeNull();
  });

  it("rejects a non-numeric stored value", () => {
    window.localStorage.setItem("liveAr.necklaceAttachmentFractionOverride", "not-a-number");
    expect(readSavedNeckFractionOverride()).toBeNull();
  });
});
