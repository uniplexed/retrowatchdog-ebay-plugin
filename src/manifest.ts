/**
 * What this plugin declares about itself: a PROPOSAL the app validates and a
 * person approves before any price is stored.
 *
 * - `reference` + `buy_listing`: the cheapest-N median of active fixed-price
 *   listings is the reference every other source is measured against.
 * - `global` reach: a seller can list from anywhere.
 * - `defaultRegion: null`: a German listing is FROM Germany, not a PAL claim.
 * - The caveat says FIXED-PRICE because excluding auctions is the one
 *   judgement this plugin makes (an opening bid is not a price), and it cannot
 *   be app-side: the wire has no listing-type field.
 */

import type { Settings } from "./config.js";

export const PROTOCOL_VERSION = 3;
export const PLUGIN_NAME = "ebay";
export const PLUGIN_VERSION = "1.0.0";

/** The facts one eBay marketplace fixes, and the app must be told. */
export interface Market {
  readonly id: string;
  /** the `x-ebay-c-marketplace-id` header value this market's fetch uses, e.g. "EBAY_DE" */
  readonly marketplaceId: string;
  /** ISO 3166-1 alpha-2; also the `itemLocationCountry` filter value this market's fetch uses */
  readonly country: string;
  /** what this market quotes; the app drops a row quoted in anything else */
  readonly currency: string;
  /** the heading a user reads above these prices */
  readonly label: string;
}

/** Keyed by the app's source id; these ids must never change (stored prices and mappings use them). */
export const MARKETS: Readonly<Record<string, Market>> = {
  ebay_uk: { id: "ebay_uk", marketplaceId: "EBAY_GB", country: "GB", currency: "GBP", label: "eBay UK" },
  ebay_de: { id: "ebay_de", marketplaceId: "EBAY_DE", country: "DE", currency: "EUR", label: "eBay DE" },
  ebay_es: { id: "ebay_es", marketplaceId: "EBAY_ES", country: "ES", currency: "EUR", label: "eBay ES" },
  ebay_fr: { id: "ebay_fr", marketplaceId: "EBAY_FR", country: "FR", currency: "EUR", label: "eBay FR" },
  ebay_us: { id: "ebay_us", marketplaceId: "EBAY_US", country: "US", currency: "USD", label: "eBay US" },
};

/** A configured market this plugin cannot describe: raised, since a guessed currency would misprice silently. */
export class UnknownMarket extends Error {}

export function manifestPayload(settings: Settings): Record<string, unknown> {
  const sources = settings.markets.map((id) => {
    const market = MARKETS[id];
    if (!market) {
      throw new UnknownMarket(
        `EBAY_PLUGIN_MARKETS names ${JSON.stringify(id)}, which this plugin cannot describe; ` +
          `known markets: ${Object.keys(MARKETS).sort().join(", ")}`,
      );
    }
    return {
      id: market.id,
      kind: "live",
      label: market.label,
      family: "ebay",
      familyLabel: "eBay",
      country: market.country,
      reach: "global",
      // explicit null: `undefined` vanishes in JSON.stringify, and a MISSING key is refused
      defaultRegion: null,
      expectedCurrencies: [market.currency],
      kindRoles: { active_median: "reference", active_listing: "buy_listing" },
      kindLabels: {
        active_median: `${market.label} median (active)`,
        active_listing: `${market.label} listing`,
      },
      caveat: `${market.label} prices are active FIXED-PRICE listings, not sold prices.`,
      sellFeeRate: 0.13,
      // no `schedule`: validateManifest refuses one on a live source
    };
  });

  return {
    protocol: PROTOCOL_VERSION,
    plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
    requiredSecrets: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    sources,
  };
}
