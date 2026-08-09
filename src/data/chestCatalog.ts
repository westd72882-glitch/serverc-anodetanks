// Mirrors gamescripts/ChestCatalog.h -- see that file's header comment
// for the full guaranteedTier explanation (certificates vs regular
// chests). The client's copy is display-only; this one is what the
// server actually rolls against.

export interface ChestDef {
  id: string;
  price: number;        // in whichever currency costsGold selects
  costsGold: boolean;   // false = credits (silver), true = gold
  tankDropChance: number; // 0..1, per-chest now rather than one global value; ignored (treated as 1.0) when guaranteedTier > 0
  creditsMin: number;
  creditsMax: number;
  xpMin: number;
  xpMax: number;
  // 0 = a normal chest (odds-based, any premium tank). > 0 = a
  // certificate: routes/chest.ts always awards a tank at exactly this
  // TankEntry tier (any tank at that tier, not just premium ones), never
  // a currency fallback.
  guaranteedTier: number;
}

export const CHEST_CATALOG: ChestDef[] = [
  { id: "chest_standard",  price: 1000, costsGold: false, tankDropChance: 0.05, creditsMin: 400,  creditsMax: 900,  xpMin: 300,  xpMax: 700,  guaranteedTier: 0 },
  { id: "chest_premium",   price: 500,  costsGold: true,  tankDropChance: 0.10, creditsMin: 1200, creditsMax: 2600, xpMin: 900,  xpMax: 1800, guaranteedTier: 0 },
  { id: "chest_collector", price: 1000, costsGold: true,  tankDropChance: 0.20, creditsMin: 2500, creditsMax: 5000, xpMin: 1800, xpMax: 3600, guaranteedTier: 0 },
  // Tier-V tank certificate: 1500 gold, always a tier-V tank.
  { id: "cert_tier5", price: 1500, costsGold: true, tankDropChance: 1.0, creditsMin: 0, creditsMax: 0, xpMin: 0, xpMax: 0, guaranteedTier: 5 },
];

export function findChest(id: string): ChestDef | undefined {
  return CHEST_CATALOG.find((c) => c.id === id);
}
