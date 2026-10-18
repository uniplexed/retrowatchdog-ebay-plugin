/**
 * EbayTokenClient and a single Browse call: a token, one query, one fetch and
 * the raw parse. The two-call search, its merge and its budget are pinned in
 * search.test.ts; the median window is app-side (SIDECAR_MEDIAN_WINDOW).
 *
 * This package does not filter (isNonGameListing stays app-side, in
 * SidecarAdapter.collect), so item 1010 (a manual-only listing) is a row it is
 * REQUIRED to return. That a merchandise row arriving from a plugin is dropped
 * by the app is pinned in the app repository,
 * apps/api/test/adapters/sidecar/adapter.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, fetch as undiciFetch, type Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { EbayTokenClient, type EbayCreds } from "../src/client.js";
import { buildEbayQueries } from "../src/query.js";
import type { Platform } from "../src/spellings.js";
import { loadSettings } from "../src/config.js";
import { makeHandler } from "../src/server.js";

const fixture = readFileSync(new URL("../fixtures/item-summary-mario-world.json", import.meta.url), "utf8");

/** The shape of one eBay Browse item_summary this test harness cares about. */
interface RawItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl?: string;
}

const VIDEO_GAMES_CATEGORY_ID = "139973";

/**
 * TEST-ONLY SCAFFOLDING, not search.ts's real shape (which merges the primary
 * and supplementary calls under a budget).
 * This does exactly what every single-call test below needs and nothing
 * more: get a token, build ONE query (the primary — buildEbayQueries()[0]),
 * make ONE fetch, and hand back the raw itemSummaries with no non-game
 * filtering and no windowing, because this package does neither (Decision 2
 * / EBAY_WINDOW_LIMIT stays app-side).
 */
async function searchOnce(
  tokens: EbayTokenClient,
  query: string,
  platformHint?: Platform,
  opts: { alternativeNames?: readonly string[] } = {},
): Promise<RawItemSummary[]> {
  const token = await tokens.getToken();
  const [primary] = buildEbayQueries({ title: query, alternativeNames: opts.alternativeNames ?? [] }, platformHint);
  const params = new URLSearchParams({
    q: primary,
    category_ids: VIDEO_GAMES_CATEGORY_ID,
    filter: "itemLocationCountry:GB,buyingOptions:{FIXED_PRICE}",
    sort: "price",
    limit: "50",
  });
  // Deliberately undici's own `fetch`, not the platform global: see
  // client.ts's module comment — global fetch in this environment is not
  // wired to MockAgent's global dispatcher, only undici's own export is.
  const res = await undiciFetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": "EBAY_GB",
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`eBay search HTTP ${res.status}`);
  const body = (await res.json()) as { itemSummaries?: RawItemSummary[] };
  return body.itemSummaries ?? [];
}

describe("EbayTokenClient + a single Browse call", () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });
  afterEach(async () => {
    setGlobalDispatcher(original);
    await mockAgent.close();
  });

  it("fetches a client-credentials token once and searches EBAY_GB", async () => {
    let tokenCalls = 0;
    let seenAuth = "";
    let seenMarketplace = "";
    let seenPath = "";
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: "/identity/v1/oauth2/token", method: "POST" })
      .reply(200, (opts) => {
        tokenCalls += 1;
        seenAuth = String((opts.headers as Record<string, string>).authorization ?? "");
        return { access_token: "ebay-tok", expires_in: 7200, token_type: "Application Access Token" };
      })
      .times(1);
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: /\/buy\/browse\/v1\/item_summary\/search.*/, method: "GET" })
      .reply(200, (opts) => {
        seenPath = opts.path;
        seenMarketplace = String((opts.headers as Record<string, string>)["x-ebay-c-marketplace-id"] ?? "");
        return fixture;
      })
      .times(2);

    const tokens = new EbayTokenClient({ clientId: "cid", clientSecret: "sec" });
    const first = await searchOnce(tokens, "super mario world", "snes");
    const second = await searchOnce(tokens, "super mario world", "snes");
    // fixture has 10 items; item 1010 is a manual-only listing. Unlike the
    // app's EbayAdapter, this package filters nothing (Decision 2), so it
    // comes back — see the module comment for where that coverage moved.
    expect(first).toHaveLength(10);
    expect(first[0].price).toEqual({ value: "45.00", currency: "GBP" });
    expect(second).toHaveLength(10);
    expect(tokenCalls).toBe(1); // token cached
    expect(seenAuth.startsWith("Basic ")).toBe(true);
    expect(seenMarketplace).toBe("EBAY_GB");
    expect(seenPath).toContain("category_ids=139973");
    expect(seenPath).toContain("q=super");
    // finding 6: auctions (current-bid listings) must be excluded so a £0.99
    // opening bid never pollutes the cheapest-50 median / underpriced signal.
    expect(decodeURIComponent(seenPath)).toContain("buyingOptions:{FIXED_PRICE}");
  });

  it("queries eBay without the title's leading article (every keyword is required by eBay)", async () => {
    let seenPath = "";
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: "/identity/v1/oauth2/token", method: "POST" })
      .reply(200, { access_token: "ebay-tok", expires_in: 7200, token_type: "Application Access Token" });
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: /\/buy\/browse\/v1\/item_summary\/search.*/, method: "GET" })
      .reply(200, (opts) => {
        seenPath = opts.path;
        return fixture;
      });

    const tokens = new EbayTokenClient({ clientId: "cid", clientSecret: "sec" });
    await searchOnce(tokens, "The Smurfs", "gb");
    // live probe 2026-09-02: "The Smurfs Game Boy" -> 28 listings, "Smurfs Game Boy" -> 526
    expect(seenPath).toContain("q=Smurfs+Game+Boy");
    expect(seenPath).not.toContain("q=The+");
  });

  it("sends one group query, URL-encoded, for a title with a subtitle member and alternative names", async () => {
    let seenPath = "";
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: "/identity/v1/oauth2/token", method: "POST" })
      .reply(200, { access_token: "ebay-tok", expires_in: 7200, token_type: "Application Access Token" });
    mockAgent
      .get("https://api.ebay.com")
      .intercept({ path: /\/buy\/browse\/v1\/item_summary\/search.*/, method: "GET" })
      .reply(200, (opts) => {
        seenPath = opts.path;
        return fixture;
      });

    const tokens = new EbayTokenClient({ clientId: "cid", clientSecret: "sec" });
    await searchOnce(tokens, "The King of Fighters: Heat of Battle", "gb", {
      alternativeNames: ["Nettou The King of Fighters '96", "拳皇96"],
    });
    // fixtures/query-probes-2026-09-02.md, probe 3: this exact three-member
    // group was never sent. Each of its members is measured to carry item
    // 226342839550 on its own — lines 131, 133 and 134, each -> 1, YES — and
    // a group is an OR (fact 1), so it is expected to find it too. What IS
    // measured about the shape: "(...) Game Boy" finds nothing (lines 118,
    // 119, 122-125), and the non-Latin name is inert (probe 5, line 151), so
    // it is left out
    expect(seenPath).toContain(
      "q=%28King+of+Fighters%3A+Heat+of+Battle%2C+Heat+of+Battle%2C+Nettou+The+King+of+Fighters+%2796%29+%28Game+Boy%2C+Gameboy%29&",
    );
    expect(new URL(`https://api.ebay.com${seenPath}`).searchParams.get("q")).toBe(
      "(King of Fighters: Heat of Battle, Heat of Battle, Nettou The King of Fighters '96) (Game Boy, Gameboy)",
    );
  });
});

/**
 * What this package owns about credentials is /health's `configured` field,
 * wired in server.ts to a real EbayTokenClient.isConfigured(): no credentials
 * -> isConfigured() is false -> /health answers configured: false.
 *
 * The app never asks this directly — it reads the plugin's own /health, and
 * the fact that decides
 * whether the APP treats the source as configured is narrower still:
 * pluginConfigured() (in the app repository, apps/api/src/sources/registry.ts) requires
 * BOTH `plugin.status === "approved"` AND `plugin.lastHealth?.configured ===
 * true`. So a plugin that answers `configured: true` here but has never been
 * polled (no lastHealth yet) or is not yet approved still reads as
 * NOT configured to the app.
 *
 * Uses the same loopback-server pattern test/server.test.ts uses.
 */
describe("EbayTokenClient wired into /health", () => {
  it("is not configured without credentials, and /health reports configured: false", async () => {
    const creds: EbayCreds = {};
    const tokens = new EbayTokenClient(creds);
    expect(tokens.isConfigured()).toBe(false);

    const settings = loadSettings({ EBAY_PLUGIN_MARKETS: "ebay_uk" });
    const server = createServer(makeHandler({ settings, search: async () => [], tokenClient: tokens }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      expect(body).toMatchObject({ status: "ok", configured: false });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
