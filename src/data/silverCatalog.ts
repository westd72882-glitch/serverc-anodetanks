// ============================================================================
// Silver (credits) packs -- an in-game exchange, not real money: gold is
// spent and credits are granted in the SAME request/transaction, unlike
// the real-money gold packs which only grant anything after an external
// payment confirms.
//
// Mirrors GameScene::GetSilverPacks() in gamescripts/GameScene.h. Packs
// are matched by their `credits` amount (see routes/silver.ts) rather
// than a separate id, since every pack in the catalog grants a distinct
// amount and nothing else needs distinguishing between two of them.
// ============================================================================

export interface SilverPack {
  credits: number;
  priceGold: number;
}

export const SILVER_CATALOG: SilverPack[] = [
  { credits: 5000, priceGold: 60 },
  { credits: 15000, priceGold: 150 },
  { credits: 40000, priceGold: 350 },
  { credits: 100000, priceGold: 800 },
];

export function findSilverPack(credits: number): SilverPack | undefined {
  return SILVER_CATALOG.find((p) => p.credits === credits);
}
