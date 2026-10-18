import { describe, it, expect } from "vitest";
import { PLATFORMS } from "../src/spellings.js";
import { buildEbayQueries, buildEbayQuery, EBAY_QUERY_MAX_LENGTH } from "../src/query.js";

/**
 * eBay Browse keyword search ANDs every word of `q`: a word the seller did
 * not type excludes the listing. Live probes on 2026-09-02 (EBAY_GB, Video
 * Games category, fixed price, GB location):
 *   "The King of Fighters: Heat of Battle Game Boy" -> 0 results
 *   "King of Fighters: Heat of Battle Game Boy"     -> 1 (item 226342839550,
 *     titled "King of Fighters Heat of Battle - Gameboy Game - Cart Only")
 *   "The Smurfs Game Boy" -> 28, "Smurfs Game Boy" -> 526
 *   "The King of Fighters Game Boy" -> 14, "King of Fighters Game Boy" -> 19
 * The canonical IGDB title keeps its article; the query must not. Of those
 * four rows only the second is in the probe fixture (line 117). The article's
 * own cost was measured earlier, in the probes behind the query-recall design
 * (the first and third) and when this rule was introduced (the fourth).
 *
 * A parenthesised, comma-separated group is an OR of contiguous phrases and
 * the platform after it must be its own group of spellings
 * (fixtures/query-probes-2026-09-02.md). Some expected
 * queries below are fixture rows verbatim — the Dr. Mario group (line 90),
 * Belmont's Revenge (104), the two-member KOF group (131), the 156-character
 * Ocarina group (140), the A Link to the Past group (172) and the
 * platform-less Ocarina group (74) — and some are member subsets of one. The
 * rest, including every gbc, NGPC, NES and Dreamcast group and the
 * three-member KOF one, are this builder's output for a game or console the
 * probes never sent: derived from the probed RULES, not measured as strings.
 */
describe("buildEbayQuery", () => {
  const noNames = { alternativeNames: [] as readonly string[] };

  it("drops a leading 'The' so listings titled without the article still match", () => {
    // probe 3, evidence line 131: this exact group finds item 226342839550;
    // the plain query with the article finds nothing (the spec ruling above,
    // not a row in this fixture)
    expect(buildEbayQuery({ title: "The King of Fighters: Heat of Battle", ...noNames }, "gb")).toBe(
      "(King of Fighters: Heat of Battle, Heat of Battle) (Game Boy, Gameboy)",
    );
  });

  it("is case-insensitive about the article and trims the gap it leaves", () => {
    expect(buildEbayQuery({ title: "THE Smurfs", ...noNames }, "gb")).toBe("Smurfs Game Boy");
    expect(buildEbayQuery({ title: "the   Lion King", ...noNames }, "gb")).toBe("Lion King Game Boy");
  });

  it("keeps an inner 'the' and a title that merely starts with 'The' as a prefix of a word", () => {
    // the subtitle keeps its inner "the" and its leading "A" (only "The" is
    // an article the probes proved to cost listings)
    expect(buildEbayQuery({ title: "The Legend of Zelda: A Link to the Past", ...noNames }, "snes")).toBe(
      "(Legend of Zelda: A Link to the Past, A Link to the Past) (SNES, Super Nintendo, Super Famicom)",
    );
    // "Theme Park" is not "The me Park"
    expect(buildEbayQuery({ title: "Theme Park", ...noNames }, "megadrive")).toBe("Theme Park Mega Drive");
  });

  it("never produces an empty core: a title that IS the article stays as typed", () => {
    expect(buildEbayQuery({ title: "The", ...noNames }, "gb")).toBe("The Game Boy");
  });

  it("strips the characters that would split a group from the plain shape too", () => {
    // Group members lose "(", ")" and "," because they would split the group;
    // the plain shape used to send them verbatim. Of the 772 catalog titles,
    // 7 contain one of those characters (measured 2026-09-02) and 2 of them
    // take the plain shape — the Samurai Spirits rows below. A bare
    // parenthesised run behaves like the words inside it (probe 1: "(N64)" ==
    // "N64"), so those two are unaffected in practice; a comma inside one
    // would be read as an OR group the catalog never intended (no title does
    // that today, hence the synthetic third case).
    expect(buildEbayQuery({ title: "Samurai Spirits Zero Special (Fixed)", ...noNames }, "neogeo_aes")).toBe(
      "Samurai Spirits Zero Special Fixed Neo Geo AES",
    );
    // D2: the trailing word used to be PLATFORMS[p].label. For this console
    // that is "NG Pocket Color", UI shorthand no listing carries, and eBay
    // ANDs it word by word — every subtitle-less NGPC game returned 0. The
    // plain path now appends the first seller spelling instead.
    expect(buildEbayQuery({ title: "Samurai Spirits! 2 (Best Collection)", ...noNames }, "neogeo_pocket_color")).toBe(
      "Samurai Spirits! 2 Best Collection Neo Geo Pocket Color",
    );
    expect(buildEbayQuery({ title: "Wario Land 3 (Deluxe, Special)", ...noNames })).toBe(
      "Wario Land 3 Deluxe Special",
    );
  });

  it("strips those characters from a console's spellings too", () => {
    // No console ships such a spelling today; the guard is for the next one
    // added through the README's "Adding a console" procedure, whose
    // sellerSpellings are free text. A comma there would split the platform
    // group and silently change what the query asks for.
    const original = [...PLATFORMS.gb.sellerSpellings];
    PLATFORMS.gb.sellerSpellings = ["Game Boy", "Gameboy (DMG, Pocket)"];
    try {
      expect(buildEbayQuery({ title: "Castlevania II: Belmont's Revenge", ...noNames }, "gb")).toBe(
        "(Castlevania II: Belmont's Revenge, Belmont's Revenge) (Game Boy, Gameboy DMG Pocket)",
      );
    } finally {
      PLATFORMS.gb.sellerSpellings = original;
    }
  });

  it("D1/D2: asks eBay in the console's own spellings, not the UI label and not the detection keywords", () => {
    // D1: the group used to be built from titleKeywords, which for gbc holds
    // only the spaced "game boy color" — evidence line 130 proves a group
    // missing the closed-up spelling silently misses those listings ("(Game
    // Boy)" -> 0 against a "Gameboy" title, "(Game Boy, Gameboy)" -> 1).
    expect(
      buildEbayQuery(
        {
          title: "The Legend of Zelda: Link's Awakening DX",
          alternativeNames: ["Zelda no Densetsu: Yume o Miru Shima DX"],
        },
        "gbc",
      ),
    ).toBe(
      "(Legend of Zelda: Link's Awakening DX, Link's Awakening DX, Zelda no Densetsu: Yume o Miru Shima DX) (Game Boy Color, Gameboy Color, Game Boy Colour, Gameboy Colour, GBC)",
    );
    // D2: the label never reaches eBay; the group is the spellings only.
    // "NeoGeo Pocket Colour" joined the group when the D1 guard in
    // the app repository's packages/shared/test/platforms.test.ts stopped being a tautology and
    // found the British spaced spelling shipping without its closed-up twin.
    expect(buildEbayQuery({ title: "SNK vs. Capcom: Card Fighters Clash", ...noNames }, "neogeo_pocket_color")).toBe(
      "(SNK vs. Capcom: Card Fighters Clash, Card Fighters Clash) (Neo Geo Pocket Color, Neo Geo Pocket Colour, NeoGeo Pocket Color, NeoGeo Pocket Colour, NGPC)",
    );
    // detection keywords stay out of the query: "super nes" is a title
    // keyword snes needs to READ, while the probed group is these three
    expect(buildEbayQuery({ title: "The Legend of Zelda: A Link to the Past", ...noNames }, "snes")).toBe(
      "(Legend of Zelda: A Link to the Past, A Link to the Past) (SNES, Super Nintendo, Super Famicom)",
    );
  });

  it("appends the platform label only when a platform hint is given", () => {
    expect(buildEbayQuery({ title: "Columns", ...noNames })).toBe("Columns");
    expect(buildEbayQuery({ title: "The Smurfs", ...noNames })).toBe("Smurfs");
  });

  describe("subtitle member", () => {
    it("adds the subtitle of a 'Main: Subtitle' title as its own phrase (probe 2a: 0 -> 4 target listings)", () => {
      expect(buildEbayQuery({ title: "Classic NES Series: Dr. Mario", ...noNames }, "gba")).toBe(
        "(Classic NES Series: Dr. Mario, Dr. Mario) (GBA, Game Boy Advance, Gameboy Advance)",
      );
      // probe 2c: +1 genuine listing, no flood
      expect(buildEbayQuery({ title: "Castlevania II: Belmont's Revenge", ...noNames }, "gb")).toBe(
        "(Castlevania II: Belmont's Revenge, Belmont's Revenge) (Game Boy, Gameboy)",
      );
    });

    it("rejects a one-word subtitle: it floods the 50-listing window with other games (probe 2b)", () => {
      expect(buildEbayQuery({ title: "The King of Fighters: Evolution", ...noNames }, "dreamcast")).toBe(
        "King of Fighters: Evolution Dreamcast",
      );
    });

    it("applies the one-word rule after stripping the subtitle's own article (probe 2d: 'Adventure' starved the window)", () => {
      expect(buildEbayQuery({ title: "Castlevania: The Adventure", ...noNames }, "gb")).toBe(
        "Castlevania: The Adventure Game Boy",
      );
    });

    it("strips the article from a multi-word subtitle member", () => {
      expect(buildEbayQuery({ title: "Zelda II: The Adventure of Link", ...noNames }, "nes")).toBe(
        "(Zelda II: The Adventure of Link, Adventure of Link) (NES, Nintendo Entertainment System, Famicom)",
      );
    });

    it("writes a single-spelling platform as a one-member group (probe 2b's '(Dreamcast)')", () => {
      expect(buildEbayQuery({ title: "Resident Evil: Code Veronica", ...noNames }, "dreamcast")).toBe(
        "(Resident Evil: Code Veronica, Code Veronica) (Dreamcast)",
      );
    });

    it("omits the platform group when no hint is given", () => {
      expect(buildEbayQuery({ title: "The Legend of Zelda: Ocarina of Time", ...noNames })).toBe(
        "(Legend of Zelda: Ocarina of Time, Ocarina of Time)",
      );
    });
  });

  describe("alternative names", () => {
    it("adds Latin-script names of at least two words and ignores the title row, non-Latin and one-word names", () => {
      // The expected string is the three-member superset of two probed rows,
      // not a row itself: line 134, "(King of Fighters: Heat of Battle,
      // Nettou The King of Fighters '96) (Game Boy, Gameboy)" -> 1, and line
      // 131, the same with the subtitle member instead -> 1. A group is an OR
      // (fact 1), so the superset is expected to find that listing too; the
      // exact string was never sent. probe 5: a non-Latin member never
      // matches, so it is left out
      expect(
        buildEbayQuery(
          {
            title: "The King of Fighters: Heat of Battle",
            alternativeNames: [
              "The King of Fighters: Heat of Battle",
              "Nettou The King of Fighters '96",
              "拳皇96",
              "KOF",
            ],
          },
          "gb",
        ),
      ).toBe("(King of Fighters: Heat of Battle, Heat of Battle, Nettou The King of Fighters '96) (Game Boy, Gameboy)");
    });

    it("rejects a name with any non-Latin letter, accented Latin stays", () => {
      expect(
        buildEbayQueries(
          {
            title: "Pokémon Red Version",
            alternativeNames: ["ポケットモンスター 赤", "Pokémon Rojo", "Zelda 時のオカリナ", "Покемон Ред"],
          },
          "gb",
        ),
        // one surviving name, so the second query takes the plain shape (D3)
      ).toEqual(["Pokémon Red Version Game Boy", "Pokémon Rojo Game Boy"]);
    });

    it("deduplicates after normalisation against the title, the subtitle and each other", () => {
      expect(
        buildEbayQuery(
          {
            title: "The Legend of Zelda: Ocarina of Time",
            alternativeNames: [
              "Legend of Zelda: Ocarina of Time",
              "legend of zelda ocarina of time",
              "Ocarina of Time",
              "OCARINA OF TIME",
              "Zelda 64",
              "zelda-64",
            ],
          },
          "n64",
        ),
      ).toBe("(Legend of Zelda: Ocarina of Time, Ocarina of Time, Zelda 64) (N64, Nintendo 64)");
    });

    it("D6: keeps every eligible name that fits, in catalog order", () => {
      // Was: at most three names, preferring those sharing the FEWEST words
      // with the title. That rule evicted the names the probes proved
      // valuable. On the dev catalog (772 games, read 2026-09-02) 89 games
      // have more than three eligible names, and this very game was one of
      // the worst: it kept an acronym name and "Zelda Chuanshuo Shiguang Zhi
      // Di" — the two classes evidence finding 8 lists as INERT, its own
      // entries being "TLoZ: Ocarina of Time" and that Chinese title — and
      // dropped "Zelda no Densetsu: Toki no Ocarina" (the Japanese-title
      // class finding 8 says pays, +2 for A Link to the Past) and "Zelda 64"
      // (a probed member). The acronym is not quoted as the catalog spells
      // it, because that string is not in the fixture.
      // The evidence file predicted it: "the 'fewest shared words'
      // preference tends to pick inert acronym or foreign-language names ...
      // over useful ones". Nothing measured ranks alternative names, so
      // nothing ranks them here; the binding limit is the probed length.
      expect(
        buildEbayQuery(
          {
            title: "The Legend of Zelda: Ocarina of Time",
            alternativeNames: [
              "Zelda no Densetsu: Toki no Ocarina",
              "Toki no Ocarina",
              "Zelda 64",
              "TLoZ: Ocarina of Time",
            ],
          },
          "n64",
        ),
      ).toBe(
        "(Legend of Zelda: Ocarina of Time, Ocarina of Time, Zelda no Densetsu: Toki no Ocarina, Toki no Ocarina, Zelda 64, TLoZ: Ocarina of Time) (N64, Nintendo 64)",
      );
    });

    it("D6: a fourth and fifth name are not dropped just for being fourth and fifth", () => {
      // probe 4 sent groups of 6, ~11 and ~17 members (156, 294 and 510
      // characters): all HTTP 200, totals 185/184/185, target in the window.
      // Members beyond three neither break the query nor flood it.
      // no colon, so the names travel in the second query (probe 7)
      const [, names] = buildEbayQueries(
        {
          title: "Pokémon Red Version",
          alternativeNames: ["Pokemon Red", "Pocket Monsters Red", "Pokémon Rojo", "Pokémon Rouge", "Pokémon Rot"],
        },
        "gb",
      );
      // finding 8: "Pocket Monsters Red" (+1) and the unaccented "Pokemon
      // Red" (+9) are the two that pay; both used to be evicted
      expect(names).toBe(
        "(Pokemon Red, Pocket Monsters Red, Pokémon Rojo, Pokémon Rouge, Pokémon Rot) (Game Boy, Gameboy)",
      );
      expect(names.length).toBeLessThanOrEqual(EBAY_QUERY_MAX_LENGTH);
    });

    it("strips a name's leading article and the characters that would break the group", () => {
      expect(
        buildEbayQuery(
          {
            title: "Mega Man: Dr. Wily's Revenge",
            alternativeNames: ["The Rockman World", "Rockman, World (Game Boy)"],
          },
          "gb",
        ),
      ).toBe("(Mega Man: Dr. Wily's Revenge, Dr. Wily's Revenge, Rockman World, Rockman World Game Boy) (Game Boy, Gameboy)");
    });

    it("drops members from the end, never the title, when the query would exceed the proven length", () => {
      // 510 characters returned HTTP 200 with the target in the window (probe 4)
      expect(EBAY_QUERY_MAX_LENGTH).toBe(510);
      const longName = (word: string) => Array.from({ length: 40 }, (_, i) => `${word}${i}`).join(" ");
      const alternativeNames = [longName("alpha"), longName("beta"), longName("gamma")];
      const query = buildEbayQuery({ title: "The Legend of Zelda: Ocarina of Time", alternativeNames }, "n64");
      expect(query.length).toBeLessThanOrEqual(EBAY_QUERY_MAX_LENGTH);
      expect(query.startsWith("(Legend of Zelda: Ocarina of Time, Ocarina of Time, alpha0 ")).toBe(true);
      expect(query).not.toContain("gamma0");
      expect(query.endsWith(") (N64, Nintendo 64)")).toBe(true);

      // a title that alone exceeds the cap is still sent: dropping the
      // subtitle leaves one member, so the query falls back to the plain shape
      const hugeTitle = `${longName("word")} ${longName("more")}: ${longName("sub")}`;
      const kept = buildEbayQuery({ title: hugeTitle, alternativeNames: [] }, "n64");
      expect(kept).toBe(`${hugeTitle} N64`);
      expect(kept.length).toBeGreaterThan(EBAY_QUERY_MAX_LENGTH);
    });
  });
});

describe("buildEbayQueries", () => {
  it("sends one plain query for a title without a subtitle member or alternative names", () => {
    expect(buildEbayQueries({ title: "Mario Kart 64", alternativeNames: [] }, "n64")).toEqual(["Mario Kart 64 N64"]);
  });

  it("sends one group query when the title has a subtitle member, alternative names included", () => {
    expect(
      buildEbayQueries(
        {
          title: "The Legend of Zelda: A Link to the Past",
          alternativeNames: ["Zelda 3", "Zelda III", "Zelda no Densetsu: Kamigami no Triforce"],
        },
        "snes",
      ),
    ).toEqual([
      // probe 6b: gained 6 genuine listings, lost none
      "(Legend of Zelda: A Link to the Past, A Link to the Past, Zelda 3, Zelda III, Zelda no Densetsu: Kamigami no Triforce) (SNES, Super Nintendo, Super Famicom)",
    ]);
  });

  it("keeps the plain query and adds a second, alternative-names query for a title without a subtitle member (probe 7)", () => {
    // "(Mario Kart 64, Super Mario Kart R) (N64, Nintendo 64)" as ONE query
    // lost 5 genuine listings the plain query finds: the title member is a
    // phrase. The plain query stays; the names go in a call of their own.
    // D3: the one-name second query used to be "<name> (<spellings>)", which
    // a code comment called probed by citing "King of Fighters: Heat of
    // Battle (Game Boy, Gameboy)" — a row that is not in the fixture. Two
    // probed rows do have that structure, plain words then a parenthesised
    // group, and both return 0: line 129, `Game Boy (King of Fighters: Heat
    // of Battle, Heat of Battle)`, where the same content as group + group ->
    // 1; and line 150, probe 5's non-Latin name in front of `(Game Boy,
    // Gameboy)`, whose zero the fixture attributes to the member rather than
    // to the shape — so line 129 is the load-bearing row. A single member
    // therefore falls back to the plain shape, which line 121 does measure:
    // `Heat of Battle Game Boy` -> 1, target found.
    expect(buildEbayQueries({ title: "Mario Kart 64", alternativeNames: ["Super Mario Kart R"] }, "n64")).toEqual([
      "Mario Kart 64 N64",
      "Super Mario Kart R N64",
    ]);
    expect(
      buildEbayQueries({ title: "Pokémon Red Version", alternativeNames: ["Pokemon Red", "Pocket Monsters Red"] }, "gb"),
    ).toEqual(["Pokémon Red Version Game Boy", "(Pokemon Red, Pocket Monsters Red) (Game Boy, Gameboy)"]);
  });

  it("adds no second query when every alternative name is filtered out", () => {
    expect(buildEbayQueries({ title: "Mario Kart 64", alternativeNames: ["Mario Kart 64", "MK64", "マリオカート64"] }, "n64")).toEqual([
      "Mario Kart 64 N64",
    ]);
  });

  it("omits the platform group from the second query when no hint is given", () => {
    expect(buildEbayQueries({ title: "Mario Kart 64", alternativeNames: ["Super Mario Kart R", "Mario Kart R"] })).toEqual([
      "Mario Kart 64",
      "(Super Mario Kart R, Mario Kart R)",
    ]);
  });

  it("caps the second query at the proven length too", () => {
    const longName = (word: string) => Array.from({ length: 40 }, (_, i) => `${word}${i}`).join(" ");
    const [, second] = buildEbayQueries(
      { title: "Mario Kart 64", alternativeNames: [longName("alpha"), longName("beta"), longName("gamma")] },
      "n64",
    );
    expect(second.length).toBeLessThanOrEqual(EBAY_QUERY_MAX_LENGTH);
    // only the first name fits: one member, so the plain "<name> <spelling>"
    // shape (D3 — a lone member never travels in front of a group)
    expect(second.startsWith("alpha0 ")).toBe(true);
    expect(second.endsWith(" N64")).toBe(true);
    expect(second).not.toContain("beta0");
    expect(second).not.toContain("gamma0");
  });
});

/**
 * The equivalence this pins: in
 * production every call carries the app's `spelling=` parameters
 * (in the app repository, apps/api/src/adapters/sidecar/index.ts sends
 * `PLATFORMS[platformHint].sellerSpellings` verbatim, one per parameter,
 * whenever a platform hint is given), while every platform-hinted assertion
 * above calls `buildEbayQueries`/`buildEbayQuery` with a bare platform id and
 * no `wireSpellings` — the local-table FALLBACK path (see query.ts's own
 * `platformSpellings` doc comment for which of the two is authoritative and
 * why the fallback exists at all; a few assertions above pass no platform
 * hint at all and never reach that function either way). Left unchecked,
 * every one of those platform-hinted assertions would pin a branch
 * production never runs. These prove the two paths agree byte for byte when
 * fed the same spellings, and that order — the wire list's own order, which
 * this builder never re-sorts — is what decides the platform group's text
 * and, for a subtitle-less title, the plain query's trailing word (D2,
 * see `plainQuery` in ../src/query.ts).
 */
describe("wire-supplied spelling= parameters against the local table", () => {
  it("gbc: five members, produces the identical group query as the local table, in the table's own order", () => {
    // The same game and expectation query.test.ts:102-117 (this file's
    // moved copy above) pins from the local-table path.
    const game = {
      title: "The Legend of Zelda: Link's Awakening DX",
      alternativeNames: ["Zelda no Densetsu: Yume o Miru Shima DX"],
    };
    const expected =
      "(Legend of Zelda: Link's Awakening DX, Link's Awakening DX, Zelda no Densetsu: Yume o Miru Shima DX) (Game Boy Color, Gameboy Color, Game Boy Colour, Gameboy Colour, GBC)";
    const bare = buildEbayQuery(game, "gbc");
    const wired = buildEbayQuery(game, "gbc", PLATFORMS.gbc.sellerSpellings);
    expect(bare).toBe(expected);
    expect(wired).toBe(expected);
  });

  it("a reordered wire list changes the group text: order is honoured, not re-sorted", () => {
    const game = {
      title: "The Legend of Zelda: Link's Awakening DX",
      alternativeNames: ["Zelda no Densetsu: Yume o Miru Shima DX"],
    };
    const reversed = [...PLATFORMS.gbc.sellerSpellings].reverse();
    const wired = buildEbayQuery(game, "gbc", reversed);
    expect(wired).not.toBe(buildEbayQuery(game, "gbc"));
    expect(wired.endsWith("(GBC, Gameboy Colour, Game Boy Colour, Gameboy Color, Game Boy Color)")).toBe(true);
  });

  it("a reordered wire list also changes the plain query's trailing word (D2), for a subtitle-less title", () => {
    // plainQuery in ../src/query.ts (D2): the trailing word IS
    // platformSpellings(...)[0], so this is the case the plan calls out as
    // "silently changes what a subtitle-less title asks eBay for" if the
    // wire ever arrives reordered.
    const game = { title: "Pokemon Pinball", alternativeNames: [] as readonly string[] };
    expect(buildEbayQuery(game, "gbc")).toBe("Pokemon Pinball Game Boy Color");
    const reversed = [...PLATFORMS.gbc.sellerSpellings].reverse();
    expect(buildEbayQuery(game, "gbc", reversed)).toBe("Pokemon Pinball GBC");
  });

  it("a spelling carrying a comma and a parenthesis is sanitised identically whether it came off the wire or the local table", () => {
    // Same shape as the local-table guard above (query.test.ts:86-100 in this
    // file's moved copy): a console's own sellerSpellings are free text, so a
    // wire-carried comma or parenthesis must not survive into the query
    // either — the app sends the wire list RAW off sellerSpellings, so this
    // package is now the only place that can sanitise it.
    const mutated = ["Game Boy", "Gameboy (DMG, Pocket)"];
    const game = { title: "Castlevania II: Belmont's Revenge", alternativeNames: [] as readonly string[] };

    const original = [...PLATFORMS.gb.sellerSpellings];
    PLATFORMS.gb.sellerSpellings = mutated;
    let local: string;
    try {
      local = buildEbayQuery(game, "gb");
    } finally {
      PLATFORMS.gb.sellerSpellings = original;
    }
    // PLATFORMS.gb is back to its real spellings here; `mutated` is passed as
    // the wire list directly, unsanitised, exactly as the app would send it.
    const wired = buildEbayQuery(game, "gb", mutated);
    expect(local).toBe("(Castlevania II: Belmont's Revenge, Belmont's Revenge) (Game Boy, Gameboy DMG Pocket)");
    expect(wired).toBe(local);
  });

  it("an empty wire list is treated as absent: falls back to the local table rather than an empty group", () => {
    // Production never sends `spelling=` with no values (the app only adds
    // the parameter when platformHint is set, and every platform's
    // sellerSpellings is non-empty) — this guards a defensive read, not a
    // reachable production case.
    const game = { title: "Mario Kart 64", alternativeNames: [] as readonly string[] };
    expect(buildEbayQuery(game, "n64", [])).toBe(buildEbayQuery(game, "n64"));
  });

  it("a wire list that sanitises to nothing is treated as absent too, not as an empty member", () => {
    // Measured 2026-09-05: memberText strips "(", ")" and "," entirely, so a
    // spelling made only of those characters becomes "". Left unfiltered
    // that blank string would land inside the group ("(..., )") or, on the
    // plain-query path, become the trailing word with nothing after it
    // ("Mario Kart 64 " — not "Mario Kart 64 N64"). Neither shape was ever
    // probed; falling back to the local table is the same "treat as absent"
    // rule the empty-array case above already guards.
    const game = { title: "Mario Kart 64", alternativeNames: [] as readonly string[] };
    expect(buildEbayQuery(game, "n64", [",", "()"])).toBe(buildEbayQuery(game, "n64"));
  });

  it("a wire list with some blank-after-sanitising entries drops only those, not the whole list", () => {
    // A comma-only entry mixed in with two real spellings must not survive
    // as an empty OR-group member — it is filtered out, and the real entries
    // are used exactly as sent, unpadded.
    const game = { title: "Mario Kart 64", alternativeNames: [] as readonly string[] };
    expect(buildEbayQuery(game, "n64", ["N64", ",", "Nintendo 64"])).toBe(
      buildEbayQuery(game, "n64", ["N64", "Nintendo 64"]),
    );
  });
});
