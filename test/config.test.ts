import { describe, expect, it } from "vitest";
import { ALL_MARKET_IDS, DEFAULT_PORT, DEFAULT_SEARCH_BUDGET_MS, loadSettings } from "../src/config.js";

describe("what this deployment of the eBay plugin is", () => {
  it("an empty environment holds no credential, is unconfigured, and serves all five markets", () => {
    const settings = loadSettings({});
    expect(settings.port).toBe(DEFAULT_PORT);
    expect(settings.ebayClientId).toBeUndefined();
    expect(settings.ebayClientSecret).toBeUndefined();
    expect(settings.configured).toBe(false);
    expect(settings.searchBudgetMs).toBe(DEFAULT_SEARCH_BUDGET_MS);
    expect(settings.markets).toEqual([...ALL_MARKET_IDS]);
  });

  it("is configured only when BOTH the client id and the secret are present", () => {
    expect(loadSettings({ EBAY_CLIENT_ID: "id-only" }).configured).toBe(false);
    expect(loadSettings({ EBAY_CLIENT_SECRET: "secret-only" }).configured).toBe(false);
    expect(loadSettings({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" }).configured).toBe(true);
  });

  it("holds neither credential as an empty string when only whitespace is given", () => {
    // A blank-but-present variable is how a compose file passes "unset but
    // present" — treating it as a real value would read a keyless deployment
    // as configured.
    const settings = loadSettings({ EBAY_CLIENT_ID: "   ", EBAY_CLIENT_SECRET: "\t" });
    expect(settings.ebayClientId).toBeUndefined();
    expect(settings.ebayClientSecret).toBeUndefined();
    expect(settings.configured).toBe(false);
  });

  it("trims a real credential rather than storing it with stray whitespace", () => {
    const settings = loadSettings({ EBAY_CLIENT_ID: "  the-id  ", EBAY_CLIENT_SECRET: "the-secret" });
    expect(settings.ebayClientId).toBe("the-id");
  });

  it("a blank PORT is the default rather than a crash loop", () => {
    // Number.parseInt("") is NaN rather than a thrown error, so nothing here
    // crashes before the server binds — but a blank value must still not win
    // over the real default.
    expect(loadSettings({ PORT: "" }).port).toBe(DEFAULT_PORT);
    expect(loadSettings({ PORT: "9000" }).port).toBe(9000);
  });

  it("EBAY_SEARCH_BUDGET_MS overrides the default when it parses", () => {
    expect(loadSettings({ EBAY_SEARCH_BUDGET_MS: "5000" }).searchBudgetMs).toBe(5000);
    expect(loadSettings({ EBAY_SEARCH_BUDGET_MS: "" }).searchBudgetMs).toBe(DEFAULT_SEARCH_BUDGET_MS);
  });

  it("EBAY_PLUGIN_MARKETS narrows which markets this process serves", () => {
    expect(loadSettings({ EBAY_PLUGIN_MARKETS: "ebay_uk,ebay_de" }).markets).toEqual(["ebay_uk", "ebay_de"]);
  });

  it("EBAY_PLUGIN_MARKETS tolerates stray whitespace and trailing commas", () => {
    expect(loadSettings({ EBAY_PLUGIN_MARKETS: " ebay_uk , ebay_de,, " }).markets).toEqual([
      "ebay_uk",
      "ebay_de",
    ]);
  });

  it("a blank EBAY_PLUGIN_MARKETS is the default (all five), not an empty list", () => {
    expect(loadSettings({ EBAY_PLUGIN_MARKETS: "" }).markets).toEqual([...ALL_MARKET_IDS]);
  });
});
