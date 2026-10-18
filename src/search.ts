/**
 * `GET /search`: one market, one query. The primary query carries the result
 * (its failure fails the search, so the app serves stale rather than a half
 * window as fresh); supplementary queries are best-effort within the budget,
 * `min(request budgetMs, EBAY_SEARCH_BUDGET_MS)`.
 *
 * The merge MUST de-duplicate by `sourceProductId`: the app's median window
 * does not, and a duplicate would silently skew it. The union is NOT capped
 * to cheapest-N here: the app filters non-games first, then caps, so capping
 * here would let merchandise take slots the app then deletes.
 */
import { fetch } from "undici"; // MockAgent-interceptable fetch, see client.ts
import { EbayTokenClient } from "./client.js";
import { buildEbayQueries } from "./query.js";
import type { Platform } from "./spellings.js";
import { MARKETS, type Market } from "./manifest.js";
import { ebayItemToRawListing, logUnexpectedCurrencies, type EbayItemSummary, type RawListing } from "./mapping.js";
import type { SearchFn, SearchQuery } from "./server.js";

/** Video Games on every marketplace (fixtures/marketplace-probes-2026-09-03.md: all five answered it). */
const VIDEO_GAMES_CATEGORY_ID = "139973";

/** The `limit` per Browse call, not a cap on what this file answers. */
const WINDOW_LIMIT = "50";
/** the most one Browse answer may weigh; 50 summaries are well under 1 MB */
const MAX_RESPONSE_CHARS = 8_000_000;

/** Kept back from the budget so a slow second call cannot outlive the app's timer and lose the primary window. */
const SUPPLEMENTARY_RESERVE_MS = 500;

async function fetchWindow(
  tokens: EbayTokenClient,
  market: Market,
  q: string,
  signal: AbortSignal,
): Promise<EbayItemSummary[]> {
  const token = await tokens.getToken();
  const params = new URLSearchParams({
    q,
    category_ids: VIDEO_GAMES_CATEGORY_ID,
    // auctions excluded: an opening bid is not a real price (see manifest.ts)
    filter: `itemLocationCountry:${market.country},buyingOptions:{FIXED_PRICE}`,
    sort: "price",
    limit: WINDOW_LIMIT,
  });
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": market.marketplaceId,
      accept: "application/json",
    },
    signal,
    redirect: "error",
  });
  if (!res.ok) throw new Error(`eBay search HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error(`eBay answered ${text.length} characters, more than the plugin accepts`);
  const body = JSON.parse(text) as { itemSummaries?: unknown };
  if (body.itemSummaries !== undefined && !Array.isArray(body.itemSummaries)) throw new Error("eBay's itemSummaries is not an array");
  return (body.itemSummaries ?? []) as EbayItemSummary[];
}

/** Cheapest first, a priceless row last; never sliced here. */
function sortListings(listings: RawListing[]): RawListing[] {
  const price = (l: RawListing): number => l.prices[0]?.amount ?? Number.POSITIVE_INFINITY;
  return [...listings].sort((a, b) => price(a) - price(b));
}

/** One market, one query: primary, best-effort supplementaries, merged by `sourceProductId` (first wins), un-trimmed. */
export async function searchMarket(
  tokens: EbayTokenClient,
  market: Market,
  query: SearchQuery,
  maxBudgetMs: number,
): Promise<RawListing[]> {
  const startedAt = Date.now();
  const budgetMs = Math.min(query.budgetMs ?? maxBudgetMs, maxBudgetMs);
  const [primary, ...supplementary] = buildEbayQueries(
    { title: query.q, alternativeNames: query.alt },
    query.platform as Platform | undefined,
    query.spellings,
  );

  const seen = new Set<string>();
  const listings: RawListing[] = [];
  const collect = (items: EbayItemSummary[]): void => {
    for (const item of items) {
      const listing = ebayItemToRawListing(item);
      if (seen.has(listing.sourceProductId)) continue;
      seen.add(listing.sourceProductId);
      listings.push(listing);
    }
  };

  // the primary's failure fails the whole search (stale-if-error app-side)
  collect(await fetchWindow(tokens, market, primary, AbortSignal.timeout(budgetMs)));

  for (const q of supplementary) {
    const remainingMs = budgetMs - (Date.now() - startedAt) - SUPPLEMENTARY_RESERVE_MS;
    if (remainingMs <= 0) {
      // eslint-disable-next-line no-console -- this package has no logging dependency by design
      console.warn(`${market.id}: eBay supplementary query skipped, fetch budget spent`);
      break;
    }
    try {
      collect(await fetchWindow(tokens, market, q, AbortSignal.timeout(remainingMs)));
    } catch (err) {
      // eslint-disable-next-line no-console -- this package has no logging dependency by design
      console.warn(`${market.id}: eBay supplementary query failed, serving the primary window`, err);
    }
  }

  logUnexpectedCurrencies(listings, market.currency, market.id);

  return sortListings(listings);
}

/** Binds the shared token client and this deployment's budget ceiling into a `SearchFn`. */
export function makeSearch(tokens: EbayTokenClient, maxBudgetMs: number): SearchFn {
  return (marketId, query) => {
    const market = MARKETS[marketId];
    // defensive: handleSearch already refuses a market this process does not serve
    if (!market) return Promise.reject(new Error(`this plugin does not serve ${marketId}`));
    return searchMarket(tokens, market, query, maxBudgetMs);
  };
}
