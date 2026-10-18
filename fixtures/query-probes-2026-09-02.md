# eBay Browse keyword-query probes — 2026-09-02

Live evidence for the query-recall design (how a title becomes an eBay
keyword query). Every row is
one real `item_summary/search` call made with the app's own production keys
through `apps/api/scripts/ebay-query-probe.ts`, with the adapter's exact
request: marketplace `EBAY_GB`, `category_ids=139973`,
`filter=itemLocationCountry:GB,buyingOptions:{FIXED_PRICE}`, `sort=price`,
`limit=50`. "Window" is the 50 listings the adapter reads (eBay orders them by
price + postage, so a displayed price is not strictly monotonic). "Target" is
the legacy id the probe looked for in the window; "n/a" means the probe
counted titles instead. Window composition was judged by eye on the returned
titles, helped by the script's `--match` regex; "non-game" counts listings the
adapter's `isNonGameListing` drops (manuals, boxes, magazines). Session
budget: 55 search calls over 17 script runs (one token call each).

## Verified facts (what the queries actually do)

1. **A parenthesised, comma-separated group is an OR of its members.**
   `(King of Fighters Heat of Battle, Zelda) (Game Boy, Gameboy)` → 319 hits
   (the one Heat of Battle listing plus every Zelda Game Boy listing) where
   the Heat of Battle member alone gives 1.
2. **Whatever follows a group is ANDed with it.** `(Legend of Zelda: Ocarina
   of Time, Ocarina of Time) zzqxv` → 0; a trailing platform group narrows,
   never widens (319 above, not tens of thousands).
3. **A group member is matched as a contiguous phrase, not as a bag of
   words.** `(Legend of Zelda: Ocarina of Time, Zelda 64) (N64)` → 108, below
   the plain word query `Legend of Zelda: Ocarina of Time N64` → 137, and its
   window drops every title that lacks the contiguous phrase ("n64 zelda
   ocarina of time", "Zelda Ocarina of Time N64 Game PAL Cartridge Only…").
   The plain query matches those through individual words (and, for words
   absent from the title, apparently through item specifics). Adding the
   subtitle phrase brings them back: `(…, Ocarina of Time) (N64)` → 138.
   A colon or an apostrophe inside a member is harmless (probe 3).
4. **After a group, the platform must itself be a group of the spellings
   sellers use.** `(…) Game Boy` → 0, `Game Boy (…)` → 0, `(…) (Game Boy)` →
   0, `(…) (Game Boy, Gameboy)` → 1 for a listing titled "…Gameboy Game…".
   The plain shape `King of Fighters: Heat of Battle Game Boy` did find that
   listing, so the spec's "Game Boy already matches Gameboy" holds for the
   plain shape only. A single-token platform works either way (`(…) N64` and
   `(…) (N64)` both 108); adding the long spelling adds recall (`(N64,
   Nintendo 64)` → 147; `Super Famicom` brought Japanese ALttP carts).
5. **No length limit found.** OR queries of 156, 294 and 510 characters all
   returned HTTP 200, totals 185/184/185, target in the window.
6. **Non-Latin members are inert.** `拳皇96 (Game Boy, Gameboy)` → 0; as a
   member they neither add nor break anything (probe 5). Excluding them is
   query hygiene, not a correctness need.
7. **A one-word member starves the target.** `(Castlevania: The Adventure,
   Adventure) (Game Boy, Gameboy)` → 446 hits, 0 of the 50 cheapest are
   Castlevania. `(King of Fighters: Evolution, Evolution) (Dreamcast)` adds
   11 foreign listings and 0 target ones. Two-word subtitles ("Dr. Mario",
   "Belmont's Revenge", "The Adventure" with its article) did not flood.
8. **Alternative names that pay are the Japanese titles sellers really type
   and spelling variants**: "Rockman World" (+2 genuine, +4 numbered siblings
   the matcher's numeral cap rejects), "Zelda no Densetsu: Kamigami no
   Triforce" (+2), "Pocket Monsters Red" (+1), the unaccented "Pokemon Red"
   (+9). Inert but harmless: "Nettou King of Fighters 96" (no listing exists
   today), "Megaman GB", "Super Mario Kart R", "TLoZ: Ocarina of Time",
   "Zelda Chuanshuo Shiguang Zhi Di".
9. **A group without a subtitle member loses listings the plain query finds**
   (probe 7): Mario Kart 64 lost 5 genuine listings titled "Mario Kart N64",
   "N64 MARIO KART GAME…"; Pokémon Red lost 3 genuine accented "Pokémon Red"
   listings without "Version" while gaining 10. With a subtitle member
   (probes 1, 2c, 6a–6c) no genuine listing was lost in any window.

## Probe 1 — group + plain platform word (The Legend of Zelda: Ocarina of Time, n64)

| query | total | returned | target | window composition | note |
| --- | ---: | ---: | --- | --- | --- |
| `Legend of Zelda: Ocarina of Time N64` | 137 | 50 | n/a | 48 Ocarina (6 non-game: 4 magazine/tips books, 1 case only, 1 with manual), 2 N64 bundle listings | today's query |
| `(Legend of Zelda: Ocarina of Time, Ocarina of Time) N64` | 137 | 50 | n/a | identical window | group + single-token platform |
| `Ocarina of Time N64` | 137 | 50 | n/a | identical window | subtitle words alone |
| `Zelda Ocarina of Time N64` | 138 | 50 | n/a | 48 Ocarina, 2 bundles | the ruling's example shape |
| `(Legend of Zelda: Ocarina of Time, Ocarina of Time)` | 403 | 50 | n/a | 49 Ocarina by title, but mostly the 3DS "Ocarina of Time 3D" | no platform: another platform floods |
| `(Legend of Zelda: Ocarina of Time, Ocarina of Time) zzqxv` | 0 | 0 | n/a | — | the trailing word is ANDed |
| `Zelda 64 N64` | 200 | 50 | n/a | 38 Ocarina; Majora's Mask x4, F-1 World Grand Prix x3, Nagano 64, a Zelda manual, bundles | word-AND is broad |
| `(Ocarina of Time, Zelda 64) N64` | 138 | 50 | n/a | 48 Ocarina, 2 bundles | not the union of 137 and 200 |
| `(Legend of Zelda: Ocarina of Time, Zelda 64) N64` | 108 | 50 | n/a | 49 Ocarina, 1 bundle; every title without the contiguous "Legend of Zelda(:) Ocarina of Time" is gone | phrase semantics |
| `(Legend of Zelda: Ocarina of Time, Zelda 64) (N64)` | 108 | 50 | n/a | same window as the previous row | `(N64)` ≡ `N64` |
| `(Legend of Zelda: Ocarina of Time, Zelda 64) (N64, Nintendo 64)` | 147 | 50 | n/a | 49 Ocarina (5 non-game), 1 bundle; adds "Nintendo 64"-only titles and one mis-titled 3DS cart | platform spelling adds 39 |
| `(Legend of Zelda: Ocarina of Time, Ocarina of Time) (N64)` | 138 | 50 | n/a | the plain window's titles are back (48 Ocarina, 6 non-game, 2 bundles) | subtitle phrase restores recall |

## Probe 2 — subtitle-only members

### 2a generic two-word subtitle (Classic NES Series: Dr. Mario, gba)

| query | total | returned | target | window composition | note |
| --- | ---: | ---: | --- | --- | --- |
| `Classic NES Series: Dr. Mario GBA` | 0 | 0 | n/a | — | today's query finds nothing: sellers write "NES Classics" |
| `(Classic NES Series: Dr. Mario, Dr. Mario) (GBA, Game Boy Advance, Gameboy Advance)` | 12 | 12 | n/a | 4 target ("Nes Classics Dr Mario…", "Dr Mario gba game nes classic…", "Dr Mario NES Classics…", "DR.Mario NES Classics New & Sealed"); 8 other: 3 Game Boy Dr Mario carts mentioning GBA, Dr. Mario & Panel de Pon x2, Dr. Mario & Puzzle League x2 (one a poster bundle, non-game), 2 pick-a-game listings | no flood; from 0 to 4 |

### 2b one-word subtitle (The King of Fighters: Evolution, dreamcast)

| query | total | returned | target | window composition | note |
| --- | ---: | ---: | --- | --- | --- |
| `King of Fighters: Evolution Dreamcast` | 8 | 8 | n/a | 8 target (all Japanese "King of Fighters '99 Evolution") | today's query |
| `(King of Fighters: Evolution, Evolution) (Dreamcast)` | 19 | 19 | n/a | the same 8 target + 11 other games (Evolution, Evolution 2, Evolution: The World of Sacred Device, ECW Hardcore Evolution) | one-word member: 0 gain, 11 foreign |

### 2c two-word subtitle (Castlevania II: Belmont's Revenge, gb)

| query | total | returned | target | window composition | note |
| --- | ---: | ---: | --- | --- | --- |
| `Castlevania II: Belmont's Revenge Game Boy` | 7 | 7 | n/a | 5 target (1 manual only), 1 pick-a-game, 1 rare-games bundle | today's query |
| `(Castlevania II: Belmont's Revenge, Belmont's Revenge) (Game Boy, Gameboy)` | 7 | 7 | n/a | 6 target (+ "Castlevania 2 Belmont's Revenge Game Boy Nintendo Cartridge Tested & Working"), 1 pick-a-game | +1 genuine, no flood |

### 2d subtitle that becomes one word after article stripping (Castlevania: The Adventure, gb)

| query | total | returned | target | window composition | note |
| --- | ---: | ---: | --- | --- | --- |
| `(Castlevania: The Adventure, Adventure) (Game Boy, Gameboy)` | 446 | 50 | n/a | 0 Castlevania; the window is Tweety's High-Flying Adventure, Spyro Adventure, Pinobee, Finding Nemo… at £3–7 | complete starvation |
| `(Castlevania: The Adventure, The Adventure) (Game Boy, Gameboy)` | 24 | 24 | n/a | 10 Castlevania; 14 other (Zelda II: The Adventure of Link x9, Jimmy Neutron x2, Lego Indiana Jones 2, a pick-a-game, a Zelda bundle) | the article keeps the phrase specific; still 0 gain over the title phrase is unproven (no plain baseline run) |

## Probe 3 — alt-name member and group shapes (The King of Fighters: Heat of Battle, gb, target 226342839550 "King of Fighters Heat of Battle - Gameboy Game - Cart Only")

| query | total | returned | target | note |
| --- | ---: | ---: | --- | --- |
| `King of Fighters: Heat of Battle Game Boy` | 1 | 1 | YES | today's query |
| `(King of Fighters: Heat of Battle, Heat of Battle, Nettou King of Fighters 96) Game Boy` | 0 | 0 | no | group + trailing two-word label |
| `(King of Fighters: Heat of Battle, Heat of Battle, Nettou The King of Fighters '96) Game Boy` | 0 | 0 | no | alt name verbatim, same failure |
| `Nettou King of Fighters 96 Game Boy` | 0 | 0 | no | no Japanese-import listing exists today |
| `Heat of Battle Game Boy` | 1 | 1 | YES | the subtitle words alone find it |
| `(King of Fighters: Heat of Battle, Heat of Battle) Game Boy` | 0 | 0 | no | two members, colon kept |
| `(King of Fighters Heat of Battle, Heat of Battle) Game Boy` | 0 | 0 | no | colon removed: not the cause |
| `(King of Fighters Heat of Battle, Heat of Battle, Nettou King of Fighters 96) Game Boy` | 0 | 0 | no | |
| `(King of Fighters Heat of Battle, Nettou King of Fighters 96) Game Boy` | 0 | 0 | no | |
| `(King of Fighters Heat of Battle, Nettou King of Fighters 96) (Game Boy, Gameboy)` | 1 | 1 | YES | the spec's verified shape, reconfirmed |
| `(Heat of Battle, King of Fighters: Heat of Battle) Game Boy` | 0 | 0 | no | member order irrelevant |
| `(King of Fighters: Heat of Battle, Nettou King of Fighters 96) Game Boy` | 0 | 0 | no | |
| `Game Boy (King of Fighters: Heat of Battle, Heat of Battle)` | 0 | 0 | no | plain label before the group |
| `(King of Fighters: Heat of Battle, Heat of Battle) (Game Boy)` | 0 | 0 | no | single-spelling platform group: the phrase "Game Boy" does not match "Gameboy" |
| `(King of Fighters: Heat of Battle, Heat of Battle) (Game Boy, Gameboy)` | 1 | 1 | YES | colon inside a member is fine |
| `(King of Fighters Heat of Battle, Zelda) (Game Boy, Gameboy)` | 319 | 50 | no | OR proven; the target is starved by 318 cheaper Zelda listings (0 of 50 in the window) |
| `(Heat of Battle, Nettou King of Fighters 96) (Game Boy, Gameboy)` | 1 | 1 | YES | the subtitle member alone carries the listing |
| `(King of Fighters: Heat of Battle, Nettou The King of Fighters '96) (Game Boy, Gameboy)` | 1 | 1 | YES | apostrophe and colon inside members are fine |

## Probe 4 — length (Ocarina of Time, target 157850366777 "n64 zelda ocarina of time", found through the subtitle phrase)

| chars | query | total | returned | target | window |
| ---: | --- | ---: | ---: | --- | --- |
| 156 | `(Legend of Zelda: Ocarina of Time, Ocarina of Time, Zelda no Densetsu: Toki no Ocarina, Toki no Ocarina, Zelda 64, TLoZ: Ocarina of Time) (N64, Nintendo 64)` | 185 | 50 | YES | 49 Ocarina (7 non-game), 1 bundle |
| 294 | the 156-char query with `, Zelda Chuanshuo Shiguang Zhi Di, Legend of Zelda Ocarina of Time Nintendo 64, Zelda Ocarina of Time, The Legend of Zelda Ocarina of Time` appended inside the group | 184 | 50 | YES | 49 Ocarina, 1 bundle |
| 510 | the 294-char query with `, Zelda no Densetsu Toki no Ocarina N64, Ocarina of Time N64 PAL, Legend of Zelda Ocarina of Time PAL, Ocarina of Time Nintendo 64 Cartridge, Zelda Ocarina of Time N64 Cart Only, Legend of Zelda Ocarina of Time Boxed` appended inside the group | 185 | 50 | YES | 49 Ocarina, 1 bundle |

All three HTTP 200, no `warnings`/`errors` in the body. No limit found up to 510 characters.

## Probe 5 — non-Latin alternative names

| query | total | returned | target | note |
| --- | ---: | ---: | --- | --- |
| `拳皇96 (Game Boy, Gameboy)` | 0 | 0 | no (226342839550) | never matches |
| `(King of Fighters: Heat of Battle, 拳皇96) (Game Boy, Gameboy)` | 1 | 1 | YES (226342839550) | inert member, group intact |
| `(Legend of Zelda: Ocarina of Time, 젤다 시오) (N64)` | 107 | 50 | no (157850366777 lacks the title phrase) | 49 Ocarina, 1 bundle — same as the title phrase alone (108 ± 1) |
| `(Legend of Zelda: Ocarina of Time, 塞尔达传说 时光之笛) (N64)` | 107 | 50 | no (same reason) | 49 Ocarina, 1 bundle |

## Probe 6 — three catalog games with a colon subtitle and stored eBay points

Picked from the dev database (`games` joined to `price_points` where
`source = 'ebay_uk'`): Super Mario Land 2: 6 Golden Coins (gb, 51 confirmed
eBay mappings), The Legend of Zelda: A Link to the Past (snes, 41), Mega Man:
Dr. Wily's Revenge (gb, 18). Members follow the spec's rules applied to their
`game_names` rows (Latin script, at least two words, not equal to the title
after normalisation, at most three alternative names). "Lost" was checked by
neighbours: a plain-window listing whose plain neighbours sit adjacent in the
group window is absent from the group's result set; one that sits past the
group window's last plain neighbour was merely pushed out of the 50 cheapest.

| game | query | total | returned | target in window | note |
| --- | --- | ---: | ---: | --- | --- |
| SML2 | `Super Mario Land 2: 6 Golden Coins Game Boy` | 259 | 50 | 49 (3 non-game manuals); 1 multi-buy listing | today's query |
| SML2 | `(Super Mario Land 2: 6 Golden Coins, 6 Golden Coins, Super Mario Land 2, Super Mario Land 2: Muttsu no Kinka, Super Mario Land 2: Six Golden Coins) (Game Boy, Gameboy)` | 314 | 50 | 48 (4 non-game); 2 pick-a-game listings | new genuine in window: "Super Mario Land 2 Nintendo Game Boy Game Cartridge GB Japanese Wario" £5.54, "Super Mario Land 2 Authentic Japan Game Boy…" £6.99, "Super Mario Land 6 Golden Coins (Gameboy, Unboxed)" £7.59, "Super Mario Land 2 Gameboy Cartridge" £8.66, "Nintendo Gameboy super Mario land 2 DMG game…" £8.99; none lost (7 plain rows pushed past the cutoff by cheaper genuine ones) |
| ALttP | `Legend of Zelda: A Link to the Past SNES` | 59 | 50 | 50 (4 non-game) | today's query |
| ALttP | `(Legend of Zelda: A Link to the Past, A Link to the Past, Zelda 3, Zelda III, Zelda no Densetsu: Kamigami no Triforce) (SNES, Super Nintendo, Super Famicom)` | 61 | 50 | 50 (4 non-game) | new: "Zelda no Densetsu: Kamigami no Triforce Game JPN Cart Only For Super Famicom" £20.00 and "Zelda no Densetsu Kamigami no Triforce - Nintendo Super Famicom - Boxed Complete" £83.89 (alt-name member); "Zelda A Link to the Past (Nintendo Super Famicom) SHVC-ZL" £16.99 and 3 more Super-Famicom-only titles (platform spelling); none lost (2 pushed past the cutoff) |
| Mega Man | `Mega Man: Dr. Wily's Revenge Game Boy` | 21 | 21 | 21 (3 non-game) | today's query |
| Mega Man | `(Mega Man: Dr. Wily's Revenge, Dr. Wily's Revenge, Rockman World, Megaman GB, Mega Man: Dr. Wily's Rache) (Game Boy, Gameboy)` | 28 | 28 | all 21 kept + 2 genuine Japanese ("Rockman World Mega Man Nintendo Game Boy Japan Import…" £18.28, "Rockman World - Megaman - Nintendo Game Boy Japanese" £52.69) + 1 two-game bundle ("Rockman World 1 & 2") | + 4 numbered siblings (Rockman World 2 x2, 3, 4) that the matcher's numeral cap rejects; "Megaman GB" and "Dr. Wily's Rache" inert; no starvation (28 < 50) |

## Probe 7 — titles WITHOUT a colon but with alternative names (extra, not in the spec)

Run because probe 1 showed the title member is a phrase: without a subtitle
member nothing compensates its strictness.

| game | query | total | returned | target in window | note |
| --- | --- | ---: | ---: | --- | --- |
| Mario Kart 64 (n64) | `Mario Kart 64 N64` | 121 | 50 | 41 (9 non-game: manuals, case only); 9 other (Banjo/Star Wars/Conker case-only listings, Star Wars Rogue Squadron x3, MarioKart Double Dash, an N64 bundle) | today's query |
| Mario Kart 64 | `(Mario Kart 64, Super Mario Kart R) (N64, Nintendo 64)` | 110 | 50 | 49 (5 non-game); 1 bundle | LOST 5 genuine listings whose title has no contiguous "Mario Kart 64": 206379011424 "japanese version of mario kart, boxed no manual, n64 Vgc.", 398281325125 "Mario Kart N64 Nintendo 64, 1996 Authentic Game Cartridge Only Tested", 398032989761 and 376886656995 "N64 MARIO KART GAME TESTED AND WORKING NINTENDO 64", 377198098578 "N64 MARIO KART GAME WITH INSTRUCTIONS…"; gained 9 "Nintendo 64"-only titles through the platform spelling; "Super Mario Kart R" inert |
| Pokémon Red Version (gb) | `Pokémon Red Version Game Boy` | 194 | 50 | about 41 genuine; 6 Pokémon Fire Red (GBA sibling), 1 greetings card, 1 custom case, 4 non-game | today's query |
| Pokémon Red Version | `(Pokémon Red Version, Pokemon Red, Pocket Monsters Red) (Game Boy, Gameboy)` | 175 | 50 | 50 by regex (4 non-game), Fire Red gone | gained about 10 genuine "Pokemon Red" listings without "Version" (incl. "Pokemon Pocket Monsters Red - Game Boy - Loose - Japan" from the alt member); LOST 3 genuine accented listings without "Version": 198556632818 "Pokémon Red Gameboy Japanese Pocket Monsters Authentic Tested", 128027593152 "Nintendo Pokémon Red - Nintendo GameBoy Color PAL Cartridge Only", 326782909946 "Pokémon Red Nintendo Game boy Genuine Cartridge No Box" — consistent with phrase matching not folding the accent (hypothesis, not separately verified) |

## Catalog facts checked for the design (dev database, read-only)

- 287 of 772 `games.title` values contain a colon; 0 contain ` - ` without a
  colon, so a ` - Subtitle` rule has nothing to apply to.
- 253 `game_names` rows contain non-ASCII characters (Chinese, Japanese,
  Korean, Cyrillic, accented Latin such as "El Mañana Nunca Muere").
- `PLATFORMS[p].titleKeywords` already lists the spellings the platform
  group needs (gb: game boy, gameboy; n64: n64, nintendo 64; snes: snes,
  super nintendo, super famicom; gba: gba, game boy advance, gameboy advance).

## Consequences for Part B

- The shape must be `(<m1>, <m2>, …) (<platform spellings>)`, never
  `(<members>) <platform label>` (fact 4). With one member today's plain
  shape stays.
- Every member is a phrase: keep the subtitle rule (at least two words after
  stripping the leading article; fact 7), strip commas, keep or drop colons.
- Titles without a subtitle member: a single group query loses genuine
  listings (fact 9). Either keep today's plain query and add a second, group
  call for the alternative names (one extra Browse request per live fetch of
  such a game, merged by `sourceProductId`), or do not widen those titles at
  all. Titles with a subtitle member showed no loss in five games.
- Length is not the binding constraint (fact 5): the "at most three
  alternative names" cap can stay for simplicity, but nothing observed
  requires it, and the "fewest shared words" preference tends to pick inert
  acronym or foreign-language names ("TLoZ: ALttP", "A lenda de Zelda: um
  elo com o passado") over useful ones ("Zelda 3", "Zelda III").
- Non-Latin names: exclude for hygiene (fact 6); they cannot break a query.
