// Mirrors gamescripts/ChestCatalog.h.

export interface ChestDef {
  id: string;
  price: number;        // in whichever currency costsGold selects
  costsGold: boolean;   // false = credits (silver), true = gold
  tankDropChance: number; // 0..1, per-chest now rather than one global value
  creditsMin: number;
  creditsMax: number;
  xpMin: number;
  xpMax: number;
}

export const CHEST_CATALOG: ChestDef[] = [
  { id: "chest_standard",  price: 1000, costsGold: false, tankDropChance: 0.05, creditsMin: 400,  creditsMax: 900,  xpMin: 300,  xpMax: 700 },
  { id: "chest_premium",   price: 500,  costsGold: true,  tankDropChance: 0.10, creditsMin: 1200, creditsMax: 2600, xpMin: 900,  xpMax: 1800 },
  { id: "chest_collector", price: 1000, costsGold: true,  tankDropChance: 0.20, creditsMin: 2500, creditsMax: 5000, xpMin: 1800, xpMax: 3600 },
];

export function findChest(id: string): ChestDef | undefined {
  return CHEST_CATALOG.find((c) => c.id === id);
}
