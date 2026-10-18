import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { MARKETS, UnknownMarket, manifestPayload } from "../src/manifest.js";

const FIXTURE = fileURLToPath(new URL("../manifest.fixture.json", import.meta.url));
const settings = loadSettings({});

describe("what this plugin declares about itself", () => {
  it("declares the five markets, exactly as the checked-in fixture", () => {
    // The fixture is the one document both sides are pinned against: this
    // test and a later app-side test read the same file, so the plugin's
    // declaration and the app's record of what it retired cannot drift apart
    // in silence. Two languages, one repo, no compiler between them.
    expect(manifestPayload(settings)).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  it("refuses a market it cannot describe rather than guessing one", () => {
    // A manifest fixed to the wrong country would not fail loudly: the app
    // takes country and currency as declarations, and the failure would
    // surface as mispriced listings under a plausible heading. The rule
    // the Vinted plugin's site table states for a site nobody has looked at.
    expect(() => manifestPayload({ ...settings, markets: ["ebay_xx"] })).toThrow(UnknownMarket);
  });

  it("names its two secrets and holds neither in the manifest", () => {
    expect(manifestPayload(settings).requiredSecrets).toEqual(["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]);
    const withCreds = loadSettings({ EBAY_CLIENT_ID: "real-id", EBAY_CLIENT_SECRET: "real-secret" });
    expect(JSON.stringify(manifestPayload(withCreds))).not.toContain("real-secret");
    expect(JSON.stringify(manifestPayload(withCreds))).not.toContain("real-id");
  });

  it("declares every eBay source with defaultRegion explicitly null and no schedule", () => {
    const sources = manifestPayload(settings).sources as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      // Object.hasOwn, not a truthiness check: an absent key is refused by
      // the validator with a MISSING-field message ("an author who did not
      // decide"), while an explicit null is the honest "do not guess a
      // region" — the two must not be conflated here either.
      expect(Object.hasOwn(s, "defaultRegion")).toBe(true);
      expect(s.defaultRegion).toBeNull();
      // Refused outright on a live source by the validator, not merely
      // ignored — so its mere presence would break approval for every market.
      expect(Object.hasOwn(s, "schedule")).toBe(false);
    }
  });

  it("gives every source an id, which is not part of SourceInfo and must be added explicitly", () => {
    // The app's SourceInfo (packages/shared/src/index.ts in the app
    // repository) carries no `id` field at all — the id is the Record key.
    // A naive serialisation of that value alone would produce a source
    // object with no id, refused by the validator. This asserts the id
    // actually made it onto the wire object, not merely that it exists
    // somewhere in this file.
    const sources = manifestPayload(settings).sources as Array<Record<string, unknown>>;
    expect(sources.map((s) => s.id).sort()).toEqual(Object.keys(MARKETS).sort());
  });

  it("declares the honest pair of roles: active_median as reference, active_listing as buy_listing", () => {
    const sources = manifestPayload(settings).sources as Array<Record<string, unknown>>;
    for (const s of sources) {
      expect(s.kindRoles).toEqual({ active_median: "reference", active_listing: "buy_listing" });
    }
  });

  it("declares only the markets EBAY_PLUGIN_MARKETS asks for", () => {
    const narrowed = loadSettings({ EBAY_PLUGIN_MARKETS: "ebay_uk" });
    const sources = manifestPayload(narrowed).sources as Array<Record<string, unknown>>;
    expect(sources.map((s) => s.id)).toEqual(["ebay_uk"]);
  });

  it("labels every kind it gives a role, so the app never has to word one for it", () => {
    const sources = manifestPayload(settings).sources as Array<Record<string, unknown>>;
    for (const source of sources) {
      const kindLabels = source.kindLabels as Record<string, string> | undefined;
      const kindRoles = source.kindRoles as Record<string, string>;
      expect(Object.keys(kindLabels ?? {}).sort()).toEqual(Object.keys(kindRoles).sort());
    }
  });
});
