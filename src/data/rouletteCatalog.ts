// Mirrors gamescripts/ProfileManager.h's Roulette namespace. The RNG spin
// itself happens here on the server (see routes/roulette.ts) -- the
// client never rolls its own random number for this, it only ever asks
// "spin for me" and gets told what it won.

export type RewardKind = "gold" | "credits" | "experience";

export interface RouletteReward {
  id: string;
  displayName: string;
  kind: RewardKind;
  amount: number;
  chance: number; // relative weight, doesn't need to sum to 1.0 -- see routes/roulette.ts
}

export const ROULETTE_BASE_COST = 5000;

export const ROULETTE_REWARDS: RouletteReward[] = [
  { id: "roulette_gold_500", displayName: "500 GOLD", kind: "gold", amount: 500, chance: 0.1 },
  { id: "roulette_gold_250", displayName: "250 GOLD", kind: "gold", amount: 250, chance: 0.1 },
  { id: "roulette_gold_100", displayName: "100 GOLD", kind: "gold", amount: 100, chance: 0.15 },
  { id: "roulette_credits_30000", displayName: "30000 CREDITS", kind: "credits", amount: 30000, chance: 0.05 },
  { id: "roulette_credits_15000", displayName: "15000 CREDITS", kind: "credits", amount: 15000, chance: 0.1 },
  { id: "roulette_credits_5000", displayName: "5000 CREDITS", kind: "credits", amount: 5000, chance: 0.15 },
  { id: "roulette_xp_10000", displayName: "10000 XP", kind: "experience", amount: 10000, chance: 0.1 },
  { id: "roulette_xp_5000", displayName: "5000 XP", kind: "experience", amount: 5000, chance: 0.1 },
  { id: "roulette_xp_2000", displayName: "2000 XP", kind: "experience", amount: 2000, chance: 0.15 },
];

export function findRouletteReward(id: string): RouletteReward | undefined {
  return ROULETTE_REWARDS.find((r) => r.id === id);
}
