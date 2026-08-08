// Mirrors gamescripts/ProfileManager.h's BattlePass namespace.

export const BP_TIER_COUNT = 20;
export const BP_XP_PER_TIER = 2500;
export const BP_CREDITS_PER_TIER = 500;
export const BP_FINAL_TIER = BP_TIER_COUNT; // grand prize tier
export const BP_BONUS_TANK_TIER = 10; // mid-track bonus tank tier
export const BP_GOLD_PER_MILESTONE = 10;
export const BP_GOLD_TIER_INTERVAL = 5;

export const BP_FINAL_TANK_ID = "ger_maus"; // grand prize -- keep in sync with the actual grant in GameScene.h
export const BP_BONUS_TANK_ID = "ussr_t3485"; // mid-track bonus tank ("T-34-85" in the UI)

export function bpTierGrantsGold(tier: number): boolean {
  return tier > 0 && tier % BP_GOLD_TIER_INTERVAL === 0;
}

// XP required to have UNLOCKED (not necessarily claimed) a given 1-based tier.
export function bpXpRequiredForTier(tier: number): number {
  return tier * BP_XP_PER_TIER;
}

// Highest tier the given XP total has unlocked, clamped to BP_TIER_COUNT.
export function bpTierForXp(experience: number): number {
  const tier = Math.floor(experience / BP_XP_PER_TIER);
  return Math.max(0, Math.min(BP_TIER_COUNT, tier));
}
