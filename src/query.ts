import { PLATFORMS, type Platform } from "./spellings.js";

/**
 * Only "The" is stripped: the live probes proved it costs listings; "A"/"An"
 * have no evidence either way.
 */
const LEADING_ARTICLE = /^the\s+/i;

/**
 * Longest OR query the live probes proved safe (156, 294 and 510 chars all
 * returned the target, fixtures/query-probes-2026-09-02.md probe 4).
 */
export const EBAY_QUERY_MAX_LENGTH = 510;

/** A member of fewer words floods the 50-listing window with other games (probes 2b, 2d). */
const MIN_MEMBER_WORDS = 2;

export interface EbayQueryGame {
  title: string;
  /** the catalog's other names for the game (game_names rows); the title itself may be among them */
  alternativeNames: readonly string[];
}

/**
 * The keyword queries sent to eBay Browse for a catalog game, primary first.
 * Every fact below is a row in fixtures/query-probes-2026-09-02.md.
 *
 * - A plain `q` ANDs every word, so a word the seller did not type excludes
 *   the listing; sellers often drop "The", so it is stripped.
 * - `(m1, m2, ...)` ORs its members, each a CONTIGUOUS PHRASE. The title alone
 *   as a phrase loses listings; the subtitle phrase restores them.
 * - After a group the platform must be its own group of seller spellings:
 *   "(...) Game Boy" 0, "(...) (Game Boy, Gameboy)" 1.
 * - A one-word member starves the window, so members need two words. Non-Latin
 *   names are excluded; commas and parentheses are removed everywhere.
 *
 * Shapes:
 * - one member: plain `<title> <first seller spelling>`;
 * - title + subtitle (+ names): ONE group query `(<members>) (<spellings>)`;
 * - names but no subtitle: the plain query plus a SECOND query for the names
 *   (the one-group form lost listings, probe 7). Never `<name> (<spellings>)`:
 *   plain words before a group return 0 (line 129). The second call is
 *   best-effort and merged by item id.
 *
 * The matcher still verifies every returned title, so widening the query can
 * only add candidates, never mis-attribute them.
 */
export function buildEbayQueries(
  game: EbayQueryGame,
  platformHint?: Platform,
  wireSpellings?: readonly string[],
): string[] {
  const platformGroup = platformHint ? ` (${platformSpellings(platformHint, wireSpellings).join(", ")})` : "";
  const title = titleMember(game.title);
  const subtitle = subtitleMember(game.title);
  const names = alternativeNameMembers(game.alternativeNames, subtitle === null ? [title] : [title, subtitle]);
  if (subtitle !== null) {
    const kept = fitToLength([title, subtitle, ...names], platformGroup);
    // the cap can leave the title alone: one member takes the plain shape
    return [kept.length === 1 ? plainQuery(game.title, platformHint, wireSpellings) : groupText(kept, platformGroup)];
  }
  const primary = plainQuery(game.title, platformHint, wireSpellings);
  if (names.length === 0) return [primary];
  const kept = fitToLength(names, platformGroup);
  // One name takes the plain shape (line 121 -> 1); `<name> (<spellings>)` returns 0 (line 129).
  return [
    primary,
    kept.length === 1 ? plainQuery(kept[0], platformHint, wireSpellings) : groupText(kept, platformGroup),
  ];
}

/** The primary query alone: the first of buildEbayQueries. */
export function buildEbayQuery(game: EbayQueryGame, platformHint?: Platform, wireSpellings?: readonly string[]): string {
  return buildEbayQueries(game, platformHint, wireSpellings)[0];
}

/**
 * The sanitised title, then the FIRST seller spelling (not the UI label: eBay
 * ANDs every word, and a label no seller types, like "NG Pocket Color", returns 0).
 */
function plainQuery(title: string, platformHint?: Platform, wireSpellings?: readonly string[]): string {
  const core = titleMember(title);
  return platformHint ? `${core} ${platformSpellings(platformHint, wireSpellings)[0]}` : core;
}

function groupText(members: readonly string[], platformGroup: string): string {
  return `(${members.join(", ")})${platformGroup}`;
}

/** Drops members from the END (never the first) until the group query fits EBAY_QUERY_MAX_LENGTH. */
function fitToLength(members: readonly string[], platformGroup: string): string[] {
  const kept = [...members];
  while (kept.length > 1 && groupText(kept, platformGroup).length > EBAY_QUERY_MAX_LENGTH) kept.pop();
  return kept;
}

/**
 * Seller spellings, sanitised, in table order. The app's `spelling=`
 * parameters are authoritative; the local PLATFORMS table is the fallback when
 * none are sent. Sanitising can empty a spelling (e.g. ","), and an empty
 * member was never probed, so blanks are dropped; if every wire entry is blank
 * the local table is used.
 *
 * Not probed: casing (cosmetic as observed) and the "&" in Game & Watch's
 * spellings, kept because it is the console's own name.
 */
function platformSpellings(platform: Platform, wireSpellings?: readonly string[]): string[] {
  const wireCleaned = (wireSpellings ?? []).map((spelling) => memberText(spelling)).filter((spelling) => spelling.length > 0);
  if (wireCleaned.length > 0) return wireCleaned;
  return PLATFORMS[platform].sellerSpellings.map((spelling) => memberText(spelling));
}

function titleMember(title: string): string {
  const member = memberText(title);
  return member.length > 0 ? member : title.trim();
}

/** The subtitle of a `Main: Subtitle` title, when it has enough words after its article. */
function subtitleMember(title: string): string | null {
  const colon = title.indexOf(":");
  if (colon <= 0) return null;
  const main = title.slice(0, colon).trim();
  const subtitle = memberText(title.slice(colon + 1));
  if (main.length === 0 || wordCount(subtitle) < MIN_MEMBER_WORDS) return null;
  return subtitle;
}

/**
 * Every Latin-script name of at least two words that is not, after
 * normalisation, the title, the subtitle or another name — in catalog order.
 * Nothing measured ranks alternative names, so none are ranked or capped;
 * only the proven length limit (fitToLength) drops any.
 */
function alternativeNameMembers(names: readonly string[], taken: readonly string[]): string[] {
  const seen = new Set(taken.map(normalize));
  const members: string[] = [];
  for (const name of names) {
    if (!isLatinScript(name)) continue;
    const member = memberText(name);
    if (wordCount(member) < MIN_MEMBER_WORDS) continue;
    const key = normalize(member);
    if (seen.has(key)) continue;
    seen.add(key);
    members.push(member);
  }
  return members;
}

/** Article stripped, group-breaking characters removed, whitespace collapsed. */
function memberText(text: string): string {
  return text
    .trim()
    .replace(LEADING_ARTICLE, "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text.length === 0 ? 0 : text.split(" ").length;
}

/**
 * Case- and punctuation-insensitive dedupe key. Accents are kept, so
 * "Pokémon Red" and "Pokemon Red" stay two members (probe 7 lost accented
 * listings to an unaccented member).
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Every letter is Latin; digits and punctuation do not count. */
function isLatinScript(text: string): boolean {
  return !/[^\P{L}\p{Script=Latin}]/u.test(text);
}
