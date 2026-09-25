import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { countTriangles } from "@/lib/jewellery-3d-generator/component";
import { buildDiamondChokerSpecification } from "@/lib/jewellery-3d-generator/fixtures/diamond-choker-spec";
import { buildRingSpecification } from "@/lib/jewellery-3d-generator/fixtures/ring-spec";
import { generateJewellery3D } from "@/lib/jewellery-3d-generator/glb-export";

/**
 * Not a correctness test (integration.test.ts already covers correctness) -- this
 * writes real, inspectable .glb files to the session scratchpad directory (OUTSIDE
 * the repo -- never committed) so the generator's output can be checked/opened by
 * hand, not just asserted on inside vitest. Reports real triangle counts / byte
 * sizes / bounding boxes to the console so a report can quote ACTUAL numbers.
 */
const OUTPUT_DIR = "C:/Users/vaibh/AppData/Local/Temp/claude/c--Virtual-Tryon/c1d347ea-6b35-4b0f-a8ce-0080670f8019/scratchpad/jewellery-3d-generator";

describe("manual fixture export (writes real .glb files for hand inspection)", () => {
  it("Diamond Choker", async () => {
    const spec = buildDiamondChokerSpecification();
    const asset = await generateJewellery3D(spec);
    const box = new THREE.Box3().setFromObject(asset.group);
    const size = box.getSize(new THREE.Vector3());
    const triangles = countTriangles(asset.group);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(`${OUTPUT_DIR}/diamond-choker.glb`, Buffer.from(asset.glb));

    console.log(`[diamond-choker] triangles=${triangles} bytes=${asset.glb.byteLength} bbox=(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})mm`);
    expect(triangles).toBeGreaterThan(0);
  });

  it("Ring (synthetic validation fixture)", async () => {
    const spec = buildRingSpecification();
    const asset = await generateJewellery3D(spec);
    const box = new THREE.Box3().setFromObject(asset.group);
    const size = box.getSize(new THREE.Vector3());
    const triangles = countTriangles(asset.group);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(`${OUTPUT_DIR}/ring-example.glb`, Buffer.from(asset.glb));

    console.log(`[ring] triangles=${triangles} bytes=${asset.glb.byteLength} bbox=(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})mm`);
    expect(triangles).toBeGreaterThan(0);
  });
});
