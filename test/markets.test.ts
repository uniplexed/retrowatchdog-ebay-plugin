/**
 * Per-market request assertions, driven against `search.ts`'s real
 * `searchMarket`: the marketplace header and seller country, one category id
 * everywhere, and the currency read off the response, never the market's own.
 *
 * No per-market region tests: every market declares `defaultRegion: null`
 * (manifest.ts), and region reading is the app's shared classifier, pinned in
 * the app repository, apps/api/test/adapters/classifyListing.test.ts.
 *
 * The marketplace probes (../fixtures/marketplace-probes-2026-09-03.md) are
 * the evidence that one category id serves all five markets, and for each
 * market's expected currency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { EbayTokenClient } from "../src/client.js";
import { MARKETS, type Market } from "../src/manifest.js";
import { searchMarket } from "../src/search.js";
import type { SearchQuery } from "../src/server.js";

/**
 * ONE category id serves every marketplace. Verified live 2026-09-03: all
 * five answered HTTP 200 with a plausible total and no category error or
 * warning (fixtures/marketplace-probes-2026-09-03.md) — so a per-market id
 * would be dead configuration.
 */
const VIDEO_GAMES_CATEGORY_ID = "139973";

const ALL_MARKETS: Market[] = Object.values(MARKETS);

const item = () => ({
  itemId: "v1|101|0",
  title: "Zelda Ocarina of Time N64",
  price: { value: "24.99", currency: "GBP" },
  itemWebUrl: "https://www.ebay.co.uk/itm/101",
});

const query = (): SearchQuery => ({
  q: "Zelda Ocarina of Time",
  platform: "n64",
  alt: [],
  spellings: ["N64", "Nintendo 64"],
  budgetMs: undefined,
});

describe("each eBay market sends its own request", () => {
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
    // most markets are not GBP, and the fixture's item always quotes GBP —
    // that is deliberate (see the currency test below) and would otherwise
    // log a warning on every case; silenced here rather than asserted on.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    setGlobalDispatcher(previous);
    await agent.close();
  });

  /** Answers every Browse search, recording the path and headers of each. */
  const interceptSearch = () => {
    const calls: Array<{ path: string; marketplace: string }> = [];
    agent
      .get("https://api.ebay.com")
      .intercept({ path: /\/buy\/browse\/v1\/item_summary\/search.*/, method: "GET" })
      .reply(200, (opts) => {
        calls.push({
          path: opts.path,
          marketplace: String((opts.headers as Record<string, string>)["x-ebay-c-marketplace-id"] ?? ""),
        });
        return { itemSummaries: [item()] };
      })
      .persist();
    return calls;
  };

  it.each(ALL_MARKETS)(
    "$id sends $marketplaceId and asks for sellers in $country",
    async (market) => {
      const calls = interceptSearch();
      await searchMarket(tokens, market, query(), 8000);

      expect(calls).toHaveLength(1);
      expect(calls[0].marketplace).toBe(market.marketplaceId);
      expect(decodeURIComponent(calls[0].path)).toContain(`itemLocationCountry:${market.country}`);
      // the same one category id on every marketplace (see the constant above)
      expect(calls[0].path).toContain(`category_ids=${VIDEO_GAMES_CATEGORY_ID}`);
      // auctions stay excluded in every market: an opening bid is not a price
      expect(decodeURIComponent(calls[0].path)).toContain("buyingOptions:{FIXED_PRICE}");
    },
  );

  it("asks every market for the same category id", async () => {
    const calls = interceptSearch();
    for (const market of ALL_MARKETS) await searchMarket(tokens, market, query(), 8000);

    expect(calls.map((c) => c.marketplace)).toEqual(ALL_MARKETS.map((m) => m.marketplaceId));
    const ids = new Set(calls.map((c) => new URLSearchParams(c.path.split("?")[1]).get("category_ids")));
    expect([...ids]).toEqual([VIDEO_GAMES_CATEGORY_ID]);
  });

  it.each(ALL_MARKETS)("$id reads the currency off the response, never its own", async (market) => {
    // Deliberately the same GBP fixture for every market but the UK: what a
    // market usually quotes (manifest.ts's own `currency` field) is an
    // EXPECTATION, and the row must carry what this listing actually said. A
    // market that stamped its configured currency would report EUR/USD here.
    const calls = interceptSearch();
    const [listing] = await searchMarket(tokens, market, query(), 8000);
    expect(calls).toHaveLength(1); // the call really happened
    expect(listing.prices).toEqual([{ kind: "active_listing", amount: 24.99, currency: "GBP" }]);
  });
});
