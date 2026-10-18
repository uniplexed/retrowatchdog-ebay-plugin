/**
 * The HTTP surface: GET /health, GET /manifest and GET /search, the same three
 * routes the Vinted sidecar serves. `node:http` keeps the image free of any
 * framework dependency tree. No pacing, retry, cache or circuit breaker here:
 * those belong to the app, so there is one answer to "how hard do we hit eBay".
 */

import { PLATFORMS } from "./spellings.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { EbayTokenClient } from "./client.js";
import { loadSettings, type Settings } from "./config.js";
import { MARKETS, PROTOCOL_VERSION, UnknownMarket, manifestPayload } from "./manifest.js";
import { makeSearch } from "./search.js";

/** One request's /search parameters: fetching decisions only (protocol document §3). */
export interface SearchQuery {
  q: string;
  platform: string | undefined;
  /** the catalog's other names for this game, repeated in the query as `alt=` */
  alt: string[];
  /** how sellers write `platform`'s console, repeated as `spelling=`; sent only when `platform` is */
  spellings: string[];
  /** milliseconds left of the app's own fetch budget, if it said; absent means "work it out yourself" */
  budgetMs: number | undefined;
}

/** (market id, query) -> raw listings for that market; injected so tests need no real eBay call. */
export type SearchFn = (marketId: string, query: SearchQuery) => Promise<unknown[]>;

/**
 * The app reads only `{status, protocol, configured}`; `markets` is for humans.
 * `configured` never probes eBay: a wrong key still reads as configured, and
 * the app's circuit breaker reacts once a real /search fails.
 */
export function healthPayload(settings: Settings, tokenClient: EbayTokenClient): Record<string, unknown> {
  return {
    status: "ok",
    protocol: PROTOCOL_VERSION,
    configured: tokenClient.isConfigured(),
    markets: settings.markets,
  };
}

export function makeHandler(opts: {
  settings: Settings;
  search: SearchFn;
  /** Shared with makeSearch so one token cache serves every market; built from `settings` when absent. */
  tokenClient?: EbayTokenClient;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const { settings, search } = opts;
  const tokenClient =
    opts.tokenClient ??
    new EbayTokenClient({ clientId: settings.ebayClientId, clientSecret: settings.ebayClientSecret });
  return (req, res) => {
    route(req, res, settings, search, tokenClient).catch((error: unknown) => {
      // this process's bug: answer it rather than hang the socket, never as a 200
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  settings: Settings,
  search: SearchFn,
  tokenClient: EbayTokenClient,
): Promise<void> {
  if (req.method !== "GET") {
    send(res, 404, { error: `no such endpoint: ${req.method ?? "?"} ${req.url ?? "/"}` });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    send(res, 200, healthPayload(settings, tokenClient));
    return;
  }
  if (url.pathname === "/manifest") {
    handleManifest(res, settings);
    return;
  }
  if (url.pathname === "/search") {
    await handleSearch(res, settings, search, url.searchParams);
    return;
  }
  send(res, 404, { error: `no such endpoint: ${url.pathname}` });
}

function handleManifest(res: ServerResponse, settings: Settings): void {
  try {
    send(res, 200, manifestPayload(settings));
  } catch (error) {
    if (error instanceof UnknownMarket) {
      // 500: the deployment is misconfigured; the app shows this body as the plugin's last error
      send(res, 500, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleSearch(
  res: ServerResponse,
  settings: Settings,
  search: SearchFn,
  params: URLSearchParams,
): Promise<void> {
  // one plugin serves several markets, so a request without `source` is a caller bug
  const source = params.get("source");
  if (!source) {
    send(res, 400, { error: "source is required" });
    return;
  }
  if (!settings.markets.includes(source) || !MARKETS[source]) {
    // 404: well formed, but this process does not serve that market
    send(res, 404, { error: `this plugin does not serve ${source}` });
    return;
  }
  const q = params.get("q");
  if (!q) {
    send(res, 400, { error: "q is required" });
    return;
  }
  if (q.length > 512) {
    send(res, 400, { error: "q is longer than 512 characters" });
    return;
  }
  // an unknown platform is the caller's mistake, not eBay's: it must not read
  // as a 502 that counts against eBay in the app's breaker
  const platform = params.get("platform") ?? undefined;
  if (platform !== undefined && !(platform in PLATFORMS)) {
    send(res, 400, { error: `unknown platform ${platform}` });
    return;
  }
  const query: SearchQuery = {
    q,
    platform,
    alt: params.getAll("alt").slice(0, 50),
    spellings: params.getAll("spelling"),
    budgetMs: parseOptionalInt(params.get("budgetMs")),
  };
  try {
    const listings = await search(source, query);
    // a failure must be a status, never an empty 200: the app's circuit breaker counts statuses
    send(res, 200, listings);
  } catch (error) {
    send(res, 502, { error: describeError(error) });
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.constructor.name}: ${error.message}`;
  return String(error);
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, { "content-type": "application/json", "content-length": String(body.length) });
  res.end(body);
}

function main(): void {
  const settings = loadSettings();
  // one instance: /health and every market's search share one token cache
  const tokenClient = new EbayTokenClient({
    clientId: settings.ebayClientId,
    clientSecret: settings.ebayClientSecret,
  });
  const search = makeSearch(tokenClient, settings.searchBudgetMs);
  const server = createServer(makeHandler({ settings, search, tokenClient }));
  // every interface inside the container; compose publishes no host port for it
  server.listen(settings.port, () => {
    // eslint-disable-next-line no-console -- this package has no logging dependency by design
    console.log(
      `ebay-plugin serving ${settings.markets.join(", ") || "no markets"} on port ${settings.port} (protocol ${PROTOCOL_VERSION})`,
    );
  });
}

// run only when executed directly, never when a test imports this file
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
