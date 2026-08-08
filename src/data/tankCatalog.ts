export interface CatalogTank {
  id: string;
  tier: number;
  price: number; // credits, 0 if not sold for credits
  priceGold: number; // gold, 0 if not sold for gold
  isGoldTank: boolean;
  rewardOnly: boolean;
}

// Mirrors gamescripts/TankCatalog.h -- see that file for the authoritative
// definitions (display names, stats, nation, etc). Only the fields the
// server needs to validate economy actions are duplicated here. Generated
// from the C++ source; if you add/change a tank there, update this list
// too, or buy/sell will validate against stale data.
export const TANK_CATALOG: CatalogTank[] = [
  { id: "ussr_t26b", tier: 2, price: 0, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_stugiiiausfb", tier: 3, price: 4500, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_e25", tier: 5, price: 9500, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_panther", tier: 7, price: 24000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_lowe", tier: 9, price: 62000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "ger_maus", tier: 10, price: 125000, priceGold: 0, isGoldTank: false, rewardOnly: false },
  { id: "usa_m4a3sherman", tier: 5, price: 0, priceGold: 2500, isGoldTank: true, rewardOnly: false },
  { id: "uk_cromwell", tier: 6, price: 0, priceGold: 5000, isGoldTank: true, rewardOnly: false },
  { id: "usa_m41walkerbulldog", tier: 7, price: 0, priceGold: 6500, isGoldTank: true, rewardOnly: false },
  { id: "ger_stugiiig", tier: 4, price: 0, priceGold: 3000, isGoldTank: true, rewardOnly: false },
  { id: "ger_pz3ausfl", tier: 5, price: 0, priceGold: 3500, isGoldTank: true, rewardOnly: false },
  { id: "uk_fv215b", tier: 10, price: 0, priceGold: 25000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t54", tier: 9, price: 0, priceGold: 19000, isGoldTank: true, rewardOnly: false },
  { id: "fra_amx1375", tier: 6, price: 0, priceGold: 4500, isGoldTank: true, rewardOnly: false },
  { id: "ger_kanonenjagdpanzer", tier: 8, price: 0, priceGold: 14000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su85", tier: 5, price: 0, priceGold: 4000, isGoldTank: true, rewardOnly: false },
  { id: "fra_amx1390", tier: 8, price: 0, priceGold: 13500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_isu152", tier: 8, price: 0, priceGold: 15500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su152", tier: 7, price: 0, priceGold: 12000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_obj261", tier: 10, price: 0, priceGold: 28000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_bt5", tier: 3, price: 0, priceGold: 1200, isGoldTank: true, rewardOnly: false },
  { id: "ussr_is2sh", tier: 9, price: 0, priceGold: 21000, isGoldTank: true, rewardOnly: false },
  { id: "ussr_su100m1", tier: 7, price: 0, priceGold: 11500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t24", tier: 3, price: 0, priceGold: 1500, isGoldTank: true, rewardOnly: false },
  { id: "ussr_t3485", tier: 6, price: 0, priceGold: 5500, isGoldTank: true, rewardOnly: false },
  { id: "ger_sturermimil", tier: 6, price: 0, priceGold: 6000, isGoldTank: true, rewardOnly: false },
  { id: "uk_tog2", tier: 6, price: 0, priceGold: 7000, isGoldTank: true, rewardOnly: false },
  { id: "chn_wz112", tier: 9, price: 0, priceGold: 20500, isGoldTank: true, rewardOnly: false },
  { id: "uk_matilda", tier: 4, price: 0, priceGold: 3200, isGoldTank: true, rewardOnly: false },
  { id: "uk_churchill", tier: 6, price: 0, priceGold: 6800, isGoldTank: true, rewardOnly: false },
];

export const STARTER_TANK_ID = "ussr_t26b"; // free tank, always owned, never in ownedTankIds, never sellable

export function findTank(id: string): CatalogTank | undefined {
  return TANK_CATALOG.find((t) => t.id === id);
}
