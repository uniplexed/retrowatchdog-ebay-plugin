/**
 * The wire row this package answers `GET /search` with, one eBay Browse
 * `item_summary` at a time. `available: true` is stamped here because a Browse
 * item summary IS a live listing, and nothing app-side can know that.
 */

/** The shape of one eBay Browse `item_summary` this package's mapping cares about. */
export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl?: string;
}

/** One price, exactly the shape the protocol document's price object wants. */
export interface RawPrice {
  kind: "active_listing";
  amount: number;
  currency: string;
}

/** The row this package answers `GET /search` with; the app rebuilds and interprets it (the protocol document, `docs/sidecar-protocol.md` in the `retrowatchdog` repository). */
export interface RawListing {
  sourceProductId: string;
  title: string;
  /** eBay's own structured condition field ("New"/"Pre-owned"), where it has one. */
  conditionText?: string;
  url: string | null;
  prices: RawPrice[];
  /** always true: a Browse result is a live listing */
  available: true;
}

export function ebayItemToRawListing(item: EbayItemSummary): RawListing {
  return {
    sourceProductId: item.itemId,
    title: item.title,
    conditionText: item.condition,
    url: item.itemWebUrl ?? null,
    prices: item.price
      ? [{ kind: "active_listing", amount: Number(item.price.value), currency: item.price.currency }]
      : [],
    available: true,
  };
}

/**
 * Logs currencies a window quoted that the market did not declare. The plugin
 * only logs (it fetches, never judges); the app drops such rows, so this log is
 * where a maintainer learns what was dropped.
 */
export function logUnexpectedCurrencies(listings: readonly RawListing[], expected: string, marketId: string): void {
  const seen: string[] = [];
  for (const listing of listings) {
    for (const price of listing.prices) {
      if (price.currency !== expected && !seen.includes(price.currency)) seen.push(price.currency);
    }
  }
  if (seen.length > 0) {
    // eslint-disable-next-line no-console -- this package has no logging dependency by design
    console.warn(
      `${marketId}: eBay listings quoted a currency this market was not expected to quote ` +
        `(expected ${expected}, saw ${seen.join(", ")}); the app now drops such a row rather than keeping it`,
    );
  }
}
