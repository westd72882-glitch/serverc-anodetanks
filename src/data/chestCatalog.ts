// Mirrors gamescripts/ChestCatalog.h.

export interface ChestDef {
  id: string;
  price: number; // credits
  creditsMin: number;
  creditsMax: number;
  xpMin: number;
  xpMax: number;
}

export const CHEST_TANK_DROP_CHANCE = 0.1;

export const CHEST_CATALOG: ChestDef[] = [
  { id: "chest_standard", price: 2500, creditsMin: 400, creditsMax: 900, xpMin: 300, xpMax: 700 },
  { id: "chest_premium", price: 6500, creditsMin: 1200, creditsMax: 2600, xpMin: 900, xpMax: 1800 },
];

export function findChest(id: string): ChestDef | undefined {
  return CHEST_CATALOG.find((c) => c.id === id);
}
