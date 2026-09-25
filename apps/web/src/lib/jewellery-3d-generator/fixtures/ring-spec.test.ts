import { describe, expect, it } from "vitest";

import { buildRingSpecification } from "@/lib/jewellery-3d-generator/fixtures/ring-spec";

describe("buildRingSpecification", () => {
  it("is explicitly labeled a synthetic validation fixture, never claimed to be real", () => {
    const spec = buildRingSpecification();
    expect(spec.category).toBe("ring");
    expect(spec.status).toBe("synthetic_validation_fixture");
    expect(spec.provenanceNote).toMatch(/SYNTHETIC/);
    expect(spec.provenanceNote).toMatch(/never be written to the database/i);
  });

  it("uses a CLOSED circular band curve -- the structurally different topology from the choker", () => {
    const spec = buildRingSpecification();
    expect(spec.band!.curve.kind).toBe("closed");
    expect(spec.band!.curve.shape).toBe("circular");
    expect(spec.band!.curve.radiusMm).toBeGreaterThan(0);
  });

  it("has a setting (pendant) with a gem, and radial ornaments", () => {
    const spec = buildRingSpecification();
    expect(spec.pendant).not.toBeNull();
    expect(spec.pendant!.gem).not.toBeNull();
    expect(spec.repeatingElements![0].placement).toBe("radial");
  });
});
