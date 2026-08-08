import { TANK_CATALOG, findTank } from "./tankCatalog";

// Mirrors gamescripts/GameCore.cpp's GameScene::SellPriceForTank exactly.
// See that function's comments for the full reasoning; short version:
// half of whatever the same tier costs in the credits tech tree (so a
// sale can never pay out more than "цена в ветке" for that tier), with
// premium/gold tanks (which have no tech-tree price of their own)
// estimated from the cheapest credits tank at the same tier.
const SELL_FRACTION = 0.5;

export function sellPriceForTank(tankId: string): number {
  const entry = findTank(tankId);
  if (!entry) return 0;

  // Plain credits tank with a real price of its own: half of it, directly.
  if (!entry.isGoldTank && entry.price > 0) {
    return Math.floor(entry.price * SELL_FRACTION);
  }

  // Free starter tank (price<=0, not reward-only, not gold): never paid
  // for, so nothing to refund. (rewardOnly tanks are rejected earlier in
  // routes/tank.ts before this is even called.)
  if (!entry.isGoldTank && entry.price <= 0) {
    return 0;
  }

  // Premium/gold tank: estimate from the cheapest same-tier credits tank
  // across the whole catalog, falling back to progressively lower tiers
  // if nothing exists at this exact tier yet.
  for (let tierTry = entry.tier; tierTry >= 1; tierTry--) {
    let cheapestAtTier = -1;
    for (const candidate of TANK_CATALOG) {
      if (candidate.rewardOnly || candidate.isGoldTank) continue;
      if (candidate.price <= 0) continue;
      if (candidate.tier !== tierTry) continue;
      if (cheapestAtTier < 0 || candidate.price < cheapestAtTier) {
        cheapestAtTier = candidate.price;
      }
    }
    if (cheapestAtTier >= 0) {
      return Math.floor(cheapestAtTier * SELL_FRACTION);
    }
  }
  return 0; // no reference tank exists at or below this tier yet
}
