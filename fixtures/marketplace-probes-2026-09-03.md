# eBay marketplace probes — 2026-09-03

Live evidence for the multi-market batch. One `item_summary/search` call per
marketplace with the adapter's own request shape: `category_ids=139973`,
`filter=itemLocationCountry:<the market's country>,buyingOptions:{FIXED_PRICE}`,
`sort=price`, `limit=5`, query `Zelda Ocarina of Time N64`, the app's own
production keys, one client-credentials token for all five.

| marketplace | HTTP | total | currencies seen | cheapest returned |
| --- | ---: | ---: | --- | --- |
| `EBAY_GB` | 200 | 137 | GBP | 6.00 GBP — "Nintendo 64 Magazine N64 Manual Tips Book No8- Zelda Ocarina o…" |
| `EBAY_DE` | 200 | 121 | EUR | 6.99 EUR — "Zelda Ocarina Of Time N64 Miniatur Spielmodul Schlüsselanhäng…" |
| `EBAY_ES` | 200 | 21 | EUR | 14.95 EUR — "GUIA GUIDE BOOK THE LEGEND OF ZELDA OCARINA OF TIME guidebook…" |
| `EBAY_FR` | 200 | 42 | EUR | 19.99 EUR — "Notice Nintendo 64 N64 The Legend Of Zelda Ocarina Of Time - 1…" |
| `EBAY_US` | 200 | 575 | USD | 5.49 USD — "[REGION LOCK] Authentic Japanese Nintendo 64 Games - New batte…" |

## What this establishes

1. **One category id serves every marketplace.** `139973` returned HTTP 200
   with a plausible total on all five; no marketplace returned a category
   error or warning. The spec's "verify per marketplace and store
   per-marketplace ids" is therefore NOT needed — a single constant stays
   correct, and a per-market override would be dead configuration.
2. **Each marketplace quotes its own currency**, uniformly across the sampled
   window: GB→GBP, DE/ES/FR→EUR, US→USD. The adapter must read
   `price.currency` from the response (it already does) and must NOT compare
   raw amounts across markets — today's `cheapestWindow` sorts on the raw
   number, which is correct only while a window is single-currency.
3. **Market sizes differ by an order of magnitude** (ES 21 vs US 575 for the
   same query). A per-market `SIGNAL_MIN_SAMPLE` is not introduced here, but
   thin markets will legitimately report INSUFFICIENT_DATA more often, which
   is the honest outcome.
4. The cheapest listing in three of the five markets is a magazine, a
   keyring and a manual — the non-game filter is keyword-based and English,
   so it does not catch "Miniatur Spielmodul Schlüsselanhänger" or "Notice".
   Per-locale non-game words are needed for the new markets; see the batch
   spec.
