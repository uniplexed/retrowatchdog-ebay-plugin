/**
 * `mapping.ts`: `ebayItemToRawListing` (a Browse item to a wire row, with
 * `available: true`), and `logUnexpectedCurrencies`, which only LOGS: this
 * package never drops a row, it only tells its own maintainer what the app
 * will drop.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ebayItemToRawListing, logUnexpectedCurrencies } from "../src/mapping.js";

interface Fixture {
  itemSummaries: Array<{
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    condition?: string;
    itemWebUrl?: string;
  }>;
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/item-summary-mario-world.json", import.meta.url), "utf8"),
) as Fixture;

describe("ebayItemToRawListing", () => {
  it("carries eBay's STRUCTURED condition field onto the row as conditionText", () => {
    // The wire half of the only newness evidence some listings have. Fixture
    // item 1009 is "Super Mario World SNES PAL" at £190, condition "New": no
    // newness vocabulary in the title at all, so the app's classifier
    // (in the app repository, apps/api/src/adapters/classifyListing.ts)
    // reads it from conditionText and nowhere else. conditionText is
    // OPTIONAL in the protocol (apps/api/src/adapters/sidecar/protocol.ts
    // there), so a
    // mapping that forgets it is accepted in silence and every
    // sealed-but-untitled listing quietly reclassifies from `new` to
    // `unknown` — into a different (region, condition) median group.
    const row = ebayItemToRawListing(fixture.itemSummaries[8]);
    expect(row.sourceProductId).toBe("v1|1009|0");
    expect(row.conditionText).toBe("New");
  });

  it("stamps available: true — a Browse item summary is a live listing by definition", () => {
    // Nothing else can produce this: the app's shared classifier deliberately
    // does not (in the app repository,
    // apps/api/src/adapters/classifyListing.ts), so without this
    // line every eBay row's `available` would read as unknown.
    const row = ebayItemToRawListing(fixture.itemSummaries[0]);
    expect(row.available).toBe(true);
  });

  it("carries a priceless item through as a row with an empty prices array, not a dropped row", () => {
    // The app's SIDECAR_MEDIAN_WINDOW relies on this: a Browse item with no
    // `price` at all is a real row.
    const row = ebayItemToRawListing({ itemId: "v1|999|0", title: "no price" });
    expect(row.prices).toEqual([]);
    expect(row.available).toBe(true);
  });

  it("maps itemId, title, itemWebUrl and the one active_listing price verbatim", () => {
    const row = ebayItemToRawListing(fixture.itemSummaries[0]);
    expect(row).toEqual({
      sourceProductId: "v1|1001|0",
      title: "Super Mario World SNES PAL Boxed Complete",
      conditionText: "Pre-owned",
      url: "https://www.ebay.co.uk/itm/1001",
      prices: [{ kind: "active_listing", amount: 45, currency: "GBP" }],
      available: true,
    });
  });
});

describe("logUnexpectedCurrencies", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs once, naming every currency seen that was not expected", () => {
    const listings = [
      ebayItemToRawListing({ itemId: "v1|1|0", title: "x", price: { value: "1.00", currency: "GBP" } }),
      ebayItemToRawListing({ itemId: "v1|2|0", title: "y", price: { value: "2.00", currency: "USD" } }),
    ];
    logUnexpectedCurrencies(listings, "GBP", "ebay_uk");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toContain("USD");
  });

  it("says nothing when every row quotes the expected currency", () => {
    const listings = [ebayItemToRawListing({ itemId: "v1|1|0", title: "x", price: { value: "1.00", currency: "GBP" } })];
    logUnexpectedCurrencies(listings, "GBP", "ebay_uk");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("says nothing about a row with no price at all", () => {
    const listings = [ebayItemToRawListing({ itemId: "v1|1|0", title: "x" })];
    logUnexpectedCurrencies(listings, "GBP", "ebay_uk");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
