import { describe, expect, it } from "vitest";

import { getCategoryStrategy, listImplementedCategories } from "@/lib/jewellery-3d-generator/strategies/registry";

describe("category strategy registry", () => {
  it("necklace and ring are registered", () => {
    expect(getCategoryStrategy("necklace").category).toBe("necklace");
    expect(getCategoryStrategy("ring").category).toBe("ring");
  });

  it("an unregistered category (e.g. bangle) throws a clear, actionable error -- never silently falls back to another category's geometry", () => {
    expect(() => getCategoryStrategy("bangle")).toThrow(/bangle/);
    expect(() => getCategoryStrategy("bangle")).toThrow(/necklace, ring/);
  });

  it("listImplementedCategories reports exactly what's registered", () => {
    expect(listImplementedCategories()).toEqual(["necklace", "ring"]);
  });
});
