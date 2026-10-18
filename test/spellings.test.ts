import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PLATFORMS } from "../src/spellings.js";

// fixtures/app-seller-spellings.json is a copy of the app repository's
// packages/shared/test/fixtures/seller-spellings.json, which the app checks
// against its own PLATFORMS table. When the app changes a spelling, copy its
// fixture here and update src/spellings.ts until this passes.
describe("seller spellings", () => {
  it("match the app's table", () => {
    const app = JSON.parse(readFileSync(new URL("./fixtures/app-seller-spellings.json", import.meta.url), "utf8"));
    const ours = Object.fromEntries(Object.entries(PLATFORMS).map(([id, p]) => [id, p.sellerSpellings]));
    expect(ours).toEqual(app);
  });
});
