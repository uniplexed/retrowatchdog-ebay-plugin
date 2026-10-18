/**
 * This plugin's own copy of PLATFORMS[*].sellerSpellings from the app
 * repository's packages/shared/src/platforms.ts: a copy, not an import, so
 * the package depends on nothing outside this repository. A change to either
 * table is copied to the other by hand.
 *
 * query.ts prefers the app's `spelling=` parameters and falls back to this
 * table only when none usable are sent.
 */

export type Platform =
  | "nes"
  | "snes"
  | "n64"
  | "gb"
  | "gbc"
  | "gba"
  | "megadrive"
  | "master_system"
  | "game_gear"
  | "saturn"
  | "dreamcast"
  | "ps1"
  | "ps2"
  | "gamecube"
  | "neogeo_aes"
  | "neogeo_pocket_color"
  | "ds"
  | "3ds"
  | "virtual_boy"
  | "game_and_watch"
  | "pc";

export interface PlatformSpellings {
  /** how sellers write this console in a listing title */
  sellerSpellings: string[];
}

// One entry per line, `<id>: { sellerSpellings: [...] },`, the app table's shape, so the two diff cleanly.
// Order matters: the FIRST spelling is the plain query's trailing word.
export const PLATFORMS: Record<Platform, PlatformSpellings> = {
  nes: { sellerSpellings: ["NES", "Nintendo Entertainment System", "Famicom"] },
  snes: { sellerSpellings: ["SNES", "Super Nintendo", "Super Famicom"] },
  n64: { sellerSpellings: ["N64", "Nintendo 64"] },
  gb: { sellerSpellings: ["Game Boy", "Gameboy"] },
  gbc: { sellerSpellings: ["Game Boy Color", "Gameboy Color", "Game Boy Colour", "Gameboy Colour", "GBC"] },
  gba: { sellerSpellings: ["GBA", "Game Boy Advance", "Gameboy Advance"] },
  megadrive: { sellerSpellings: ["Mega Drive", "Megadrive", "Genesis"] },
  master_system: { sellerSpellings: ["Master System"] },
  game_gear: { sellerSpellings: ["Game Gear", "GameGear"] },
  saturn: { sellerSpellings: ["Saturn"] },
  dreamcast: { sellerSpellings: ["Dreamcast"] },
  ps1: { sellerSpellings: ["PS1", "PlayStation 1", "PSX"] },
  ps2: { sellerSpellings: ["PS2", "PlayStation 2"] },
  gamecube: { sellerSpellings: ["GameCube", "Game Cube"] },
  neogeo_aes: { sellerSpellings: ["Neo Geo AES", "NeoGeo AES"] },
  neogeo_pocket_color: { sellerSpellings: ["Neo Geo Pocket Color", "Neo Geo Pocket Colour", "NeoGeo Pocket Color", "NeoGeo Pocket Colour", "NGPC"] },
  ds: { sellerSpellings: ["Nintendo DS", "DS"] },
  "3ds": { sellerSpellings: ["3DS", "Nintendo 3DS"] },
  virtual_boy: { sellerSpellings: ["Virtual Boy", "VirtualBoy"] },
  game_and_watch: { sellerSpellings: ["Game & Watch", "Game and Watch", "Game&Watch"] },
  pc: { sellerSpellings: ["PC"] },
};
