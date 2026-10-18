/**
 * This deployment's settings, read once from the environment. The only secret
 * is the eBay OAuth client id and secret; it stays in this plugin, which gets
 * no database, Redis or app credential. Pacing and retries are the app's.
 */

/** Kernel default if PORT is absent or blank. */
export const DEFAULT_PORT = 8000;

/** Search budget ceiling, and the budget when a request sends no `budgetMs`; matches the app's 8000 ms fetch budget. */
export const DEFAULT_SEARCH_BUDGET_MS = 8000;

/** Every market this image can serve; the default when EBAY_PLUGIN_MARKETS is unset. */
export const ALL_MARKET_IDS = ["ebay_uk", "ebay_de", "ebay_es", "ebay_fr", "ebay_us"] as const;

export interface Settings {
  port: number;
  /** undefined when absent or blank — never an empty string standing in for "no credential" */
  ebayClientId: string | undefined;
  ebayClientSecret: string | undefined;
  /** /health's `configured`: true only when BOTH halves of the credential are present */
  configured: boolean;
  /** the value EBAY_SEARCH_BUDGET_MS resolves to; see the constant above */
  searchBudgetMs: number;
  /** which of the five ids (ALL_MARKET_IDS) this process declares and serves */
  markets: string[];
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const ebayClientId = blankToUndefined(env.EBAY_CLIENT_ID);
  const ebayClientSecret = blankToUndefined(env.EBAY_CLIENT_SECRET);
  return {
    port: optionalInt(env.PORT) ?? DEFAULT_PORT,
    ebayClientId,
    ebayClientSecret,
    configured: Boolean(ebayClientId && ebayClientSecret),
    searchBudgetMs: optionalInt(env.EBAY_SEARCH_BUDGET_MS) ?? DEFAULT_SEARCH_BUDGET_MS,
    markets: splitMarkets(env.EBAY_PLUGIN_MARKETS),
  };
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Blank counts as absent: compose passes "present but unset" as an empty string. */
function optionalInt(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitMarkets(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [...ALL_MARKET_IDS];
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
