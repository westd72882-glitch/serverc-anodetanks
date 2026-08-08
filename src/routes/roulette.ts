import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, setRouletteCost, addRouletteWonReward } from "../db/profileRepo";
import { ROULETTE_REWARDS, ROULETTE_BASE_COST } from "../data/rouletteCatalog";

const router = Router();

router.post("/spin", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;

  try {
    const { profile, result } = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const cost: number = row.roulette_cost > 0 ? Number(row.roulette_cost) : ROULETTE_BASE_COST;
      const wonIds: string[] = row.roulette_won_reward_ids ?? [];

      const eligible = ROULETTE_REWARDS.filter((r) => !wonIds.includes(r.id));
      if (eligible.length === 0) {
        throw Object.assign(new Error("All rewards already won."), { code: "wheel_exhausted", status: 409 });
      }

      const credits = Number(row.credits);
      if (credits < cost) {
        throw Object.assign(new Error("Not enough credits."), { code: "insufficient_credits", status: 402 });
      }

      // Weighted pick among the still-eligible rewards, renormalized over
      // just that subset -- mirrors ProfileManager::SpinRoulette exactly,
      // so removing a won reward doesn't shrink the odds of a spin
      // actually paying out something.
      const totalWeight = eligible.reduce((sum, r) => sum + r.chance, 0) || 1;
      let roll = Math.random() * totalWeight;
      let chosen = eligible[eligible.length - 1];
      let running = 0;
      for (const r of eligible) {
        running += r.chance;
        if (roll <= running) {
          chosen = r;
          break;
        }
      }

      const economyDelta: { credits?: number; gold?: number; experience?: number } = { credits: -cost };
      if (chosen.kind === "gold") economyDelta.gold = chosen.amount;
      else if (chosen.kind === "credits") economyDelta.credits = (economyDelta.credits ?? 0) + chosen.amount;
      else economyDelta.experience = chosen.amount;

      await updateEconomy(client, accountId, economyDelta);
      await addRouletteWonReward(client, accountId, chosen.id);
      await setRouletteCost(client, accountId, cost * 2);

      const profile = await getProfile(accountId, client);
      return { profile, result: chosen };
    });

    res.json({
      profile,
      reward: { id: result.id, displayName: result.displayName, kind: result.kind, amount: result.amount },
    });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("roulette/spin failed:", err);
    res.status(500).json({ error: "Spin failed, please try again.", code: "internal_error" });
  }
});

export default router;
