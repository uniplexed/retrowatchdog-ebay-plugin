/**
 * `search.ts`'s real `/search` implementation — the two-call
 * primary/supplementary orchestration and its merge, driven by a
 * REQUEST-supplied `budgetMs`: this package has no `ADAPTER_TIMEOUT_MS` to
 * read, only what the app tells it (protocol document §3).
 *
 * The merged window is NOT capped here: the cheapest-N cap is app-side
 * (`cheapestWindow` in the app repository's
 * apps/api/src/adapters/sidecar/index.ts, with its own
 * test), so this file's equivalent case asserts the OPPOSITE shape on purpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { EbayTokenClient } from "../src/client.js";
import { MARKETS } from "../src/manifest.js";
import { searchMarket } from "../src/search.js";
import type { SearchQuery } from "../src/server.js";

const UK = MARKETS.ebay_uk;

function query(over: Partial<SearchQuery> = {}): SearchQuery {
  return { q: "Mario Kart 64", platform: "n64", alt: [], spellings: ["N64", "Nintendo 64"], budgetMs: undefined, ...over };
}

/** One eBay Browse item_summary, price-only — enough for every test below. */
const item = (id: string, price: number): Record<string, unknown> => ({
  itemId: `v1|${id}|0`,
  title: `listing ${id}`,
  price: { value: price.toFixed(2), currency: "GBP" },
  condition: "Pre-owned",
  itemWebUrl: `https://www.ebay.co.uk/itm/${id}`,
});

describe("searchMarket", () => {
  let agent: MockAgent;
  let previous: Dispatcher;
  let tokens: EbayTokenClient;

  beforeEach(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    agent
      .get("https://api.ebay.com")
      .intercept({ path: "/identity/v1/oauth2/token", method: "POST" })
      .reply(200, { access_token: "tok", expires_in: 7200, token_type: "Application Access Token" })
      .persist();
    tokens = new EbayTokenClient({ clientId: "cid", clientSecret: "sec" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    setGlobalDispatcher(previous);
    await agent.close();
  });

  const interceptSearch = (fragment: string) =>
    agent.get("https://api.ebay.com").intercept({
      path: (p: string) => p.includes("/buy/browse/v1/item_summary/search") && p.includes(fragment),
      method: "GET",
    });

  describe("D4: the supplementary call is best-effort", () => {
    it("keeps the primary window when the second query fails", async () => {
      interceptSearch("q=Mario+Kart+64").reply(200, { itemSummaries: [item("1", 10)] });
      interceptSearch("q=Super+Mario+Kart+R").reply(500, { error: "boom" });

      const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"] }), 8000);
      // the proven-good window survives: an extra call that fails must never
      // cost the result the primary already produced
      expect(listings.map((l) => l.sourceProductId)).toEqual(["v1|1|0"]);
    });

    it("keeps the primary window when the second query runs out of budget", async () => {
      interceptSearch("q=Mario+Kart+64").reply(200, { itemSummaries: [item("1", 10)] });
      interceptSearch("q=Super+Mario+Kart+R").reply(200, { itemSummaries: [item("2", 20)] }).delay(2_000);

      const startedAt = Date.now();
      const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"], budgetMs: 800 }), 8000);
      // the supplementary call is aborted well inside the budget the request
      // carried, so the app's own timeout never fires on top of the primary's
      // result
      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(listings.map((l) => l.sourceProductId)).toEqual(["v1|1|0"]);
    });

    it("still fails the search when the PRIMARY query fails", async () => {
      interceptSearch("q=Mario+Kart+64").reply(500, { error: "boom" });

      // spec 11 stale-if-error: a primary failure must reach the app so it
      // serves the stored block labelled stale, not a half window as fresh
      await expect(
        searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"] }), 8000),
      ).rejects.toThrow(/eBay search HTTP 500/);
    });

    it("skips the second query outright when the budget is already spent", async () => {
      let searchCalls = 0;
      interceptSearch("q=Mario+Kart+64")
        .reply(200, () => {
          searchCalls += 1;
          return { itemSummaries: [item("1", 10)] };
        })
        .delay(300);

      // the primary spends 300ms of a 700ms budget; the 500ms reserve leaves
      // nothing for a second call, so it is never made (no interceptor for it)
      const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"], budgetMs: 700 }), 8000);
      expect(searchCalls).toBe(1);
      expect(listings.map((l) => l.sourceProductId)).toEqual(["v1|1|0"]);
    });
  });

  it("reserves time for the second call out of the budget the APP sent, not this plugin's own ceiling", async () => {
    // This package cannot read the app's ADAPTER_TIMEOUT_MS: the app sends
    // what is actually left of ITS budget (protocol §3) and the plugin caps
    // that hint with EBAY_SEARCH_BUDGET_MS. If this file used its own
    // (generous) ceiling instead of the much smaller number the request
    // carried, there would be ample time left and the second call below
    // WOULD be made — it is wired to answer instantly if it is.
    let supplementaryCalls = 0;
    interceptSearch("q=Mario+Kart+64").reply(200, { itemSummaries: [item("1", 10)] }); // instant
    interceptSearch("q=Super+Mario+Kart+R").reply(200, () => {
      supplementaryCalls += 1;
      return { itemSummaries: [item("2", 20)] };
    });

    // this deployment's own ceiling (8000) is generous; the REQUEST says only
    // 300ms is left, which the 500ms reserve alone already exceeds
    const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"], budgetMs: 300 }), 8000);
    expect(supplementaryCalls).toBe(0);
    expect(listings.map((l) => l.sourceProductId)).toEqual(["v1|1|0"]);
  });

  it(
    "REQUIRED: de-duplicates by sourceProductId across the primary and supplementary windows, first seen wins",
    async () => {
      // The app-side median window (SIDECAR_MEDIAN_WINDOW) deliberately does
      // NOT de-duplicate, because normally a plugin makes one call and there
      // is nothing there to merge. If this plugin ever answered one
      // GET /search with the same item twice, both rows would enter the
      // app's median window and skew it silently — this file is where the
      // de-duplication has to live, because this is the one place that makes
      // two calls.
      //
      // The "dup" item deliberately carries DIFFERENT title/price/condition
      // in the two calls, same itemId only: an identical-object fixture
      // cannot tell "dedup keyed on sourceProductId" apart from a broken
      // implementation that instead deduped by full-object equality (which
      // would let two calls' answers for the SAME listing double-count the
      // moment either field drifts between calls — a real possibility, since
      // eBay's own price/condition can change between two nearly-simultaneous
      // requests). The differing fields also let "first seen wins" be
      // checked directly, not just assumed from a passing length check.
      interceptSearch("q=Mario+Kart+64").reply(200, {
        itemSummaries: [
          { itemId: "v1|dup|0", title: "primary title", price: { value: "10.00", currency: "GBP" }, condition: "Pre-owned", itemWebUrl: "https://www.ebay.co.uk/itm/dup-primary" },
        ],
      });
      interceptSearch("q=Super+Mario+Kart+R").reply(200, {
        itemSummaries: [
          { itemId: "v1|dup|0", title: "supplementary title", price: { value: "999.00", currency: "GBP" }, condition: "New", itemWebUrl: "https://www.ebay.co.uk/itm/dup-supplementary" },
          item("only-b", 20),
        ],
      });

      const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"] }), 8000);
      const dup = listings.filter((l) => l.sourceProductId === "v1|dup|0");
      expect(dup).toHaveLength(1);
      // first seen wins: the surviving row carries the PRIMARY's values —
      // title, price and condition — not the supplementary's
      expect(dup[0].title).toBe("primary title");
      expect(dup[0].conditionText).toBe("Pre-owned");
      expect(dup[0].prices).toEqual([{ kind: "active_listing", amount: 10, currency: "GBP" }]);
      expect(listings.map((l) => l.sourceProductId)).toEqual(["v1|dup|0", "v1|only-b|0"]);
    },
  );

  it("answers the deduped union of both windows, cheapest first, priceless last — UN-TRIMMED", async () => {
    // The app applies the merged cheapest-N cap AFTER its own non-game
    // reading (SIDECAR_MEDIAN_WINDOW), so this answer is up to two 50-row
    // windows, never pre-trimmed to one window's worth here — trimming here
    // would let merchandise occupy slots the app then deletes, shrinking a
    // sample that is already at the floor for most games in this catalog
    // (Decision 4 of the batch plan).
    interceptSearch("q=Mario+Kart+64").reply(200, {
      itemSummaries: [item("a1", 30), { ...item("shared", 10), title: "shared PRIMARY title" }, item("a2", 20)],
    });
    interceptSearch("q=Super+Mario+Kart+R").reply(200, {
      itemSummaries: [
        // same id as the primary window's cheapest row, but a DIFFERENT
        // title/condition — proves the merge keys on sourceProductId and
        // keeps the primary's fields, rather than the two calls happening to
        // answer with identical objects
        { ...item("shared", 10), title: "shared SUPPLEMENTARY title", condition: "New" },
        item("b1", 15),
        { itemId: "v1|priceless|0", title: "no price at all" }, // no `price` key
      ],
    });

    const listings = await searchMarket(tokens, UK, query({ alt: ["Super Mario Kart R"] }), 8000);
    expect(listings.map((l) => l.sourceProductId)).toEqual([
      "v1|shared|0",
      "v1|b1|0",
      "v1|a2|0",
      "v1|a1|0",
      "v1|priceless|0",
    ]);
    // 5 distinct rows out of 6 total: the shared id was counted once
    expect(new Set(listings.map((l) => l.sourceProductId)).size).toBe(5);
    // first seen wins: the surviving row is the PRIMARY's, not the
    // supplementary's
    const shared = listings.find((l) => l.sourceProductId === "v1|shared|0");
    expect(shared?.title).toBe("shared PRIMARY title");
    expect(shared?.conditionText).toBe("Pre-owned");
  });

  it("stamps available: true on every row", async () => {
    interceptSearch("q=Mario+Kart+64").reply(200, { itemSummaries: [item("1", 10), item("2", 20)] });
    const listings = await searchMarket(tokens, UK, query(), 8000);
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.available === true)).toBe(true);
  });

  it("names the currency eBay quoted, never the market's expected one", async () => {
    // Deliberately a currency EBAY_US does not expect (USD): the row must
    // carry what eBay actually said, not the market's manifest-declared
    // expectation — the app is the one that acts on the mismatch (Decision 6
    // of the batch plan), and this package only fetches and logs it
    // (mapping.test.ts owns the logging assertion).
    interceptSearch("q=Mario+Kart+64").reply(200, {
      itemSummaries: [{ itemId: "v1|1|0", title: "x", price: { value: "10.00", currency: "GBP" } }],
    });
    const [listing] = await searchMarket(tokens, MARKETS.ebay_us, query(), 8000);
    expect(listing.prices).toEqual([{ kind: "active_listing", amount: 10, currency: "GBP" }]);
  });
});
