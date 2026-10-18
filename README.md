# eBay plugin

A source plugin for [RetroWatchdog](https://github.com/uniplexed/retrowatchdog),
the manager of your retro game collection and your price hunts. It fetches
eBay Browse API listings so the app can price your copies and your watches
against the market, speaking protocol version 3 as set out in the protocol
document, `docs/sidecar-protocol.md` in the `retrowatchdog` repository. It serves five
`live` sources, one per marketplace: `ebay_uk`, `ebay_de`, `ebay_es`,
`ebay_fr` and `ebay_us`, or the subset `EBAY_PLUGIN_MARKETS` names. In a
RetroWatchdog deployment it runs as the compose service `ebay-plugin` behind
the `ebay` profile, from the image `EBAY_PLUGIN_IMAGE` names
(`retrowatchdog-ebay-plugin:latest` by default), and the app offers it as a
pending plugin row on first boot from `EBAY_PLUGIN_URL`
(`http://ebay-plugin:8000`); you approve its roles in Settings → Plugins and
switch its markets on in Settings → Markets. Nothing
about it is compiled into the app, and there is no adoption mechanism: a row
that reads "Approved automatically" is an old carry-over.

The general rules (what a plugin is, the fetch/interpret split, the manifest
and its approval, the isolation, the pacing) are in the protocol document;
this file covers only what this plugin does within them. Where the two
disagree, the protocol governs.

## Terms of use: eBay's API License Agreement binds you

The plugin uses eBay's official Browse API with the keys you register, so you
are the "Developer" who accepted eBay's
[API License Agreement](https://developer.ebay.com/join/api-license-agreement) (checked 2026-10-18). Its
rules reach the app that shows the data, not only this plugin. The ones that
matter here:

- **Keep listings fresh.** Displayed listing information may not be more than
  six hours older than on eBay, other eBay content not more than 24 hours;
  older data must say how old it is. The app's default price TTL is six hours
  and a stale block is labelled with its date.
- **Do not mix eBay content with other sources in a public display.** eBay
  content "may not be co-mingled or combined with non-eBay Content" and "must
  be visually isolated from third-party listings". RetroWatchdog's price
  table lists eBay beside CeX, Vinted and Wallapop rows; whether a private,
  self-hosted app is a "Public Display" is yours to judge.
- **No pricing models, no seller arbitrage.** eBay content may not be used
  "to suggest or model prices for items listed on eBay Site", and eBay
  services may not be used "to promote or engage in seller arbitrage"
  (eBay's examples are automatic repricing and dropshipping). RetroWatchdog
  compares eBay's asking prices with other shops' and tells you where a copy
  is cheaper; read both clauses and decide whether your use fits.
- **No derived statistics.** Site-wide statistics, category averages or
  seller data need eBay's written permission. The app's per-game median of
  the cheapest active listings is none of those, and it never leaves your
  deployment.
- **Delete what eBay removed.** Content no longer public on eBay must be
  deleted from the application; the app retires a listing when the TTL
  refresh no longer returns it.

This is not legal advice. The agreement is long and changes; read it when
you register your keys and again when it is updated.

## What it serves

| endpoint | answer |
|---|---|
| `GET /health` | `{status, protocol, configured, markets}`. `configured` is `true` only when both `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are set. `markets` is for humans; the app ignores it. |
| `GET /manifest` | one source per served market, with its label, country, currency, reach, roles, labels, caveat and fee rate, plus the two secret names |
| `GET /search?source=<id>&q=<text>[&platform=<id>][&alt=<name>…][&spelling=<text>…][&budgetMs=<int>]` | a JSON array of raw listings, cheapest first, priceless last |

`configured` reads the environment, never eBay: a wrong key still reads as
configured, and the app's circuit breaker reacts once a real search fails.

Status codes: `400` for a missing `source` or `q`; `404` for a source this
process does not serve or an unknown path; `502` when the fetch fails (a bad
response, an aborted request, a token the client could not obtain), so the
app's breaker counts it; `500` from `/manifest` when `EBAY_PLUGIN_MARKETS`
names a market this plugin cannot describe, with the id in the body. An empty
array is a fact about eBay, not a failure.

## What it leaves to the app

The protocol's general rules apply unchanged: the plugin fetches and never
classifies (no platform, region, completeness tier, grade or non-game
filtering leaves this process), the app paces, retries and breaks, and the
container sits on the `sidecars` network with no database, volume or
published host port. Four things are specific to this plugin:

- It excludes auctions (`buyingOptions:{FIXED_PRICE}`), the one judgement it
  makes about a listing: an opening bid is not a price, and the wire has no
  listing-type field for the app to decide it instead.
- It does not trim. The merged answer is up to 100 rows on a market that
  needed both calls; the app applies its `SIDECAR_MEDIAN_WINDOW` (50) after
  its non-game reading, so trimming here would let a merchandise row take a
  slot a real listing needed. The only timer here is the search budget.
- It holds one credential: `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` in its
  own env file, `.env.ebay` beside the app's `.env` in a RetroWatchdog
  deployment, never in the app's `.env` and never in this repository.
- It sends no `observedAt`. Absent means the moment of the search, which is
  what a live search is.

## What it declares

Every market: `kind: live`, `family: ebay`, `reach: global` (a seller can
list from anywhere), `defaultRegion: null` (a German listing is from Germany,
not a PAL claim; the key is sent explicitly because the validator refuses a
missing one), one expected currency, `kindRoles` `active_median → reference`
and `active_listing → buy_listing`, `kindLabels` "<market> median (active)"
and "<market> listing", the caveat "<market> prices are active FIXED-PRICE
listings, not sold prices.", and `sellFeeRate: 0.13`. No `schedule`: the
validator refuses one on a live source. `requiredSecrets` names the two
variables. The ids must never change, since stored prices and mappings use
them.

| id | marketplace header | seller country | currency | label |
|---|---|---|---|---|
| `ebay_uk` | `EBAY_GB` | GB | GBP | eBay UK |
| `ebay_de` | `EBAY_DE` | DE | EUR | eBay DE |
| `ebay_es` | `EBAY_ES` | ES | EUR | eBay ES |
| `ebay_fr` | `EBAY_FR` | FR | EUR | eBay FR |
| `ebay_us` | `EBAY_US` | US | USD | eBay US |

The app leaves `reference` unchecked at approval (protocol §6).

## How a search runs

One `EbayTokenClient` holds one client-credentials token for every market
this process serves, fetched from
`https://api.ebay.com/identity/v1/oauth2/token` with scope
`https://api.ebay.com/oauth/api_scope` and cached until 60 seconds before it
expires.

Each Browse call is `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
with `category_ids=139973`,
`filter=itemLocationCountry:<country>,buyingOptions:{FIXED_PRICE}`,
`sort=price` and `limit=50`, under the market's `x-ebay-c-marketplace-id`
header.

The query builder (`src/query.ts`) yields one or two keyword queries. The
first is the primary and carries the result: its failure fails the whole
search, so the app serves its stored block labelled stale rather than a half
window as fresh. The second is best-effort: it runs on what is left of the
budget after a 500 ms reserve, is skipped when nothing is left, and its
failure leaves the primary window untouched. The budget is
`min(budgetMs, EBAY_SEARCH_BUDGET_MS)`.

The two windows are merged by `sourceProductId`, first seen wins. The app's
median window does not deduplicate, on the assumption that a plugin answers
one call per request, so this is the one place the deduplication has to live.
Currencies a window quoted that the market did not declare are logged, never
dropped here; the app drops such a row.

### The query rules

eBay's keyword search ANDs every word of `q`, so a word the seller did not
type excludes the listing. A parenthesised, comma-separated group ORs its
members, each matched as a contiguous phrase, and whatever follows a group is
ANDed with it. Every rule below is a row in
`fixtures/query-probes-2026-09-02.md`.

| rule | evidence |
|---|---|
| Only a leading "The" is stripped | "The King of Fighters: Heat of Battle Game Boy" 0 hits, without "The" 1; "The Smurfs Game Boy" 28, "Smurfs Game Boy" 526. "A" and "An" have no evidence either way. |
| In a plain query the platform is the first seller spelling; after a group it is its own group of every spelling | `(…) Game Boy` 0, `(…) (Game Boy)` 0, `(…) (Game Boy, Gameboy)` 1 for a listing titled "…Gameboy Game…". A UI label no seller types ("NG Pocket Color") returns 0. |
| A `Main: Subtitle` title becomes one group query `(<title>, <subtitle>, <names…>) (<spellings>)` | a title-only group fell to 108 hits against the plain query's 137 and lost "n64 zelda ocarina of time"; adding the subtitle phrase gave 138 |
| A title without a subtitle stays a plain query; its alternative names go in a second, best-effort query | the one-group form lost 5 Mario Kart 64 listings and 3 accented Pokémon Red ones (probe 7); plain words before a group return 0 |
| A member needs two words | `(Castlevania: The Adventure, Adventure)` floods the 50-listing window with 446 hits, none Castlevania (probes 2b, 2d) |
| Non-Latin names are excluded; commas and parentheses are removed everywhere | `拳皇96 (Game Boy, Gameboy)` 0: inert, not harmful (probe 5) |
| A group query is capped at 510 characters, dropping members from the end and never the first | 156, 294 and 510 characters all returned the target (probe 4); nothing longer was measured |
| Names are deduplicated case- and punctuation-insensitively, accents kept | "Pokémon Red" and "Pokemon Red" stay two members; the unaccented one added 9 listings |

The app's `spelling=` parameters are authoritative; `src/spellings.ts` is the
fallback when none usable are sent. It is a copy of the app's console table
(`packages/shared/src/platforms.ts` in the `retrowatchdog` repository), not an
import, so the package depends on nothing outside this repository; a change
to either table is copied to the other by hand. A spelling that sanitises to
nothing is dropped, and if every wire entry is blank the local table is used.

The matcher verifies every returned title, so widening a query can only add
candidates, never mis-attribute them.

## How a listing is built

`src/mapping.ts` reads one Browse `item_summary`.

| Browse field | listing field | rule |
|---|---|---|
| `itemId` | `sourceProductId` | verbatim |
| `title` | `title` | verbatim; the app's cleaner and matcher are tuned on real seller text |
| `price.value`, `price.currency` | `prices[0]` | one price of kind `active_listing`; an item with no `price` sends an empty `prices` array, never a zero |
| `condition` | `conditionText` | eBay's structured field ("New", "Pre-owned"), passed through unread. It is the only way a sealed listing whose title carries no newness word reaches the app as new. |
| `itemWebUrl` | `url` | absent reads as `null` |
| (nothing) | `available` | always `true`: a Browse item summary is a live listing, and nothing app-side can know that |

Not mapped: `categoryText`. The app reads a live row's `categoryText` through
a hint list compiled from CeX's category names and lets it override the
title's platform guess, so mapping eBay's leaf category would change platform
classification through another shop's vocabulary. `legacyItemId`, images,
seller, shipping and the category tree carry no fact the protocol asks for.

## Configuration

`.env.example` names the credential and the port; `src/config.ts` reads all
five variables.

| variable | default | meaning |
|---|---|---|
| `PORT` | `8000` | the port inside the container |
| `EBAY_CLIENT_ID` | unset | eBay OAuth client id |
| `EBAY_CLIENT_SECRET` | unset | eBay OAuth client secret |
| `EBAY_SEARCH_BUDGET_MS` | `8000` | ceiling on one search, and the budget when the request carries no `budgetMs` |
| `EBAY_PLUGIN_MARKETS` | all five | comma-separated subset of `ebay_uk,ebay_de,ebay_es,ebay_fr,ebay_us` to declare and serve |

A blank value counts as absent, because compose passes "present but unset" as
an empty string. One process may serve any subset of the five markets, since
they share one OAuth application and one endpoint. An id in
`EBAY_PLUGIN_MARKETS` that is not one of the five is refused the first time
the manifest is built, never guessed.

## Evidence

- `fixtures/query-probes-2026-09-02.md`: 55 live `item_summary/search` calls
  against `EBAY_GB` with the request shape above, one probe per rule in the
  table.
- `fixtures/marketplace-probes-2026-09-03.md`: one call per marketplace for
  "Zelda Ocarina of Time N64". All five answered category `139973` with
  HTTP 200 (137, 121, 21, 42 and 575 hits), each in its own currency, and in
  three of the five the cheapest listing was a magazine, a keyring or a
  manual.
- `fixtures/item-summary-mario-world.json`: ten Browse item summaries, the
  input to the mapping tests and to the app's contract fixture.

## What is not verified

- The query rules were probed against `EBAY_GB` only; the other four markets
  are assumed to parse a query the same way.
- eBay publishes a quota of 5,000 Browse calls per day shared across all
  markets (read on 2026-09-05 from developer.ebay.com). It has not been
  load-tested; a quota that resets or aggregates differently would surface
  only as a deployment approached it.
- The probes are trusted as measured on their dates. If eBay's ranking, its
  category id or a market's currency changes, nothing here notices until
  results look wrong.

## How to get eBay credentials and configure the plugin

Goal: have `/health` report `configured: true` and searches answer.

Prerequisites: an eBay developer account on developer.ebay.com, and the
plugin built and running (next section).

1. On developer.ebay.com, register an application and note its client id and
   client secret. The plugin uses the Browse API with client credentials and
   the scope `https://api.ebay.com/oauth/api_scope`.
2. Copy `.env.example` to `.env.ebay` beside the app's `.env` on the host
   that runs the stack and fill in `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`.
   Compose reads it with `required: false`, so a deployment without it still
   boots, with `configured: false`.
3. Recreate the container: `docker compose --profile ebay up -d ebay-plugin`.
4. In Settings → Plugins, press "Check now" on the eBay row: it reports
   configured. Approve its roles and switch markets on in Settings → Markets.
5. Check: open a game; each enabled eBay market shows listings. A wrong key
   still reads as configured and surfaces as that source's error after the
   first search.

## How to serve a subset of markets

Goal: declare only some of the five markets from this process.

1. Set `EBAY_PLUGIN_MARKETS` in `.env.ebay` beside the app's `.env` to a
   comma-separated list of ids from the market table.
2. Recreate the container: `docker compose --profile ebay up -d ebay-plugin`.
3. In Settings → Plugins, press "Check now" on the eBay row; the changed
   manifest asks for a re-approval.
4. Check: the row lists only those markets. An id outside the five shows as
   the row's last error, naming the id and the known markets.

## How to build and run it

Goal: have the plugin answering on the app's compose network.

Prerequisites: Docker with the compose plugin, this repository checked out,
and a RetroWatchdog deployment to attach it to.

1. From this repository's root, run
   `docker build -t retrowatchdog-ebay-plugin:latest .`. To use another tag,
   set `EBAY_PLUGIN_IMAGE` in the app's `.env` to it.
2. From the app's directory, run
   `docker compose --profile ebay up -d ebay-plugin`.
3. Run `docker compose logs ebay-plugin`. The last line reads
   `ebay-plugin serving ebay_uk, ebay_de, ebay_es, ebay_fr, ebay_us on port 8000 (protocol 3)`,
   or the subset configured.
4. Check: in Settings → Plugins the eBay row, offered pending on first boot
   from `EBAY_PLUGIN_URL`, answers "Check now".

The build context is this repository and the package depends on nothing
outside it. The process runs as an unprivileged user and publishes no host
port.

## How to run the tests

Goal: run this package's suite and type check.

Prerequisites: Node and pnpm, and `pnpm install` run in this repository.

1. Run `pnpm test`.
2. Run `pnpm typecheck`.
3. Check: vitest reports every file passed and `tsc` prints nothing.

Every test is offline:

- `test/config.test.ts`: the five variables above, including the "both halves
  or neither" rule for `configured`.
- `test/manifest.test.ts`: what the plugin declares, the three fields the
  app's validator is strictest about (an explicit `defaultRegion: null`, no
  `schedule` on a live source, an `id` on every source), and that
  `manifestPayload()` deep-equals `manifest.fixture.json` after `JSON.parse`,
  so key order and whitespace are free.
- `test/markets.test.ts`: per market, the marketplace header, the
  seller-country filter, the one category id and the currency read off the
  response.
- `test/client.test.ts`: the token fetch, cached and shared across markets,
  and single-call query building against `MockAgent`; a credential-less
  client answers `configured: false`.
- `test/query.test.ts`: every rule in the table, plus the wire `spelling=`
  path against the local-table fallback.
- `test/mapping.test.ts`: the mapping field for field, including item 1009
  (condition `"New"`, no newness word in the title) and
  `logUnexpectedCurrencies`.
- `test/search.test.ts`: the primary and supplementary orchestration, the
  budget reserve, the id-keyed deduplication with the primary's fields
  surviving, and the un-trimmed, cheapest-first order.
- `test/server.test.ts`: the three routes over a loopback socket with a stub
  search.

To run the process without Docker, `pnpm dev` starts `tsx watch` on port
8000, reading the same variables from the environment; copy `.env.example`
to `.env` and export its values first.

## How to regenerate the fixtures

Goal: keep `manifest.fixture.json` equal to what `src/manifest.ts` produces
after a change to it or to `src/config.ts`, and record the change in the app.

The app keeps a recorded copy of this plugin's manifest and of the rows
`ebayItemToRawListing` builds from `fixtures/item-summary-mario-world.json`,
as `apps/api/src/adapters/sidecar/fixtures/ebay-manifest.json` and
`apps/api/src/adapters/sidecar/fixtures/ebay-plugin-search-2026-09-05.json`
in the `retrowatchdog` repository; its
`apps/api/test/adapters/sidecar/ebayPluginContract.test.ts` runs
`validateManifest` over the first and the app's parser and classifier over
the second. A change to the manifest or to the mapping must be recorded
there.

Prerequisites: the test prerequisites above.

1. Write the script inside this repository. A relative ESM import resolves
   against the file's own location, never the shell's working directory, and
   not at all inside a `tsx -e` string. For the manifest:

   ```bash
   # from this repository's root
   cat > .gen-fixture.mts <<'EOF'
   import { loadSettings } from "./src/config.js";
   import { manifestPayload } from "./src/manifest.js";
   console.log(JSON.stringify(manifestPayload(loadSettings({})), null, 2));
   EOF
   npx tsx .gen-fixture.mts > manifest.fixture.json
   rm .gen-fixture.mts
   ```

   For the rows, the same shape of script prints
   `fixture.itemSummaries.map(ebayItemToRawListing)` over
   `fixtures/item-summary-mario-world.json`.
2. Copy the outputs into the app repository under the file names above.
3. Check: `pnpm test` here and the app's `ebayPluginContract` test both pass.

## How to bump a dependency

Goal: move `undici`, `typescript` or `@types/node` to a new version.

1. Change the version in `package.json` and in both `RUN npm install --no-save`
   lines of the Dockerfile. The Dockerfile's exact versions are what the image
   builds and runs with; `package.json`'s ranges and `pnpm-lock.yaml` serve
   the local `pnpm install`, and nothing but this step keeps the two aligned.
2. Run `pnpm install`, then the tests above.
3. Rebuild and run as above, and check the boot line in the log.

`undici` is the one runtime dependency: its `fetch` is the one `MockAgent`
can intercept, so `client.ts` and `search.ts` import it and the tests
exercise every path without reaching eBay.

## Legal

[LEGAL.md](LEGAL.md): the source's terms as last read, what they mean for
whoever runs this plugin, no warranty, not financial advice, no affiliation.
The names of the shops and marketplaces are their owners' trademarks, used
only to say where a price came from.

## License

Free software under the [GNU Affero General Public License v3.0](LICENSE),
and only that. Contributions are accepted under the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).
