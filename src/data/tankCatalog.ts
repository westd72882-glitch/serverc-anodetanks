export interface CatalogTank {
  id: string;
  tier: number;
  price: number; // credits, 0 if not sold for credits
  priceGold: number; // gold, 0 if not sold for gold
  isGoldTank: boolean;
  rewardOnly: boolean;
}

// Mirrors gamescripts/TankCatalog.h -- regenerate whenever prices change
// there, or buy/sell will validate against stale numbers.
export const TANK_CATALOG: CatalogTank[] = [
  { id: "ussr_t26b", tier: 2, price: 0, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_stugiiiausfb", tier: 3, price: 2000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_e25", tier: 5, price: 5000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_panther", tier: 7, price: 12000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_lowe", tier: 9, price: 30000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_maus", tier: 10, price: 60000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "usa_m4a3sherman", tier: 5, price: 0, priceGold: 1250, isGoldTank: true, rewardOnly: false },
  { id: "uk_cromwell", tier: 6, price: 0, priceGold: 2500, isGoldTank: true, rewardOnly: false },
  { id: "usa_m41walkerbulldog", tier: 7, price: 0, priceGold: 3250, isGoldTank: true, rewardOnly: false },
  { id: "ger_stugiiig", tier: 4, price: 0, priceGold: 1500, isGoldTank: true, rewardOnly: false },
  { id: "ger_pz3ausfl", tier: 5, price: 0, priceGold: 1750, isGoldTank: true, rewardOnly: false },
  { id: "uk_fv215b", tier: 10, price: 0, priceGold: 12500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t54", tier: 9, price: 0, priceGold: 9500, isGoldTank: true, rewardOnly: false },
  { id: "fra_amx1375", tier: 6, price: 0, priceGold: 2250, isGoldTank: true, rewardOnly: false },
  { id: "ger_kanonenjagdpanzer", tier: 8, price: 0, priceGold: 7000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su85", tier: 5, price: 0, priceGold: 2000, isGoldTank: true, rewardOnly: false },
  { id: "fra_amx1390", tier: 8, price: 0, priceGold: 6750, isGoldTank: true, rewardOnly: false },
  // BM-13: rocket artillery, sold for gold like the other premiums.
  // Must stay in sync with gamescripts/TankCatalog.h -- a tank the
  // server does not know about simply cannot be bought.
  { id: "ussr_bm13", tier: 8, price: 0, priceGold: 8200, isGoldTank: true, rewardOnly: false },
  { id: "ussr_isu152", tier: 8, price: 0, priceGold: 7750, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su152", tier: 7, price: 0, priceGold: 6000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_obj261", tier: 10, price: 0, priceGold: 14000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_bt5", tier: 3, price: 0, priceGold: 600, isGoldTank: true, rewardOnly: false },
  { id: "ussr_is2sh", tier: 9, price: 0, priceGold: 10500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su100m1", tier: 7, price: 0, priceGold: 5750, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t24", tier: 3, price: 0, priceGold: 750, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t3485", tier: 6, price: 0, priceGold: 2750, isGoldTank: true, rewardOnly: false },
  { id: "ger_sturermimil", tier: 6, price: 0, priceGold: 3000, isGoldTank: true, rewardOnly: false },
  { id: "uk_tog2", tier: 6, price: 0, priceGold: 3500, isGoldTank: true, rewardOnly: false },
  { id: "chn_wz112", tier: 9, price: 0, priceGold: 10250, isGoldTank: true, rewardOnly: false },
  { id: "uk_matilda", tier: 4, price: 0, priceGold: 1600, isGoldTank: true, rewardOnly: false },
  { id: "uk_churchill", tier: 6, price: 0, priceGold: 3400, isGoldTank: true, rewardOnly: false },
];

export const STARTER_TANK_ID = "ussr_t26b"; // free tank, always owned, never in ownedTankIds, never sellable

export function findTank(id: string): CatalogTank | undefined {
  return TANK_CATALOG.find((t) => t.id === id);
}
