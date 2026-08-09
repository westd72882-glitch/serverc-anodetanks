// ============================================================================
// Cosmetic skins. Mirrors gamescripts/SkinCatalog.h -- the client's copy is
// used only to DRAW the price on the Store card; THIS one is what actually
// gets charged, so if you change a price on one side change it on the
// other or the player will be billed a number they never saw.
//
// A skin is bound to exactly one tank (tankId) and is purely cosmetic --
// paint color, and for at least one entry (the banana skin) the client
// also reshapes that tank's silhouette in DrawTankModel. Either way it
// never touches a stat; the server only cares about tankId/priceGold.
// Skins are always paid for in GOLD.
//
// Buying a skin for a tank you don't own yet is deliberately allowed --
// it's a cosmetic sitting in the account until the tank shows up, and
// refusing the sale would just be a confusing dead end in the Store.
// ============================================================================

export interface CatalogSkin {
  id: string;
  tankId: string;
  priceGold: number;
}

export const SKIN_CATALOG: CatalogSkin[] = [
  { id: "skin_uk_churchill_pink", tankId: "uk_churchill", priceGold: 250 },
  { id: "skin_ussr_t26b_banana", tankId: "ussr_t26b", priceGold: 150 },
];

export function findSkin(id: string): CatalogSkin | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}

// Every skin id in `equippedSkinIds` that belongs to `tankId`. Used to
// enforce the one-skin-per-tank rule when equipping: the old one is
// removed before the new one goes in, so the array can never end up
// holding two skins that both claim the same vehicle.
export function equippedIdsForTank(equippedSkinIds: string[], tankId: string): string[] {
  return equippedSkinIds.filter((id) => {
    const skin = findSkin(id);
    return !!skin && skin.tankId === tankId;
  });
}
