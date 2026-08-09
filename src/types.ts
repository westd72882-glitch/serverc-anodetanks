// ============================================================================
// Shared types for the `profiles` table row shape and every route's
// request/response bodies. This mirrors (a subset of) the C++
// PlayerProfile struct in gamescripts/ProfileManager.h -- if you add a
// field there that the server needs to know about, add it here too, in
// the SQL schema, and in the row<->Profile mapping in db/profileRepo.ts.
//
// IMPORTANT: the catalogs under src/data/ are the server's own copies of
// the same pricing/reward tables the C++ client has. The client's copies
// are now only used for *display* (showing a price before you tap Buy);
// these are what actually get charged. If you change a price on one
// side, change it on the other, or the number the player sees won't
// match what they're charged.
// ============================================================================

export interface Profile {
  accountId: number;
  username: string;
  createdAtUnix: number;
  lastLoginAtUnix: number;

  credits: number;
  gold: number;
  experience: number;

  ownedTankIds: string[]; // does NOT include the free starter tank -- see data/tankCatalog.ts STARTER_TANK_ID
  selectedTankId: string; // "" = starter tank

  battlePassClaimedTiers: number[];

  rouletteCost: number; // 0 = never spun yet, treat as ROULETTE_BASE_COST
  rouletteWonRewardIds: string[];

  // Cosmetic skins (see data/skinCatalog.ts). equippedSkinIds holds at
  // most one skin per tank -- every skin already knows its own tankId, so
  // no second key is needed to say what it's worn on.
  ownedSkinIds: string[];
  equippedSkinIds: string[];

  // Per-tank upgrade levels as "tankId:level" strings (see
  // data/tankUpgrades.ts for why it's a flat string array and not an
  // object). Only tanks above stock level 1 appear here.
  tankUpgrades: string[];
}

// What a brand-new account's profile row looks like -- mirrors the C++
// PlayerProfile struct's default member initializers exactly (free
// starter tank auto-owned via the id just not being in ownedTankIds,
// everything else at zero).
export function newProfileDefaults(): Omit<Profile, "accountId" | "username" | "createdAtUnix" | "lastLoginAtUnix"> {
  return {
    credits: 0,
    gold: 0,
    experience: 0,
    ownedTankIds: [],
    selectedTankId: "",
    battlePassClaimedTiers: [],
    rouletteCost: 0,
    rouletteWonRewardIds: [],
    ownedSkinIds: [],
    equippedSkinIds: [],
    tankUpgrades: [],
  };
}

// Every mutating endpoint (buy/sell/spin/claim/open) returns this shape,
// so the client always applies results the same way: replace its whole
// local profile with exactly what the server sends back, never patch
// fields in based on what it assumes happened.
export interface ProfileResponse {
  profile: Profile;
}

export interface ApiErrorBody {
  error: string; // human-readable, safe to show the player
  code: string; // machine-readable, e.g. "insufficient_credits"
}
