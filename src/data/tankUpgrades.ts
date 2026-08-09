// ============================================================================
// Per-tank upgrade levels. Mirrors the TankUpgrades namespace in
// gamescripts/SkinCatalog.h -- same level cap, same cost formula. As with
// every other catalog under src/data/, the client's copy is display-only
// and THIS one is what's actually charged.
//
// Level 1 is stock and is never stored: only tanks upgraded past it
// appear in profiles.tank_upgrades, so an untouched garage carries no
// rows at all. Levels are serialized as "tankId:level" strings in a
// TEXT[] column rather than a JSON object, because the C++ client's
// MiniJson reader only handles flat arrays of strings (see MiniJson.h)
// and this way the exact same representation works for the wire format,
// the database column and the client's local save file.
// ============================================================================

export const MAX_UPGRADE_LEVEL = 10;
const COST_BASE = 350; // credits, multiplied by tier and by the level being bought

export function clampLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 1;
  if (level > MAX_UPGRADE_LEVEL) return MAX_UPGRADE_LEVEL;
  return Math.floor(level);
}

// Credits to go from `currentLevel` to `currentLevel + 1`. 0 when maxed.
export function upgradeCost(tier: number, currentLevel: number): number {
  const level = clampLevel(currentLevel);
  if (level >= MAX_UPGRADE_LEVEL) return 0;
  const t = tier < 1 ? 1 : tier;
  return COST_BASE * t * (level + 1);
}

// Reads a level out of the raw "tankId:level" array. Unknown tanks (and
// anything malformed) come back as 1, which is exactly right -- stock is
// the default for everything that isn't explicitly recorded.
export function levelFromPairs(pairs: string[], tankId: string): number {
  for (const pair of pairs ?? []) {
    const colon = pair.indexOf(":");
    if (colon <= 0) continue;
    if (pair.slice(0, colon) !== tankId) continue;
    const parsed = Number.parseInt(pair.slice(colon + 1), 10);
    if (Number.isNaN(parsed)) return 1;
    return clampLevel(parsed);
  }
  return 1;
}

// Returns a NEW array with `tankId` set to `level`, replacing any existing
// entry for that tank. A level of 1 removes the entry entirely, keeping
// the stored array free of stock-level noise.
export function withLevel(pairs: string[], tankId: string, level: number): string[] {
  const next = (pairs ?? []).filter((pair) => {
    const colon = pair.indexOf(":");
    return colon > 0 && pair.slice(0, colon) !== tankId;
  });
  const clamped = clampLevel(level);
  if (clamped > 1) next.push(`${tankId}:${clamped}`);
  return next;
}
