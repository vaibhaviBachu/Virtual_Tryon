import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildDiamondChokerSpecification } from "@/lib/jewellery-3d-generator/fixtures/diamond-choker-spec";
import { generateJewellery3D } from "@/lib/jewellery-3d-generator/glb-export";

/**
 * Phase E — regenerates the REAL, committed static GLB the live Next.js app serves
 * at /generated-3d-assets/diamond-choker.glb (three-live-bridge.ts's registry
 * references this exact path). Distinct from generate-fixtures.manual.test.ts (which
 * writes to the session scratchpad, outside the repo, purely for hand-inspection):
 * THIS output is committed, because the browser needs a real file to fetch -- there
 * is no build step in this project that runs the generator before `next build`/
 * `next dev`, so the generated asset is checked in like any other static asset,
 * deterministically reproducible by re-running this test.
 *
 * Deliberately still just a real GLTFExporter call, offline -- the procedural
 * generator remains a build-time tool; nothing here runs in the live camera loop.
 */
const PUBLIC_DIR = resolve(process.cwd(), "public", "generated-3d-assets");

describe("regenerate public 3D assets for the live AR pipeline", () => {
  it("writes a real, non-empty diamond-choker.glb", async () => {
    const asset = await generateJewellery3D(buildDiamondChokerSpecification());
    mkdirSync(PUBLIC_DIR, { recursive: true });
    writeFileSync(resolve(PUBLIC_DIR, "diamond-choker.glb"), Buffer.from(asset.glb));
    expect(asset.glb.byteLength).toBeGreaterThan(0);
  });
});
